// 按注册表执行测试；CI 与本地都走这一条路径。
import { spawnSync } from 'node:child_process'
import { finish, loadPolicy, ROOT } from './lib/common.mjs'
import { loadRegistry, validateRegistry, LEVELS } from './lib/registry.mjs'

const policy = loadPolicy()
const registry = loadRegistry()
const registryErrors = validateRegistry(registry, policy)
if (registryErrors.length) {
  finish('run-tests', { ok: false, summary: ['注册表不一致，未执行任何测试'], issues: registryErrors })
}

const level = process.argv.find((arg, index) => process.argv[index - 1] === '--level')
const rows = level ? registry.rows.filter((row) => row.level === level) : registry.rows

if (level && !LEVELS.includes(level)) {
  finish('run-tests', { ok: false, summary: [`未知层级 ${level}`], issues: [`Level 只能是 ${LEVELS.join('/')}`] })
}

if (!rows.length) {
  finish('run-tests', {
    ok: true,
    summary: [`${level || '全部'}：没有注册用例，跳过（目标层级最低行数已由 check-registry 把关）`],
    skipped: [`${level} 暂无登记测试`],
  })
}

const results = []
const issues = []
for (const row of rows) {
  const argv = row.args.split(/\s+/).filter(Boolean)
  const started = Date.now()
  const result = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
  const duration = Date.now() - started
  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (output.trim()) process.stdout.write(output.trimEnd() + '\n')

  const pass = Number((output.match(/^# pass (\d+)/m) || [])[1] || 0)
  const fail = Number((output.match(/^# fail (\d+)/m) || [])[1] || 0)
  const ok = result.status === 0
  results.push({ file: row.file, level: row.level, ok, pass, fail, duration, exit: result.status })
  if (!ok) issues.push(`${row.file} 失败（exit ${result.status}，TAP fail ${fail}）`)
  if (result.error) issues.push(`${row.file} 执行错误：${result.error.message}`)
}

const passed = results.filter((item) => item.ok).length
const totalPass = results.reduce((sum, item) => sum + item.pass, 0)
const totalFail = results.reduce((sum, item) => sum + item.fail, 0)
const summary = [
  `${level || '全部'}：${passed}/${results.length} 个文件通过，TAP ${totalPass} pass / ${totalFail} fail`,
  results.map((item) => `${item.ok ? '✓' : '✗'} ${item.file} (${item.pass}p/${item.fail}f, ${item.duration}ms)`).join('  '),
]

finish('run-tests', {
  ok: issues.length === 0,
  summary,
  issues,
  metrics: { level: level || 'all', files: results.length, pass: totalPass, fail: totalFail, results },
})
