// Lint 关：语法检查 + 少量可判定的危险模式；不做风格争论。
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { finish, listFiles, readText, ROOT } from './lib/common.mjs'
import { stripCommentsAndStrings, lineStarts, lineOf } from './lib/js-scan.mjs'

const files = listFiles({ include: ['lib/**/*.js', 'scripts/ci/**/*.mjs', 'tests/**/*.mjs'] })
const issues = []
const summary = []

const FORBID = [
  { re: /\bdebugger\b/g, message: '禁止提交 debugger' },
  { re: /\beval\s*\(/g, message: '禁止 eval' },
  { re: /\bnew\s+Function\s*\(/g, message: '禁止 new Function' },
  { re: /\bvar\s+[A-Za-z_$]/g, message: '用 const/let，不用 var' },
  { re: /\bwith\s*\(/g, message: '禁止 with' },
]

for (const file of files) {
  const abs = join(ROOT, file)
  const code = readText(abs)
  const check = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' })
  if (check.status !== 0) {
    issues.push(`语法错误：${file}\n${(check.stderr || '').trim().split('\n').slice(0, 3).join('\n')}`)
  }

  const stripped = stripCommentsAndStrings(code)
  const starts = lineStarts(stripped)
  for (const rule of FORBID) {
    for (const match of stripped.matchAll(rule.re)) {
      issues.push(`${file}:${lineOf(starts, match.index)} ${rule.message}`)
    }
  }

  if (file.startsWith('lib/')) {
    code.split('\n').forEach((line, index) => {
      if (/\bconsole\.(log|debug|info)\s*\(/.test(line) && !line.includes('ci-allow')) {
        issues.push(`${file}:${index + 1} lib 里不允许 console（如确需保留，行尾加 ci-allow）`)
      }
    })
  }
}

if (files.includes('lib/client.js')) {
  const client = readText(join(ROOT, 'lib/client.js'))
  if (!client.includes('__ModuleLoader__.load')) issues.push('lib/client.js 必须用手写 __ModuleLoader__.load（AGENTS 规则 8）')
}
if (files.includes('lib/index.js')) {
  const host = readText(join(ROOT, 'lib/index.js'))
  if (!/export\s+(?:async\s+)?function\s+apply/.test(host)) issues.push('lib/index.js 必须导出 apply(ctx) 作为 Host 入口')
}

summary.push(`检查 ${files.length} 个文件：语法 + ${FORBID.length} 条危险模式 + 2 条契约`)
finish('check-lint', { ok: issues.length === 0, summary, issues, metrics: { files: files.length } })
