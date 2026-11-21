// 测试保护关：登记在册的测试只能新增；修改/删除必须有 test-change 批准。
import { join } from 'node:path'
import { finish, findApproval, guardBaselineWrite, listFiles, loadPolicy, readJson, readText, sha256Text, writeJson, ROOT, rel } from './lib/common.mjs'

const policy = loadPolicy()
const manifestPath = join(ROOT, 'ci', 'protected-tests.json')
const manifest = readJson(manifestPath, { files: {} })
const updating = Boolean(process.argv.includes('--update-baseline'))
const files = listFiles({ include: policy.protected.paths.flatMap((pattern) => [pattern]), roots: ['tests'] })
const current = Object.fromEntries(
  files.map((file) => [file, sha256Text(readText(join(ROOT, file)))]),
)
const issues = []
const notes = []

if (updating) {
  guardBaselineWrite(manifestPath, true)
  writeJson(manifestPath, { generatedAt: new Date().toISOString(), note: '修改或删除这里列出的测试需要 test-change 批准', files: current })
  finish('check-protected', { ok: true, summary: [`写入 ${rel(manifestPath)}：${files.length} 个受保护测试`] })
}

if (!Object.keys(manifest.files).length) {
  finish('check-protected', { ok: false, summary: ['受保护测试基线为空'], issues: [`缺少 ${rel(manifestPath)}，先跑 npm run ci:baseline`] })
}

for (const file of files) {
  const known = manifest.files[file]
  if (!known) {
    notes.push(`新增测试 ${file}（必须在 docs/testing.md 登记）`)
    continue
  }
  if (known === current[file]) continue
  const approval = findApproval({ kinds: ['test-change'], path: file, label: policy.protected.label })
  if (approval) notes.push(`测试修改已批准：${file}（${approval.id} / ${approval.approvedBy}）`)
  else issues.push(`受保护测试被修改：${file}（需要 test-change 批准，PR 需 ${policy.protected.label} 标签）`)
}

for (const file of Object.keys(manifest.files)) {
  if (current[file]) continue
  const approval = findApproval({ kinds: ['test-change'], path: file, label: policy.protected.label })
  if (approval) notes.push(`测试删除已批准：${file}（${approval.id}）`)
  else issues.push(`受保护测试被删除：${file}（删除测试不能消除失败）`)
}

finish('check-protected', {
  ok: issues.length === 0,
  summary: [`受保护 ${Object.keys(manifest.files).length} 个，当前 ${files.length} 个`],
  issues,
  notes,
  metrics: { protected: Object.keys(manifest.files).length, current: files.length },
})
