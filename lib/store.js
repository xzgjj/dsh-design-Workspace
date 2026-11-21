// 交付物存储：一个会话一个交付物，交付物落在 `<root>/.design-work/`。
// 这里只有"读状态 + 建空工作台"两件事，不做项目库、不做作品索引、不做页模型。
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, basename, extname, isAbsolute, normalize } from 'node:path'

export const WORK_MARK = '.design-work'
export const WORK_FILE = 'work.json'

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
  '.zip': 'bundle',
}

export function isWorkFile(input) {
  if (typeof input !== 'string' || !input) return false
  const p = normalize(input)
  if (!isAbsolute(p)) return false
  return basename(p) === WORK_FILE && basename(dirname(p)) === WORK_MARK
}

export function workRoot(workFile) {
  return dirname(dirname(workFile))
}

function slug(title) {
  const ascii = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return ascii || 'work'
}

export function createWork({ root, title }) {
  if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('root 必须是绝对路径')
  if (!existsSync(root)) throw new Error(`目录不存在：${root}`)
  const dir = join(root, WORK_MARK)
  const file = join(dir, WORK_FILE)
  mkdirSync(join(dir, 'artifacts'), { recursive: true })
  if (!existsSync(file)) {
    const now = new Date().toISOString()
    const work = {
      v: 1,
      id: `${slug(title)}-${now.slice(0, 10).replace(/-/g, '')}`,
      title: String(title || '未命名交付物'),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      artifacts: [],
    }
    writeFileSync(file, JSON.stringify(work, null, 2) + '\n', 'utf8')
    return { work, file, created: true }
  }
  return { work: JSON.parse(readFileSync(file, 'utf8')), file, created: false }
}

function listFiles(dir, base, depth, out) {
  if (depth > 3 || out.length >= 200) return
  for (const name of readdirSync(dir)) {
    if (name === WORK_MARK || name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) listFiles(full, base, depth + 1, out)
    else if (st.isFile()) {
      const rel = full.slice(base.length + 1).replace(/\\/g, '/')
      out.push({
        rel,
        name,
        ext: extname(name).toLowerCase(),
        kind: KIND_BY_EXT[extname(name).toLowerCase()] || 'file',
        size: st.size,
        mtime: st.mtimeMs,
      })
    }
  }
}

export function readState(workFile) {
  if (!isWorkFile(workFile)) throw new Error('不是合法的交付物文件（需为 <root>/.design-work/work.json）')
  if (!existsSync(workFile)) throw new Error('交付物不存在')
  const work = JSON.parse(readFileSync(workFile, 'utf8'))
  const root = workRoot(workFile)
  const artifacts = []
  listFiles(root, root, 0, artifacts)
  artifacts.sort((a, b) => b.mtime - a.mtime)
  return {
    ok: true,
    work,
    root,
    workFile,
    artifacts,
    artifactsCount: artifacts.length,
    latest: artifacts[0] || null,
  }
}
