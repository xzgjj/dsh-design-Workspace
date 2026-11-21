// 文件与 JSON 的小工具：原子写、目录树列举、整树复制、整树移动。
// 只做"安全落盘"这一件事，被 project / store / artifact / versions / export 共用。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}

export function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

// tmp + rename：半截文件永远不可见（同 media-desk src/store.js L92 的做法）。
export function writeJsonAtomic(file, value) {
  ensureDir(dirname(file))
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex')
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function nowIso() {
  return new Date().toISOString()
}

export function statOf(file) {
  try {
    return statSync(file)
  } catch {
    return null
  }
}

export function slugify(text, fallback = 'work') {
  const ascii = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return ascii || fallback
}

const SKIP_NAMES = new Set(['node_modules', 'snapshots', 'export'])

function walk(dir, base, depth, out, budget) {
  if (depth > budget.maxDepth || out.length >= budget.maxFiles) return
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || SKIP_NAMES.has(name)) continue
    const full = join(dir, name)
    let info
    try {
      info = statSync(full)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      walk(full, base, depth + 1, out, budget)
      continue
    }
    out.push({
      rel: full.slice(base.length + 1).replace(/\\/g, '/'),
      ext: extname(name).toLowerCase(),
      bytes: info.size,
      mtimeMs: info.mtimeMs,
    })
  }
}

export function listTree(dir, options = {}) {
  const budget = { maxFiles: options.maxFiles || 300, maxDepth: options.maxDepth || 4 }
  if (!existsSync(dir)) return { files: [], truncated: false }
  const files = []
  walk(dir, dir, 0, files, budget)
  return { files, truncated: files.length >= budget.maxFiles }
}

function copyOne(src, dst) {
  ensureDir(dirname(dst))
  writeFileSync(dst, readFileSync(src))
}

export function copyFile(src, dst) {
  copyOne(src, dst)
  return dst
}

export function copyTree(srcDir, dstDir, options = {}) {
  if (!existsSync(srcDir)) return []
  const skip = new Set(options.skip || ['work.json'])
  const { files } = listTree(srcDir, { maxFiles: options.maxFiles || 500, maxDepth: 4 })
  const copied = []
  for (const file of files) {
    if (skip.has(file.rel)) continue
    copyOne(join(srcDir, file.rel), join(dstDir, file.rel))
    copied.push(file.rel)
  }
  return copied
}

export function removeTree(dir) {
  rmSync(dir, { recursive: true, force: true })
}


