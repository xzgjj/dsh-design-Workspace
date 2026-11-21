// 唯一的 op 分发层：所有传输（HTTP、工具）都只走这一张表。
// 每个 op 是一个纯函数式的"入参 → 结果"，失败统一抛 OpError。
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { ERR, OpError, requireString } from './contracts.js'
import { listTree, readJson } from './fsx.js'
import {
  createCanvas,
  ensureProject,
  inspectProject,
  projectPath,
  readProject,
  removeCanvas,
  renameProject,
  selectCanvas,
  canvasWorkFile,
} from './project.js'
import { listVersions, restoreCanvas, snapshotCanvas } from './versions.js'
import { exportCanvas } from './export.js'

function readCanvasState({ canvasFile }) {
  const file = requireString('canvasFile', canvasFile, 400)
  if (!existsSync(file)) throw new OpError(ERR.NOT_FOUND, `画布不存在：${file}`)
  const work = readJson(file, null)
  if (!work) throw new OpError(ERR.NOT_FOUND, '画布 work.json 不可读')
  const tree = listTree(dirname(file))
  const artifacts = tree.files.filter((item) => item.rel !== 'work.json')
  return {
    work,
    canvasFile: file,
    artifacts,
    artifactsCount: artifacts.length,
    latest: artifacts[0] || null,
  }
}

function projectByRoot({ root }) {
  const clean = requireString('root', root, 400)
  const file = projectPath(clean)
  if (!existsSync(file)) throw new OpError(ERR.NOT_FOUND, `项目还没建立：${clean}`)
  return { projectFile: file }
}

const HANDLERS = {
  'project.ensure': (args) => ensureProject(args),
  'project.inspect': (args) => {
    const file = args.projectFile || projectByRoot(args).projectFile
    return inspectProject(requireString('projectFile', file, 400))
  },
  'project.select': (args) => selectCanvas(args),
  'project.rename': (args) => renameProject(args),
  'project.read': (args) => {
    const file = args.projectFile || projectByRoot(args).projectFile
    return { project: readProject(requireString('projectFile', file, 400)) }
  },
  'canvas.create': (args) => createCanvas(args),
  'canvas.remove': (args) => removeCanvas(args),
  'canvas.state': (args) => readCanvasState(args),
  'canvas.wire': (args) => {
    const projectFile = requireString('projectFile', args.projectFile, 400)
    const canvasId = requireString('canvasId', args.canvasId, 40)
    return { canvasFile: canvasWorkFile(projectFile, canvasId) }
  },
  'version.list': (args) => listVersions(args),
  'version.snapshot': (args) => snapshotCanvas(args),
  'version.restore': (args) => restoreCanvas(args),
  'export.run': (args) => exportCanvas(args),
}

export const OPS = Object.keys(HANDLERS)

export async function dispatch(op, args) {
  const handler = HANDLERS[op]
  if (!handler) throw new OpError(ERR.BAD_ARGS, `未知 op：${String(op)}`)
  const payload = args && typeof args === 'object' ? args : {}
  return handler(payload)
}
