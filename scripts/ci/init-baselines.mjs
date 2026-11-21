// 首次引入专用：把当前状态固化为基线。之后改基线需要 baseline-relax 批准。
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT } from './lib/common.mjs'

const steps = [
  ['docs', 'check-docs.mjs'],
  ['complexity', 'check-complexity.mjs'],
  ['duplication', 'check-duplication.mjs'],
  ['unused', 'check-unused.mjs'],
  ['protected', 'check-protected.mjs'],
  ['policy', 'check-policy.mjs'],
]

for (const [name, script] of steps) {
  console.log(`\n▶ baseline · ${name}`)
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'ci', script), '--update-baseline'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error(`基线生成失败：${name}`)
    process.exit(result.status || 1)
  }
}

console.log('\n✓ 基线已写入 ci/baselines/ 与 ci/policy.baseline.json；之后跑 npm run ci 验证。')
