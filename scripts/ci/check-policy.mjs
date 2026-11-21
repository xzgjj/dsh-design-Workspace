// 规则收紧关：阈值只能更严（预算更小、下限更高），放宽需要 policy-relax 批准。
import { join } from 'node:path'
import { finish, findApproval, guardBaselineWrite, loadPolicy, readJson, writeJson, ROOT, rel } from './lib/common.mjs'

const policy = loadPolicy()
const baselinePath = join(ROOT, 'ci', 'policy.baseline.json')
const baseline = readJson(baselinePath, null)
const updating = Boolean(process.argv.includes('--update-baseline'))
const monotonic = policy._monotonic || {}
const issues = []
const notes = []

function deepGet(object, keyPath) {
  return keyPath.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object)
}

if (updating) {
  guardBaselineWrite(baselinePath, true)
  const values = {}
  for (const key of Object.keys(monotonic)) values[key] = deepGet(policy, key)
  writeJson(baselinePath, { generatedAt: new Date().toISOString(), values })
  finish('check-policy', { ok: true, summary: [`写入 ${rel(baselinePath)}：${Object.keys(values).length} 个阈值`], notes })
}

if (!baseline) {
  finish('check-policy', { ok: false, summary: ['缺少阈值基线'], issues: [`缺少 ${rel(baselinePath)}，先跑 npm run ci:baseline`] })
}

for (const [key, direction] of Object.entries(monotonic)) {
  const current = deepGet(policy, key)
  const previous = baseline.values[key]
  if (current === undefined || previous === undefined) {
    issues.push(`阈值缺失：${key}（当前 ${current}，基线 ${previous}）`)
    continue
  }
  const cur = typeof current === 'boolean' ? Number(current) : current
  const prev = typeof previous === 'boolean' ? Number(previous) : previous
  const relaxed = (direction === 'down' && cur > prev) || (direction === 'up' && cur < prev)
  if (!relaxed) continue
  const approval = findApproval({ kinds: ['policy-relax'] })
  if (approval) notes.push(`放宽 ${key}：${prev} → ${cur}（批准：${approval.id} / ${approval.approvedBy}）`)
  else issues.push(`规则被放宽：${key} ${prev} → ${cur}（需要 ci/approvals/*.json 的 policy-relax）`)
}

finish('check-policy', {
  ok: issues.length === 0,
  summary: [`核对 ${Object.keys(monotonic).length} 个阈值方向（只严不松）`],
  issues,
  notes,
  metrics: { checked: Object.keys(monotonic).length },
})
