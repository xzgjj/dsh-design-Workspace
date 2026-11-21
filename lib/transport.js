// 传输层：对外只认 `scope{projectId,canvasId}` 或显式路径，内部一律换算成绝对路径。
// 单 op 分发 + 统一信封；HTTP 网关、CLI、测试共用这一层，不各自拼路径。
import { existsSync } from 'node:fs'
import { normalize } from 'node:path'
import { ERR, REASON, OpError, opError, optionalString, requireString } from './contracts.js'
import { canvasWorkFile, projectPath, readProject } from './project.js'
import { requireCanvasFile } from './store.js'

const CANVAS_OPS = new Set([
  'canvas.state',
  'artifact.register',
  'version.list',
  'version.snapshot',
  'version.restore',
  'export.run',
])

const PROJECT_OPS = new Set([
  'project.read',
  'project.inspect',
  'project.rename',
  'canvas.create',
  'canvas.remove',
  'project.select',
  'canvas.wire',
])

function scopeOf(args) {
  return args?.scope && typeof args.scope === 'object' ? args.scope : {}
}

function resolveProjectFile({ scope = {}, projectFile, root } = {}) {
  let file = ''
  if (projectFile) {
    file = normalize(requireString('projectFile', projectFile, 400))
    if (!existsSync(file)) throw opError(ERR.NOT_FOUND, '', `项目不存在：${file}`)
  } else {
    const cleanRoot = root ? requireString('root', root, 400) : optionalString(scope.root, 400)
    if (!cleanRoot) throw new OpError(ERR.BAD_ARGS, '需要 root、projectFile 或 scope 才能定位项目')
    file = projectPath(cleanRoot)
    if (!existsSync(file)) throw opError(ERR.NOT_FOUND, '', `项目还没建立：${cleanRoot}`)
  }
  if (scope.projectId) {
    const project = readProject(file)
    if (project.id !== scope.projectId) throw opError(ERR.NOT_FOUND, '', `项目 id 不匹配：${scope.projectId}`)
  }
  return file
}

function resolveCanvasFile({ scope = {}, canvasFile, projectFile, root, canvasId } = {}) {
  if (canvasFile) return requireCanvasFile(canvasFile)
  const file = resolveProjectFile({ scope, projectFile, root })
  const project = readProject(file)
  const target = optionalString(scope.canvasId, 40) || optionalString(canvasId, 40) || project.activeCanvasId
  const canvas = project.canvases.find((item) => item.id === target)
  if (!canvas) throw opError(ERR.NOT_FOUND, REASON.CANVAS_NOT_FOUND, `没有这块画布：${target}`)
  return canvasWorkFile(file, target)
}

// 把对外参数收敛成各 op 的冻结签名；未列出的 op 原样透传。
function normalizeArgs(op, rawArgs) {
  const args = { ...(rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) }
  const scope = scopeOf(args)
  if (op === 'project.ensure') {
    return { root: args.root || optionalString(scope.root, 400), title: args.title, kind: args.kind }
  }
  if (CANVAS_OPS.has(op)) {
    return { ...args, canvasFile: resolveCanvasFile({ scope, canvasFile: args.canvasFile, projectFile: args.projectFile, root: args.root, canvasId: args.canvasId }) }
  }
  if (PROJECT_OPS.has(op)) {
    const projectFile = resolveProjectFile({ scope, projectFile: args.projectFile, root: args.root })
    if (op === 'canvas.wire') {
      const canvasId = optionalString(scope.canvasId, 40) || optionalString(args.canvasId, 40)
      return { projectFile, canvasId }
    }
    if (op === 'project.select') return { ...args, projectFile, canvasId: optionalString(scope.canvasId, 40) || optionalString(args.canvasId, 40) }
    return { ...args, projectFile }
  }
  return args
}

export function errorEnvelope(err) {
  if (err instanceof OpError) {
    const envelope = { ok: false, code: err.code, message: err.message }
    if (err.reason) envelope.reason = err.reason
    return envelope
  }
  return { ok: false, code: ERR.INTERNAL, message: String(err?.message || err) }
}

export function httpStatus(envelope) {
  if (envelope.ok) return 200
  if (envelope.code === ERR.NOT_FOUND) return 404
  if (envelope.code === ERR.INTERNAL) return 500
  return 400
}

export function createTransport({ dispatch }) {  async function call(op, args) {
    try {
      const result = await dispatch(requireString('op', op, 80), normalizeArgs(op, args))
      return { ok: true, op, ...result }
    } catch (err) {
      return errorEnvelope(err)
    }
  }
  return { call }
}
