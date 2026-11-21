import { test } from 'node:test'
import assert from 'node:assert/strict'
import { globToRegExp, loadPolicy } from '../../scripts/ci/lib/common.mjs'
import { loadRegistry, validateRegistry, listTestFiles } from '../../scripts/ci/lib/registry.mjs'
import { stripCommentsAndStrings } from '../../scripts/ci/lib/js-scan.mjs'

test('glob：**/ 匹配零层与多层目录', () => {
  const re = globToRegExp('**/*.test.mjs')
  assert.equal(re.test('store.test.mjs'), true)
  assert.equal(re.test('integration/host-api.test.mjs'), true)
  assert.equal(re.test('lib/store.js'), false)

  const libRe = globToRegExp('lib/**')
  assert.equal(libRe.test('lib/store.js'), true)
  assert.equal(libRe.test('lib/nested/a.js'), true)
  assert.equal(libRe.test('scripts/lib.js'), false)
})

test('注册表可解析且与 tests/ 目录一致', () => {
  const policy = loadPolicy()
  const registry = loadRegistry()
  const errors = validateRegistry(registry, policy)
  assert.deepEqual(errors, [])
  assert.equal(registry.rows.length, registry.files.length)
  assert.ok(registry.files.length >= 4)
  assert.ok(registry.rows.every((row) => row.file && row.args.includes(row.file)))
})

test('遗漏登记会产生明确失败', () => {
  const policy = loadPolicy()
  const registry = loadRegistry()
  const removed = registry.rows[0]
  const errors = validateRegistry({ ...registry, rows: registry.rows.slice(1), errors: [] }, policy)
  assert.ok(errors.some((error) => error.includes(`未登记测试：${removed.file}`)))
})

test('元数据标签受 policy 约束', () => {
  const policy = loadPolicy()
  const registry = loadRegistry()
  const row = { ...registry.rows[0], metadata: 'fast, whatever' }
  const errors = validateRegistry({ ...registry, rows: [row], errors: [] }, policy)
  assert.ok(errors.some((error) => error.includes('whatever')))
})

test('扫描器去掉注释与字符串，保留代码行号', () => {
  const code = `const a = "eval("\n// debugger\nconst b = 1`
  const stripped = stripCommentsAndStrings(code)
  assert.equal(stripped.includes('eval'), false)
  assert.equal(stripped.includes('debugger'), false)
  assert.equal(stripped.split('\n').length, 3)
})

test('测试文件都在 tests/ 下，不被工具目录误收', () => {
  const files = listTestFiles()
  assert.ok(files.length >= 4)
  assert.ok(files.every((file) => file.startsWith('tests/')))
  assert.equal(files.includes('tests/e2e/README.md'), false)
})
