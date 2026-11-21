// CI 公共库：路径、Git、文件遍历、报告、批准记录。
// 原则：零第三方依赖，所有判定都基于仓库里的实际文件与 Git 事实。
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
export const CI_DIR = join(ROOT, 'ci')
export const REPORT_DIR = join(ROOT, 'reports', 'ci')
export const POLICY_PATH = join(CI_DIR, 'policy.json')

const SKIP_DIRS = new Set(['.git', 'node_modules', 'reports', 'dist', '.design-work'])

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) {
      out._.push(item)
      continue
    }
    const key = item.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i += 1
    } else {
      out[key] = true
    }
  }
  return out
}

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

export function readText(path) {
  return readFileSync(path, 'utf8')
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

// 文本哈希先统一换行符，避免 Windows 检出 CRLF 后受保护测试全部“被修改”。
export function sha256Text(value) {
  return sha256(String(value).replace(/\r\n/g, '\n'))
}

export function refHasFile(ref, file) {
  return git(['cat-file', '-e', `${ref}:${file}`], { allowFail: true }).status === 0
}

export function shortSha(value) {
  return sha256(value).slice(0, 16)
}

export function rel(path) {
  return relative(ROOT, path).replace(/\\/g, '/')
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

// 只实现 CI 需要的 glob：* / ? / **（含 **/ 匹配零层目录）。
export function globToRegExp(glob) {
  let source = glob.replace(/\\/g, '/')
  source = source.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  source = source.replace(/\*\*\//g, '\u0001')
  source = source.replace(/\*\*/g, '\u0002')
  source = source.replace(/\*/g, '[^/]*')
  source = source.replace(/\?/g, '[^/]')
  source = source.replace(/\u0001/g, '(?:.*/)?')
  source = source.replace(/\u0002/g, '.*')
  return new RegExp(`^${source}$`)
}

export function matchesAny(relPath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(relPath))
}

export function listFiles({ include, exclude = [], roots = ['.'] } = {}) {
  const includeRes = include.map(globToRegExp)
  const excludeRes = exclude.map(globToRegExp)
  const result = []

  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      const path = rel(full)
      if (excludeRes.some((re) => re.test(path))) continue
      if (!includeRes.some((re) => re.test(path))) continue
      result.push(path)
    }
  }

  for (const root of roots) walk(resolve(ROOT, root))
  return result.sort()
}

export function git(args, { allowFail = false } = {}) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} 失败：${(result.stderr || result.stdout || '').trim()}`)
  }
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() }
}

export function currentAuthor() {
  return process.env.PR_AUTHOR || process.env.GITHUB_ACTOR || 'local'
}

export function ciEvent() {
  return process.env.CI_EVENT || (process.env.GITHUB_EVENT_NAME || '')
}

export function prLabels() {
  return (process.env.PR_LABELS || '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)
}

// 读取改动：CI 用 base...HEAD；本地 hook 可用 --staged。
export function changedFiles({ base, staged = false } = {}) {
  const args = staged
    ? ['diff', '--cached', '--numstat', '--find-renames']
    : base
      ? ['diff', `${base}...HEAD`, '--numstat', '--find-renames']
      : []
  if (!args.length) return { mode: 'none', files: [] }

  const { stdout } = git(args, { allowFail: true })
  const files = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const [addedRaw, deletedRaw, ...pathParts] = line.split('\t')
    let path = pathParts.join('\t')
    const arrow = path.lastIndexOf(' => ')
    if (arrow > -1) path = path.slice(arrow + 4)
    path = path.replace(/^"|"$/g, '')
    files.push({
      path: path.replace(/\\/g, '/'),
      added: addedRaw === '-' ? 0 : Number(addedRaw),
      deleted: deletedRaw === '-' ? 0 : Number(deletedRaw),
    })
  }
  return { mode: staged ? 'staged' : 'base', base, files }
}

export function findApproval({ kinds, path = '', label = '', allowBootstrap = false } = {}) {
  const dir = join(CI_DIR, 'approvals')
  if (!existsSync(dir)) return null
  const author = currentAuthor()
  const labels = prLabels()
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const record = readJson(join(dir, name))
    if (!record) continue
    const recordKinds = Array.isArray(record.kinds) ? record.kinds : [record.kind].filter(Boolean)
    if (!kinds.some((kind) => recordKinds.includes(kind))) continue
    if (record.bootstrap && !allowBootstrap) continue
    if (record.expires && record.expires < today()) continue
    if (record.paths && path && !record.paths.includes(path)) continue
    if (record.approvedBy && record.approvedBy === author) continue
    if (label && ciEvent() === 'pull_request' && labels.length && !labels.includes(label)) continue
    if (label && ciEvent() === 'pull_request' && !labels.length) continue
    return record
  }
  return null
}

// 基线只能首次建立；之后改写必须有人批准“放宽”。
export function guardBaselineWrite(file, updating) {
  if (!updating || !existsSync(file)) return
  const approval = findApproval({ kinds: ['baseline-relax'], path: rel(file) })
  if (!approval) {
    throw new Error(`基线已存在：${rel(file)}。放宽基线需要 ci/approvals/ 里的 baseline-relax 批准记录。`)
  }
}

export function writeReport(name, payload) {
  mkdirSync(REPORT_DIR, { recursive: true })
  writeJson(join(REPORT_DIR, `${name}.json`), payload)
}

export function finish(name, { ok, summary = [], issues = [], notes = [], skipped = [], metrics = {} }) {
  const payload = {
    gate: name,
    ok,
    at: new Date().toISOString(),
    summary,
    issues,
    notes,
    skipped,
    metrics,
  }
  writeReport(name, payload)

  console.log(`\n── ${name} ${'─'.repeat(Math.max(2, 46 - name.length))}`)
  for (const line of summary) console.log(`  ${line}`)
  for (const note of notes) console.log(`  · ${note}`)
  for (const skip of skipped) console.log(`  ~ skip: ${skip}`)
  if (issues.length) {
    console.log(`  ✗ FAIL (${issues.length})`)
    for (const issue of issues.slice(0, 30)) console.log(`    - ${issue}`)
    if (issues.length > 30) console.log(`    … 另有 ${issues.length - 30} 条，见 reports/ci/${name}.json`)
  } else {
    console.log('  ✓ PASS')
  }
  process.exit(ok ? 0 : 1)
}

export function assert(condition, message, issues) {
  if (!condition) issues.push(message)
}

export function loadPolicy() {
  return readJson(POLICY_PATH)
}
