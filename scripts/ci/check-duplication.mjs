// 重复代码关：生产代码里 6 行以上的重复窗口；老重复冻结，新增重复失败。
import { join } from 'node:path'
import { finish, guardBaselineWrite, listFiles, loadPolicy, readJson, readText, sha256, shortSha, writeJson, ROOT, rel } from './lib/common.mjs'
import { normalizeLines } from './lib/js-scan.mjs'

const policy = loadPolicy()
const files = listFiles({ include: policy.quality.duplicationScope })
const block = policy.quality.duplicationMinBlockLines
const baselinePath = join(ROOT, 'ci', 'baselines', 'code-duplication.json')
const baseline = readJson(baselinePath, { hashes: [] })
const updating = Boolean(process.argv.includes('--update-baseline'))

const windows = new Map()
for (const file of files) {
  const lines = normalizeLines(readText(join(ROOT, file)))
  for (let i = 0; i + block <= lines.length; i += 1) {
    const chunk = lines.slice(i, i + block)
    if (chunk.join('').length < 40) continue
    const hash = sha256(chunk.join('\n'))
    const list = windows.get(hash) || []
    list.push({ file, line: i + 1 })
    windows.set(hash, list)
  }
}

const groups = []
for (const [hash, locations] of windows) {
  const uniqueFiles = new Set(locations.map((item) => item.file))
  const spread = uniqueFiles.size > 1
  const overlapping = !spread && locations.length > 1 && locations.some((item) => Math.abs(item.line - locations[0].line) >= block)
  if (spread || overlapping) groups.push({ hash, locations })
}

const known = new Set(baseline.hashes)
const fresh = groups.filter((group) => !known.has(group.hash))
const issues = updating ? [] : fresh.map((group) => `新增重复代码（${block} 行）：${group.locations.map((item) => `${item.file}:${item.line}`).join(' / ')}`)

const summary = [
  `扫描 ${files.length} 个文件，重复窗口 ${groups.length} 组，新增 ${fresh.length} 组`,
  `阈值：连续 ${block} 行、非空字符 ≥ 40`,
]

if (updating) {
  guardBaselineWrite(baselinePath, true)
  writeJson(baselinePath, { generatedAt: new Date().toISOString(), hashes: groups.map((group) => group.hash).sort() })
} else if (groups.length) {
  const frozen = groups.filter((group) => known.has(group.hash)).slice(0, 5)
  if (frozen.length) summary.push(`已冻结示例：${frozen.map((group) => shortSha(group.hash)).join(', ')}`)
}

finish('check-duplication', {
  ok: issues.length === 0,
  summary,
  issues,
  metrics: { files: files.length, groups: groups.length, fresh: fresh.length },
})
