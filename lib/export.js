// 导出：html 复制整块画布到 export/<canvasId>/<stamp>/site/；pdf/png 走无头浏览器。
// 失败清理半截目录；export/ 永远不回流产物清单（它在画布目录之外）。
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { ERR, opError, optionalString } from './contracts.js'
import { copyTree, ensureDir, nowIso, removeTree, writeJsonAtomic } from './fsx.js'
import { readWork, requireCanvasFile } from './store.js'
import { createRenderer } from './renderer.js'

const EXPORT_DIR = 'export'
export const FORMATS = ['html', 'pdf', 'png']

function stampOf(input) {
  const clean = optionalString(input, 40).replace(/[^0-9A-Za-z-]/g, '')
  if (clean) return clean
  return nowIso().replace(/[-:T]/g, '').slice(0, 12)
}

function safeName(title, fallback = 'deliverable') {
  const clean = String(title || '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return clean || fallback
}

function canvasDirOf(canvasFile) {
  return dirname(canvasFile)
}

function designDirOf(canvasFile) {
  return dirname(dirname(canvasDirOf(canvasFile)))
}

function pickHtmlEntry(work, canvasPath) {
  const html = work.artifacts.filter((item) => extname(item.rel).toLowerCase() === '.htm' || extname(item.rel).toLowerCase() === '.html')
  const preferred = html.find((item) => item.rel === work.primary) || html[0]
  if (preferred && existsSync(join(canvasPath, preferred.rel))) return preferred.rel
  if (existsSync(join(canvasPath, 'index.html'))) return 'index.html'
  return ''
}

export function createExport({ store = { requireCanvasFile, readWork }, renderer = createRenderer() } = {}) {
  async function run({ canvasFile, format, stamp }) {
    const file = store.requireCanvasFile(canvasFile)
    const cleanFormat = (optionalString(format, 10) || 'html').toLowerCase()
    if (!FORMATS.includes(cleanFormat)) throw opError(ERR.BAD_ARGS, '', `不支持的导出格式：${cleanFormat}（只做 ${FORMATS.join('/')}）`)
    const canvasPath = canvasDirOf(file)
    const work = store.readWork(file)
    const canvasId = basename(canvasPath)
    const rootDir = join(designDirOf(file), EXPORT_DIR, canvasId, stampOf(stamp))
    const manifestPath = join(rootDir, 'manifest.json')
    if (existsSync(rootDir)) removeTree(rootDir)
    ensureDir(rootDir)
    try {
      const result = cleanFormat === 'html' ? exportHtml({ canvasPath, rootDir }) : await exportRender({ canvasPath, work, canvasId, rootDir, format: cleanFormat, renderer })
      const manifest = {
        v: 1,
        at: nowIso(),
        canvasId,
        title: work.title,
        format: cleanFormat,
        entry: result.entry,
        files: result.files,
        fileCount: result.files.length,
      }
      writeJsonAtomic(manifestPath, manifest)
      return { dir: rootDir, format: cleanFormat, entry: result.entry, files: result.files, fileCount: result.files.length, manifest }
    } catch (err) {
      removeTree(rootDir)
      throw err
    }
  }
  return { run }
}

function exportHtml({ canvasPath, rootDir }) {
  const siteDir = join(rootDir, 'site')
  ensureDir(siteDir)
  const copied = copyTree(canvasPath, siteDir, { skip: ['work.json'] })
  const work = readWork(join(canvasPath, 'work.json'), { required: false })
  const entry = pickHtmlEntry(work, canvasPath)
  return {
    entry: entry ? `site/${entry.replaceAll('\\', '/')}` : '',
    files: copied.map((file) => `site/${file.replaceAll('\\', '/')}`),
  }
}

async function exportRender({ canvasPath, work, canvasId, rootDir, format, renderer }) {
  const entry = pickHtmlEntry(work, canvasPath)
  if (!entry) throw opError(ERR.BAD_ARGS, '', `${format} 导出需要一块 html 产物作为渲染入口`)
  const name = `${safeName(work.title, canvasId)}.${format}`
  const outFile = join(rootDir, name)
  await renderer.render({ format, file: join(canvasPath, entry), outFile })
  return { entry: name, files: [name] }
}

const defaultExport = createExport()

export function exportCanvas(args) {
  return defaultExport.run(args)
}
