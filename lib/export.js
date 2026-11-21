// 导出：把画布当前内容整树复制到 export/<canvasId>/<stamp>/，附一份 manifest。
// P0 只做"原样导出"，HTML/PDF/PNG 的真实转换放到预览导出模块（本文件不引第三方）。
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ERR, OpError, optionalString, requireString } from './contracts.js'
import { copyTree, ensureDir, nowIso, readJson, removeTree, writeJsonAtomic } from './fsx.js'

const EXPORT_DIR = 'export'

function stampOf(input) {
  if (optionalString(input, 40)) return String(input).replace(/[^0-9A-Za-z-]/g, '')
  return nowIso().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

export function exportCanvas({ canvasFile, stamp }) {
  const file = requireString('canvasFile', canvasFile, 400)
  if (!existsSync(file)) throw new OpError(ERR.NOT_FOUND, `画布不存在：${file}`)
  const folder = dirname(file)
  const design = dirname(dirname(folder))
  const canvasId = folder.split(/[\\/]/).pop()
  const dir = join(design, EXPORT_DIR, canvasId, stampOf(stamp))
  if (existsSync(dir)) removeTree(dir)
  ensureDir(dir)
  const files = copyTree(folder, dir, { skip: ['work.json'] })
  const work = readJson(file, null) || {}
  const manifest = { v: 1, at: nowIso(), canvasId, title: work.title || '', source: file, files, fileCount: files.length }
  writeJsonAtomic(join(dir, 'manifest.json'), manifest)
  return { dir, files, fileCount: files.length, manifest }
}
