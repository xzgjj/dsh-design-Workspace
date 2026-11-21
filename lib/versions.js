// 版本管理：一次快照 = 整块画布的内容副本 + meta.json；恢复前自动存一版。
// 只保留最近 KEEP 版，永远不删最后一版。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ERR, OpError, optionalString, requireString } from './contracts.js'
import { copyTree, ensureDir, listTree, nowIso, readJson, removeTree, sha256Text, writeJsonAtomic } from './fsx.js'

const SNAPSHOT_DIR = 'snapshots'
const KEEP_VERSIONS = 20

function canvasFolder(canvasFile) {
  return dirname(canvasFile)
}

function snapshotsRoot(canvasFile) {
  const folder = canvasFolder(canvasFile)
  const design = dirname(dirname(folder))
  const canvasId = folder.split(/[\\/]/).pop()
  return join(design, SNAPSHOT_DIR, canvasId)
}

function digestFiles(dir) {
  const { files } = listTree(dir, { maxFiles: 500 })
  return files
    .filter((file) => file.rel !== 'meta.json')
    .map((file) => {
      const text = readFileSync(join(dir, file.rel))
      return { rel: file.rel, bytes: file.bytes, sha256: sha256Text(text) }
    })
}

function existingSeqs(root) {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .map((name) => Number(/^v(\d{3})$/.exec(name)?.[1] || 0))
    .filter((seq) => seq > 0)
    .sort((a, b) => a - b)
}

function pruneSequences(root, keep) {
  const seqs = existingSeqs(root)
  if (seqs.length <= keep) return []
  const drop = seqs.slice(0, seqs.length - keep)
  for (const seq of drop) removeTree(join(root, `v${String(seq).padStart(3, '0')}`))
  return drop.map((seq) => `v${String(seq).padStart(3, '0')}`)
}

export function snapshotCanvas({ canvasFile, label, source }) {
  const file = requireString('canvasFile', canvasFile, 400)
  if (!existsSync(file)) throw new OpError(ERR.NOT_FOUND, `画布不存在：${file}`)
  const folder = canvasFolder(file)
  const root = snapshotsRoot(file)
  ensureDir(root)
  const seq = (existingSeqs(root).pop() || 0) + 1
  if (seq > 999) throw new OpError(ERR.LIMIT, '单块画布版本号已到上限（999）')
  const id = `v${String(seq).padStart(3, '0')}`
  const dir = join(root, id)
  ensureDir(dir)
  const copied = copyTree(folder, dir, { skip: ['meta.json'] })
  const meta = {
    v: 1,
    id,
    seq,
    at: nowIso(),
    canvasId: folder.split(/[\\/]/).pop(),
    label: optionalString(label, 60) || '手动存档',
    source: optionalString(source, 20) || 'manual',
    files: digestFiles(dir),
    fileCount: copied.length,
  }
  writeJsonAtomic(join(dir, 'meta.json'), meta)
  const pruned = pruneSequences(root, KEEP_VERSIONS)
  return { version: meta, dir, pruned }
}

export function listVersions(canvasFile) {
  const file = requireString('canvasFile', canvasFile, 400)
  const root = snapshotsRoot(file)
  const versions = existingSeqs(root)
    .map((seq) => readJson(join(root, `v${String(seq).padStart(3, '0')}`, 'meta.json'), null))
    .filter(Boolean)
    .sort((a, b) => b.seq - a.seq)
  return { canvasFile: file, versions, latest: versions[0] || null, total: versions.length }
}

export function restoreCanvas({ canvasFile, versionId }) {
  const file = requireString('canvasFile', canvasFile, 400)
  if (!existsSync(file)) throw new OpError(ERR.NOT_FOUND, `画布不存在：${file}`)
  const root = snapshotsRoot(file)
  const target = requireString('versionId', versionId, 40)
  const dir = join(root, target)
  const meta = readJson(join(dir, 'meta.json'), null)
  if (!meta) throw new OpError(ERR.NOT_FOUND, `没有这个版本：${target}`)
  if (!Array.isArray(meta.files) || !meta.files.length) throw new OpError(ERR.CONFLICT, `版本内容为空：${target}`)
  const before = snapshotCanvas({ canvasFile: file, label: `恢复 ${target} 前的自动存档`, source: 'pre-restore' })
  const folder = canvasFolder(file)
  removeTree(folder)
  ensureDir(folder)
  copyTree(dir, folder, { skip: ['meta.json'] })
  const work = readJson(join(folder, 'work.json'), null) || { v: 2, id: meta.canvasId }
  work.updatedAt = nowIso()
  work.status = 'draft'
  writeJsonAtomic(join(folder, 'work.json'), work)
  return { restored: target, before: before.version.id, work }
}
