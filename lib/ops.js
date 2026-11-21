// 唯一的 op 分发层：所有传输（HTTP、CLI、工具）都只走这一张表。
// 每个 op 是一个纯函数式的"入参 → 结果"，失败统一抛 OpError（6 码 + reason）。
import { CANVAS_MAX, canvasWorkFile, ensureProject, inspectProject, projectPath, readProject, removeCanvas, renameProject, selectCanvas, createCanvas } from './project.js'
import { stateOf } from './store.js'
import { registerArtifact } from './artifact.js'
import { listVersions, restoreCanvas, snapshotCanvas } from './versions.js'
import { exportCanvas } from './export.js'
import { ERR, OpError, requireString } from './contracts.js'

function projectByRoot({ root }) {
  const clean = requireString('root', root, 400)
  const file = projectPath(clean)
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
    return { project: readProject(requireString('projectFile', file, 400)), canvasLimit: CANVAS_MAX }
  },
  'canvas.create': (args) => createCanvas(args),
  'canvas.remove': (args) => removeCanvas(args),
  'canvas.state': (args) => stateOf(requireString('canvasFile', args.canvasFile, 400)),
  'canvas.wire': (args) => {
    const projectFile = requireString('projectFile', args.projectFile, 400)
    const canvasId = requireString('canvasId', args.canvasId, 40)
    return { canvasFile: canvasWorkFile(projectFile, canvasId) }
  },
  'artifact.register': (args) => registerArtifact(args),
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
