// 复杂度关：按文件记录函数长度 / 圈复杂度 / 嵌套深度 / 文件行数。
// 已存在的超标函数冻结在基线里；新增或继续变差才失败。
import { join } from 'node:path'
import { finish, guardBaselineWrite, listFiles, loadPolicy, readJson, readText, writeJson, ROOT, rel } from './lib/common.mjs'
import { extractFunctions } from './lib/js-scan.mjs'

const policy = loadPolicy()
const files = listFiles({ include: policy.quality.unusedScope })
const baselinePath = join(ROOT, 'ci', 'baselines', 'complexity.json')
const baseline = readJson(baselinePath, { files: {} })
const updating = Boolean(process.argv.includes('--update-baseline'))

const issues = []
const notes = []
const next = {}
const offenders = []

for (const file of files) {
  const code = readText(join(ROOT, file))
  const fileLines = code.split('\n').length
  const fns = extractFunctions(code)
  const maxima = fns.reduce(
    (acc, fn) => ({
      functionLines: Math.max(acc.functionLines, fn.lines),
      cyclomatic: Math.max(acc.cyclomatic, fn.cyclomatic),
      depth: Math.max(acc.depth, fn.depth),
      function: fn.lines >= acc.functionLines ? fn : acc.function,
    }),
    { functionLines: 0, cyclomatic: 0, depth: 0, function: null },
  )

  next[file] = { fileLines, ...maxima, function: undefined }
  const base = baseline.files[file] || { fileLines: 0, functionLines: 0, cyclomatic: 0, depth: 0 }

  if (fileLines > policy.quality.maxFileLines && fileLines > base.fileLines) {
    if (!updating) issues.push(`${file} 文件 ${fileLines} 行（上限 ${policy.quality.maxFileLines}）`)
  }
  if (maxima.functionLines > policy.quality.maxFunctionLines && maxima.functionLines > base.functionLines) {
    if (!updating) issues.push(`${file} 函数 ${maxima.function?.name} ${maxima.functionLines} 行（上限 ${policy.quality.maxFunctionLines}）`)
  }
  if (maxima.cyclomatic > policy.quality.maxCyclomatic && maxima.cyclomatic > base.cyclomatic) {
    if (!updating) issues.push(`${file} 函数 ${maxima.function?.name} 圈复杂度 ${maxima.cyclomatic}（上限 ${policy.quality.maxCyclomatic}）`)
  }
  if (maxima.depth > policy.quality.maxDepth && maxima.depth > base.depth) {
    if (!updating) issues.push(`${file} 函数 ${maxima.function?.name} 嵌套 ${maxima.depth} 层（上限 ${policy.quality.maxDepth}）`)
  }
  offenders.push({ file, fileLines, ...maxima })
}

const summary = [
  `检查 ${files.length} 个文件、${files.reduce((n, file) => n + extractFunctions(readText(join(ROOT, file))).length, 0)} 个函数`,
  `阈值：文件 ${policy.quality.maxFileLines} 行 / 函数 ${policy.quality.maxFunctionLines} 行 / 复杂度 ${policy.quality.maxCyclomatic} / 嵌套 ${policy.quality.maxDepth}`,
]

if (updating) {
  guardBaselineWrite(baselinePath, true)
  writeJson(baselinePath, { generatedAt: new Date().toISOString(), files: next })
  notes.push(`写入 ${rel(baselinePath)}：${files.length} 个文件`)
} else {
  const frozen = files.filter((file) => {
    const base = baseline.files[file]
    const cur = next[file]
    return base && (cur.functionLines > policy.quality.maxFunctionLines || cur.cyclomatic > policy.quality.maxCyclomatic || cur.depth > policy.quality.maxDepth || cur.fileLines > policy.quality.maxFileLines) && cur.fileLines <= base.fileLines
  })
  if (frozen.length) notes.push(`已冻结的超标文件：${frozen.join(', ')}`)
}

finish('check-complexity', { ok: issues.length === 0, summary, issues, notes, metrics: { files: files.length, offenders } })
