// 注册表关：docs/testing.md 与 tests/ 目录必须一一对应。
import { loadPolicy } from './lib/common.mjs'
import { loadRegistry, validateRegistry, LEVELS } from './lib/registry.mjs'
import { finish } from './lib/common.mjs'

const policy = loadPolicy()
const registry = loadRegistry()
const errors = validateRegistry(registry, policy)

const counts = Object.fromEntries(LEVELS.map((level) => [level, registry.rows.filter((row) => row.level === level).length]))
const summary = [
  `注册行 ${registry.rows.length} 条：${LEVELS.map((level) => `${level} ${counts[level]}`).join(' / ')}`,
  `仓库测试文件 ${registry.files.length} 个`,
]

finish('check-registry', {
  ok: errors.length === 0,
  summary,
  issues: errors,
  metrics: { rows: registry.rows.length, files: registry.files.length, ...counts },
})
