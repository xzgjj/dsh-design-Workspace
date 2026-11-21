// 安装仓库自带 hooks（不写 ~/.gitconfig）。
import { spawnSync } from 'node:child_process'
import { ROOT } from './lib/common.mjs'

const set = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT, encoding: 'utf8' })
if (set.status !== 0) {
  console.error(set.stderr || 'git config 失败')
  process.exit(1)
}
const get = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8' })
console.log(`core.hooksPath = ${(get.stdout || '').trim()}`)
console.log('pre-commit 跑 fast 门禁，pre-push 跑 full 门禁。')
