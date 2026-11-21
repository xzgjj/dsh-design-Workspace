// 测试注册表：docs/testing.md 是唯一事实来源。
// 这里只做机械解析与一致性校验；跑哪些测试由 scripts/ci/run-tests.mjs 按表执行。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, globToRegExp, listFiles, readText } from './common.mjs'

export const REGISTRY_PATH = 'docs/testing.md'
export const LEVELS = ['unit', 'integration', 'e2e']
export const RUNNERS = ['node']
const TEST_FILE_RE = /tests\/[\w./-]+\.test\.mjs/g

export function listTestFiles() {
  return listFiles({ include: ['tests/**/*.test.mjs'], roots: ['tests'] })
}

export function parseRegistry(text) {
  const lines = text.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => {
    const cells = splitRow(line)
    return cells.length === 5 && cells[0] === 'Scope' && cells[1] === 'Level' && cells[2] === 'Runner' && cells[3] === 'Args' && cells[4] === 'Metadata'
  })

  if (headerIndex < 0) {
    return { rows: [], errors: ['docs/testing.md 里找不到表头：| Scope | Level | Runner | Args | Metadata |'] }
  }

  const rows = []
  const errors = []
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line.startsWith('|')) break
    const cells = splitRow(line)
    if (cells.length !== 5) {
      errors.push(`第 ${i + 1} 行：表格需要 5 列，实际 ${cells.length} 列`)
      continue
    }
    const [scope, level, runner, args, metadata] = cells
    const files = [...args.matchAll(TEST_FILE_RE)].map((m) => m[0])
    rows.push({ line: i + 1, scope, level, runner, args, metadata, file: files[0] || '', files })
  }
  return { rows, errors }
}

function splitRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return []
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim().replace(/^`|`$/g, '').trim())
}

export function loadRegistry() {
  const path = join(ROOT, REGISTRY_PATH)
  if (!existsSync(path)) {
    return { rows: [], files: [], errors: [`缺少 ${REGISTRY_PATH}`], text: '' }
  }
  const text = readText(path)
  const parsed = parseRegistry(text)
  return { ...parsed, files: listTestFiles(), text }
}

export function validateRegistry(registry, policy) {
  const errors = [...registry.errors]
  const { rows, files } = registry
  const allowedTags = policy.registry?.metadataTags || []
  const minRows = policy.registry?.minRows || {}
  const seenFiles = new Map()

  for (const row of rows) {
    const where = `第 ${row.line} 行`
    if (!LEVELS.includes(row.level)) errors.push(`${where}：Level 只能是 ${LEVELS.join('/')}，实际 “${row.level}”`)
    if (!RUNNERS.includes(row.runner)) errors.push(`${where}：Runner 只能是 ${RUNNERS.join('/')}，实际 “${row.runner}”`)
    if (!row.file) errors.push(`${where}：Args 里没有 tests/**/*.test.mjs 路径`)
    if (row.files.length > 1) errors.push(`${where}：一行只登记一个测试文件`)
    if (!row.metadata) errors.push(`${where}：Metadata 不能为空`)
    for (const tag of row.metadata.split(',').map((t) => t.trim()).filter(Boolean)) {
      if (allowedTags.length && !allowedTags.includes(tag)) {
        errors.push(`${where}：未知 Metadata 标签 “${tag}”（允许：${allowedTags.join(', ')}）`)
      }
    }
    if (row.file) {
      if (!existsSync(join(ROOT, row.file))) errors.push(`${where}：测试文件不存在 ${row.file}`)
      if (seenFiles.has(row.file)) errors.push(`${where}：${row.file} 已在第 ${seenFiles.get(row.file)} 行登记`)
      else seenFiles.set(row.file, row.line)
    }
    if (row.scope && !scopeExists(row.scope)) errors.push(`${where}：Scope 在仓库里不存在 “${row.scope}”`)
  }

  for (const file of files) {
    if (!seenFiles.has(file)) errors.push(`未登记测试：${file}（必须在 docs/testing.md 表格里加一行）`)
  }

  for (const level of LEVELS) {
    const count = rows.filter((row) => row.level === level).length
    const floor = Number(minRows[level] ?? 0)
    if (count < floor) errors.push(`${level} 至少需要 ${floor} 行，当前 ${count} 行`)
  }

  return errors
}

function scopeExists(scope) {
  if (!scope) return false
  if (scope.includes('*')) {
    const re = globToRegExp(scope)
    return listFiles({ include: ['**/*'], roots: ['.'] }).some((file) => re.test(file))
  }
  return existsSync(join(ROOT, scope))
}
