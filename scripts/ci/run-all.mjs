// 单一入口：本地 `npm run ci` 与 GitHub Actions 跑同一批脚本。
// 失败即红，不做自动重试（重试轮数由 policy.retry.maxAttempts 固定为 1）。
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { finish, parseArgs, readJson, ROOT, writeReport } from './lib/common.mjs'

const args = parseArgs()
const profile = args.profile === 'fast' ? 'fast' : 'full'
const only = args.gate

const GATES = [
  { name: 'docs', script: 'check-docs.mjs', profiles: ['fast', 'full'] },
  { name: 'registry', script: 'check-registry.mjs', profiles: ['fast', 'full'] },
  { name: 'policy', script: 'check-policy.mjs', profiles: ['fast', 'full'] },
  { name: 'lint', script: 'check-lint.mjs', profiles: ['fast', 'full'] },
  { name: 'protected', script: 'check-protected.mjs', profiles: ['fast', 'full'] },
  { name: 'unit', script: 'run-tests.mjs', args: ['--level', 'unit'], profiles: ['fast', 'full'] },
  { name: 'types', script: 'check-types.mjs', profiles: ['full'] },
  { name: 'complexity', script: 'check-complexity.mjs', profiles: ['full'] },
  { name: 'duplication', script: 'check-duplication.mjs', profiles: ['full'] },
  { name: 'unused', script: 'check-unused.mjs', profiles: ['full'] },
  { name: 'integration', script: 'run-tests.mjs', args: ['--level', 'integration'], profiles: ['full'] },
  { name: 'e2e', script: 'run-tests.mjs', args: ['--level', 'e2e'], profiles: ['full'] },
  { name: 'sanitizers', script: 'check-sanitizers.mjs', profiles: ['full'] },
  { name: 'rules', script: 'check-rules.mjs', profiles: ['full'] },
  { name: 'scope', script: 'check-scope.mjs', profiles: ['full'] },
]

const selected = only ? GATES.filter((gate) => gate.name === only) : GATES.filter((gate) => gate.profiles.includes(profile))
if (!selected.length) {
  console.error(`没有匹配的门禁：${only || profile}`)
  process.exit(2)
}

const started = Date.now()
const results = []
for (const gate of selected) {
  console.log(`\n▶ ${gate.name}`)
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'ci', gate.script), ...(gate.args || [])], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  results.push({ name: gate.name, ok: result.status === 0, exit: result.status })
}

const failed = results.filter((item) => !item.ok)
const duration = ((Date.now() - started) / 1000).toFixed(1)
const summary = {
  profile: only ? `gate:${only}` : profile,
  ok: failed.length === 0,
  durationSeconds: Number(duration),
  results,
}

writeReport('summary', summary)
console.log(`\n${failed.length ? '✗' : '✓'} CI ${summary.profile}：${results.length - failed.length}/${results.length} 通过，${duration}s`)
if (failed.length) console.log(`  失败：${failed.map((item) => item.name).join(', ')}`)
process.exit(failed.length ? 1 : 0)
