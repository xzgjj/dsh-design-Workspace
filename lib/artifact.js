// 产物登记：把技能已经写好的文件接进画布清单，不做生成、不做复制。
// 同一 rel 覆盖元信息；第一件自动成为 primary，后续显式 primary 会降级其它件。
import { basename } from 'node:path'
import { ERR, REASON, opError, optionalBoolean, optionalNumber, optionalString } from './contracts.js'
import { sha256File, statOf } from './fsx.js'
import {
  MAX_PAGES,
  addArtifact,
  inferKind,
  mutateWork,
  requireCanvasFile,
  resolveCanvasRel,
} from './store.js'

const DEFAULT_PORT = { mutateWork, requireCanvasFile, resolveCanvasRel, addArtifact }

export function createArtifact({ store = DEFAULT_PORT } = {}) {
  function register({ canvasFile, rel, kind, title, pages, source, role, primary }) {
    const file = store.requireCanvasFile(canvasFile)
    const full = store.resolveCanvasRel(file, rel)
    const info = statOf(full)
    if (!info || !info.isFile()) {
      throw opError(ERR.NOT_FOUND, REASON.NO_ARTIFACT, `产物文件不存在：${rel}`)
    }
    const cleanRel = String(rel).replace(/\\/g, '/').replace(/^\.\//, '')
    if (cleanRel === 'work.json') throw opError(ERR.BAD_ARGS, '', 'work.json 是画布索引，不能登记为产物')
    const entry = {
      rel: cleanRel,
      kind: optionalString(kind, 40) || inferKind(cleanRel),
      title: optionalString(title, 120) || basename(cleanRel),
      pages: optionalNumber(pages, { min: 1, max: MAX_PAGES, fallback: 1, name: 'pages' }),
      role: optionalString(role, 20) === 'primary' || optionalBoolean(primary) ? 'primary' : 'support',
      source: optionalString(source, 40) || 'file',
      bytes: info.size,
      sha256: sha256File(full),
      at: new Date().toISOString(),
    }
    const work = store.mutateWork(file, (current) => store.addArtifact(current, entry))
    const saved = work.artifacts.find((item) => item.rel === cleanRel) || entry
    return { canvasFile: file, artifact: saved, work, primary: work.primary }
  }
  return { register }
}

export const registerArtifact = createArtifact().register
