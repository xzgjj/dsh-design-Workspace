// 内存检查关：检测是否需要 ASan/UBSan/TSan。
// 没有原生代码时诚实跳过；出现原生代码时，必须先配置并实际运行，不能假装通过。
import { spawnSync } from 'node:child_process'
import { finish, listFiles, loadPolicy, ROOT } from './lib/common.mjs'

const policy = loadPolicy()
const native = listFiles({ include: policy.sanitizers.nativePatterns })
const issues = []
const notes = []

if (!native.length) {
  finish('check-sanitizers', {
    ok: true,
    summary: ['未检测到 C/C++/Rust 源码或构建文件：不需要 ASan/UBSan/TSan'],
    skipped: ['纯 JS 项目，sanitizer 任务不适用；出现原生代码时会自动要求配置'],
  })
}

if (!policy.sanitizers.enabled) {
  finish('check-sanitizers', {
    ok: false,
    summary: [`检测到 ${native.length} 个原生文件，但 sanitizer 未启用`],
    issues: [
      `原生代码：${native.slice(0, 10).join(', ')}${native.length > 10 ? ' …' : ''}`,
      '在 ci/policy.json 打开 sanitizers.enabled，并配置 asan / ubsan / tsan 三条命令',
    ],
    metrics: { native: native.length },
  })
}

const commands = policy.sanitizers.commands || {}
for (const name of ['asan', 'ubsan', 'tsan']) {
  if (!commands[name]) issues.push(`sanitizers.commands.${name} 为空：必须给出可执行的构建+测试命令`)
}
if (issues.length) {
  finish('check-sanitizers', { ok: false, summary: [`原生文件 ${native.length} 个`], issues })
}

for (const name of ['asan', 'ubsan', 'tsan']) {
  const result = spawnSync(commands[name], { shell: true, cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) issues.push(`${name} 失败（exit ${result.status}）`)
  else notes.push(`${name} 通过`)
}

finish('check-sanitizers', {
  ok: issues.length === 0,
  summary: [`原生文件 ${native.length} 个；ASan / UBSan / TSan 已实际执行`],
  issues,
  notes,
  metrics: { native: native.length },
})
