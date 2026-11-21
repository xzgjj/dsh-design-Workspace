// 画布级存储：一块画布 = 一个交付物，目录 `.design-work/canvases/<id>/`。
// work.json v2 只记清单与指针，产物字节由技能直接写进同一目录。
// 本文件负责：围栏校验、v2 规范化、原子写、产物登记后的 primary 唯一性。
import { existsSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path'
import { ERR, REASON, opError, optionalString, requireInside, requireRelative, toPosix } from './contracts.js'
import { ensureDir, nowIso, readJson, statOf, writeJsonAtomic } from './fsx.js'

export const WORK_MARK = '.design-work'
export const WORK_FILE = 'work.json'
export const MAX_PAGES = 200

const KIND_BY_EXT = {
  '.html': 'web',
  '.htm': 'web',
  '.css': 'style',
  '.js': 'script',
  '.json': 'data',
  '.md': 'doc',
  '.docx': 'doc',
  '.pdf': 'deck',
  '.pptx': 'deck',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.xlsx': 'sheet',
  '.xls': 'sheet',
  '.csv': 'sheet',
  '.zip': 'bundle',
}

export function inferKind(rel) {
  return KIND_BY_EXT[extname(String(rel || '')).toLowerCase()] || 'file'
}

export function canvasDirOf(canvasFile) {
  return dirname(canvasFile)
}

// `<root>/.design-work/canvases/<id>/work.json` → 画布 id
function canvasIdOf(canvasFile) {
  return basename(canvasDirOf(canvasFile))
}

// 任何入口拿到的画布文件都先过这里：只认 canvases/<id>/work.json 的形状，且必须存在。
export function requireCanvasFile(value) {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(normalize(value))) {
    throw opError(ERR.BAD_ARGS, REASON.NOT_WORK_FILE, '需要画布 work.json 的绝对路径')
  }
  const file = normalize(value)
  const canvasDir = dirname(file)
  if (basename(file) !== WORK_FILE || basename(dirname(canvasDir)) !== 'canvases') {
    throw opError(ERR.BAD_ARGS, REASON.NOT_WORK_FILE, `不是画布 work.json：${file}`)
  }
  if (!existsSync(file)) throw opError(ERR.NOT_FOUND, REASON.NOT_WORK_FILE, `画布不存在：${file}`)
  return file
}

export function blankWork({ id, kind, title, at }) {
  const stamp = at || nowIso()
  return {
    v: 2,
    id: String(id || 'c-main'),
    kind: optionalString(kind, 40) || 'blank',
    title: optionalString(title, 80) || '未命名交付物',
    status: 'draft',
    primary: null,
    artifacts: [],
    ts: { createdAt: stamp, updatedAt: stamp },
  }
}

function pickText(value, max, fallback) {
  return optionalString(value, max) || fallback
}

function normalizeEntry(item) {
  if (!item || typeof item !== 'object' || typeof item.rel !== 'string' || !item.rel) return null
  const rel = toPosix(item.rel).replace(/^\.\//, '')
  return {
    rel,
    kind: pickText(item.kind, 40, inferKind(rel)),
    title: pickText(item.title, 120, basename(rel)),
    pages: Math.min(Math.max(1, Math.trunc(Number(item.pages) || 1)), MAX_PAGES),
    role: item.role === 'primary' ? 'primary' : 'support',
    bytes: Number.isFinite(item.bytes) ? Number(item.bytes) : 0,
    sha256: typeof item.sha256 === 'string' ? item.sha256 : '',
    at: typeof item.at === 'string' ? item.at : '',
    source: pickText(item.source, 40, 'file'),
  }
}

// 兼容 legacy v1 与画布 v2：旧字段 createdAt/updatedAt 收进 ts，缺 id/kind 用兜底填。
export function normalizeWork(raw, fallback = {}) {
  const at = nowIso()
  const base = blankWork({ id: fallback.id, kind: fallback.kind, title: fallback.title, at })
  if (!raw || typeof raw !== 'object') return base
  const artifacts = []
  const seen = new Set()
  for (const item of Array.isArray(raw.artifacts) ? raw.artifacts : []) {
    const entry = normalizeEntry(item)
    if (!entry || seen.has(entry.rel)) continue
    seen.add(entry.rel)
    artifacts.push(entry)
  }
  const primaryRel = typeof raw.primary === 'string' && seen.has(raw.primary) ? raw.primary : artifacts[0]?.rel || null
  for (const entry of artifacts) entry.role = entry.rel === primaryRel ? 'primary' : 'support'
  const created = raw.ts?.createdAt || raw.createdAt || at
  const updated = raw.ts?.updatedAt || raw.updatedAt || created
  return {
    v: 2,
    id: optionalString(raw.id, 80) || base.id,
    kind: optionalString(raw.kind, 40) || base.kind,
    title: optionalString(raw.title, 80) || base.title,
    status: optionalString(raw.status, 20) || 'draft',
    primary: primaryRel,
    artifacts,
    ts: { createdAt: created, updatedAt: updated },
  }
}

export function readWork(canvasFile, { required = true, key = {} } = {}) {
  const file = requireCanvasFile(canvasFile)
  const raw = readJson(file, null)
  if (!raw && required) throw opError(ERR.NOT_FOUND, REASON.NOT_WORK_FILE, `画布 work.json 不可读：${file}`)
  return normalizeWork(raw, { id: key.id || canvasIdOf(file), kind: key.kind, title: key.title })
}

export function writeWork(canvasFile, value, clock = nowIso) {
  const file = requireCanvasFile(canvasFile)
  const work = normalizeWork(value, { id: canvasIdOf(file) })
  work.ts.updatedAt = clock()
  writeJsonAtomic(file, work)
  return work
}

export function mutateWork(canvasFile, mutator, clock = nowIso) {
  const work = readWork(canvasFile)
  const next = mutator(work) || work
  return writeWork(canvasFile, next, clock)
}

export function createCanvasWork({ canvasDir, id, kind, title, at }) {
  ensureDir(join(canvasDir, 'artifacts'))
  const file = join(canvasDir, WORK_FILE)
  if (existsSync(file)) return { work: readWork(file, { key: { id, kind, title } }), file, created: false }
  const work = blankWork({ id, kind, title, at })
  writeJsonAtomic(file, work)
  return { work, file, created: true }
}

// rel → 画布内绝对路径；越界一律 FORBIDDEN + FENCE。
export function resolveCanvasRel(canvasFile, rel) {
  const clean = requireRelative(rel, 'rel')
  return requireInside(canvasDirOf(canvasFile), join(canvasDirOf(canvasFile), clean), 'rel')
}

function collectArtifacts(work, dir) {
  const artifacts = []
  for (const item of work.artifacts) {
    const full = join(dir, item.rel)
    if (!existsSync(full)) continue
    const info = statOf(full)
    const bytes = info ? info.size : item.bytes
    const mtimeMs = info ? info.mtimeMs : 0
    artifacts.push({ ...item, bytes, mtimeMs })
  }
  return artifacts
}

export function stateOf(canvasFile) {
  const file = requireCanvasFile(canvasFile)
  const work = readWork(file)
  const dir = canvasDirOf(file)
  const artifacts = collectArtifacts(work, dir)
  const primary = artifacts.find((item) => item.rel === work.primary)
  return {
    work,
    canvasFile: file,
    canvasDir: dir,
    artifacts,
    artifactsCount: artifacts.length,
    latest: artifacts[artifacts.length - 1] || null,
    primary: primary || null,
  }
}

// 门面工厂：把时钟注入与端口集中在一个对象上，测试可复现、可替换。
export function createStore({ clock = nowIso } = {}) {
  return {
    blankWork: (options = {}) => blankWork({ ...options, at: options.at || clock() }),
    createCanvasWork: (options = {}) => createCanvasWork({ ...options, at: options.at || clock() }),
    readWork,
    writeWork: (canvasFile, value) => writeWork(canvasFile, value, clock),
    mutateWork: (canvasFile, mutator) => mutateWork(canvasFile, mutator, clock),
    stateOf,
    requireCanvasFile,
    resolveCanvasRel,
    addArtifact,
    inferKind,
  }
}

// 单个产物登记：同 rel 覆盖、primary 唯一、第一件自动成为 primary。
export function addArtifact(work, entry) {
  const item = { ...entry, pages: Math.min(Math.max(1, Math.trunc(Number(entry.pages) || 1)), MAX_PAGES) }
  const index = work.artifacts.findIndex((existing) => existing.rel === item.rel)
  if (index >= 0) work.artifacts[index] = { ...work.artifacts[index], ...item }
  else work.artifacts.push(item)
  const wanted = item.role === 'primary' ? item.rel : work.primary
  work.primary = wanted && work.artifacts.some((existing) => existing.rel === wanted) ? wanted : work.primary
  if (!work.primary) work.primary = item.rel
  for (const existing of work.artifacts) existing.role = existing.rel === work.primary ? 'primary' : 'support'
  return work
}
