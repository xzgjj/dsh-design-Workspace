// 轻量 JS 扫描：去注释/字符串、括号配对、函数指标、导出名。
// 不做完整 AST——只服务 CI 的可判定规则，拿不准的一律交给基线与人工审查。
export function stripCommentsAndStrings(code) {
  let out = ''
  let state = 'code'
  let i = 0

  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line'
        out += '  '
        i += 2
        continue
      }
      if (ch === '/' && next === '*') {
        state = 'block'
        out += '  '
        i += 2
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        state = ch === "'" ? 'single' : ch === '"' ? 'double' : 'template'
        out += ' '
        i += 1
        continue
      }
      out += ch
      i += 1
      continue
    }

    if (state === 'line') {
      if (ch === '\n') {
        state = 'code'
        out += '\n'
      } else {
        out += ' '
      }
      i += 1
      continue
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code'
        out += '  '
        i += 2
        continue
      }
      out += ch === '\n' ? '\n' : ' '
      i += 1
      continue
    }

    if (state === 'single' || state === 'double') {
      if (ch === '\\') {
        out += '  '
        i += 2
        continue
      }
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"')) {
        state = 'code'
        out += ' '
        i += 1
        continue
      }
      out += ch === '\n' ? '\n' : ' '
      i += 1
      continue
    }

    if (state === 'template') {
      if (ch === '\\') {
        out += '  '
        i += 2
        continue
      }
      if (ch === '`') {
        state = 'code'
        out += ' '
        i += 1
        continue
      }
      out += ch === '\n' ? '\n' : ' '
      i += 1
      continue
    }
  }

  return out
}

export function lineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

export function lineOf(starts, index) {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (starts[mid] <= index) low = mid + 1
    else high = mid - 1
  }
  return low
}

export function matchBrace(code, openIndex) {
  let depth = 0
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function findBodyOpen(code, fromIndex) {
  for (let i = fromIndex; i < code.length; i += 1) {
    if (code[i] === '{') return i
    if (code[i] === ';' || code[i] === '\n') {
      const rest = code.slice(i + 1, i + 40).trimStart()
      if (!rest.startsWith('{')) return -1
    }
  }
  return -1
}

export function extractFunctions(code) {
  const stripped = stripCommentsAndStrings(code)
  const starts = lineStarts(stripped)
  const functions = []
  const seen = new Set()

  function add(name, startIndex, bodyOpen) {
    const endIndex = matchBrace(stripped, bodyOpen)
    if (endIndex < 0) return
    const key = `${startIndex}:${bodyOpen}`
    if (seen.has(key)) return
    seen.add(key)
    const body = stripped.slice(bodyOpen + 1, endIndex)
    const startLine = lineOf(starts, startIndex)
    const endLine = lineOf(starts, endIndex)
    functions.push({
      name: name || '(anonymous)',
      startLine,
      endLine,
      lines: endLine - startLine + 1,
      cyclomatic: 1 + countBranches(body),
      depth: maxBraceDepth(body),
    })
  }

  const declRe = /\bfunction\s*([A-Za-z_$][\w$]*)?\s*\(/g
  for (const match of stripped.matchAll(declRe)) {
    const open = findBodyOpen(stripped, match.index + match[0].length)
    if (open > -1) add(match[1] || '(anonymous)', match.index, open)
  }

  const arrowRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g
  for (const match of stripped.matchAll(arrowRe)) {
    const open = stripped.indexOf('{', match.index + match[0].length - 1)
    if (open > -1) add(match[1], match.index, open)
  }

  const methodRe = /^[ \t]+(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm
  for (const match of stripped.matchAll(methodRe)) {
    const open = stripped.indexOf('{', match.index + match[0].length - 1)
    if (open > -1) add(match[1], match.index, open)
  }

  return functions
}

function countBranches(body) {
  const keywords = body.match(/\b(?:if|for|while|case|catch)\b/g) || []
  const logical = body.match(/&&|\|\||\?\?/g) || []
  const ternary = body.match(/\?(?![.?])/g) || []
  return keywords.length + logical.length + ternary.length
}

function maxBraceDepth(body) {
  let depth = 0
  let max = 0
  for (const ch of body) {
    if (ch === '{') {
      depth += 1
      if (depth > max) max = depth
    } else if (ch === '}') {
      depth -= 1
    }
  }
  return max
}

export function extractExports(code) {
  const stripped = stripCommentsAndStrings(code)
  const names = new Set()

  for (const match of stripped.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1])
  }
  for (const match of stripped.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const pieces = part.trim().split(/\s+as\s+/)
      const name = (pieces[1] || pieces[0] || '').trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return [...names].sort()
}

export function normalizeLines(code) {
  const stripped = stripCommentsAndStrings(code)
  return stripped
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
}
