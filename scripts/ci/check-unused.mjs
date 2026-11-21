// 未用导出关：lib 里导出但全仓库没人引用的名字。入口文件对外导出豁免。
import { join } from 'node:path'
import { finish, guardBaselineWrite, listFiles, loadPolicy, readJson, readText, writeJson, ROOT, rel } from './lib/common.mjs'
import { extractExports, stripCommentsAndStrings } from './lib/js-scan.mjs'

const policy = loadPolicy()
const files = listFiles({ include: policy.quality.unusedScope })
const baselinePath = join(ROOT, 'ci', 'baselines', 'unused-exports.json')
const baseline = readJson(baselinePath, { allow: {} })
const updating = Boolean(process.argv.includes('--update-baseline'))

const packageJson = JSON.parse(readText(join(ROOT, 'package.json')))
const entryFiles = new Set(
  [packageJson.main, ...Object.values(packageJson.exports || {}).filter((value) => typeof value === 'string')]
    .filter(Boolean)
    .map((value) => value.replace(/^\.\//, '')),
)

const allCode = listFiles({ include: ['lib/**/*.js', 'scripts/ci/**/*.mjs', 'tests/**/*.mjs'] })
const corpus = new Map(allCode.map((file) => [file, stripCommentsAndStrings(readText(join(ROOT, file)))]))
const allow = baseline.allow || {}
const nextAllow = {}
const issues = []
const unusedNow = []

for (const file of files) {
  const code = readText(join(ROOT, file))
  const exports = extractExports(code)
  const isEntry = entryFiles.has(file)
  if (isEntry) continue

  const own = stripCommentsAndStrings(code)
  for (const name of exports) {
    const usedElsewhere = [...corpus.entries()].some(([other, text]) => other !== file && new RegExp(`\\b${name}\\b`).test(text))
    if (usedElsewhere) continue
    const knownUnused = (allow[file] || []).includes(name)
    nextAllow[file] = [...(nextAllow[file] || []), name]
    unusedNow.push(`${file} → ${name}`)
    if (!updating && !knownUnused) issues.push(`未使用导出：${file} 的 “${name}” 在仓库内没有引用`)
  }
}

const summary = [
  `检查 ${files.length} 个导出文件（入口豁免 ${[...entryFiles].join(', ') || '无'}）`,
  `未使用导出 ${unusedNow.length} 个（基线内 ${Object.values(allow).flat().length} 个）`,
]

if (updating) {
  guardBaselineWrite(baselinePath, true)
  writeJson(baselinePath, { generatedAt: new Date().toISOString(), allow: nextAllow })
} else if (Object.values(allow).flat().length) {
  summary.push(`已冻结：${Object.entries(allow).flatMap(([file, names]) => names.map((name) => `${file}:${name}`)).join(', ')}`)
}

finish('check-unused', {
  ok: issues.length === 0,
  summary,
  issues,
  metrics: { files: files.length, unused: unusedNow.length, allowed: Object.values(allow).flat().length },
})
