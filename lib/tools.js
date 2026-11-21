// 模型可见的工具面（5 个）。工具只登记/查询/转发，内容由技能写文件。
// 入参里的路径由 transport 负责换算；这里不生成内容、不直接写盘。
import { canvasWorkFile, createCanvas, ensureProject } from './project.js'
import { stateOf } from './store.js'
import { registerArtifact } from './artifact.js'
import { exportCanvas } from './export.js'

const text = (value) => [{ type: 'text', text: value }]

function paramsOf(properties, required) {
  return { type: 'object', additionalProperties: false, required, properties }
}

function outputOf(properties, required, render) {
  return { schema: paramsOf(properties, required), render }
}

const CANVAS_FILE = { type: 'string', description: '画布 work.json 的绝对路径' }
const ROOT = { type: 'string', description: '当前会话工作区的绝对路径（会话 cwd）' }
const TITLE = { type: 'string', description: '交付物标题，一句话' }
const KIND = { type: 'string', description: '交付物类型：web / deck / doc / sheet' }

export const workStartTool = {
  name: 'design_work_start',
  description:
    '在当前工作区确保项目与当前画布存在（.design-work/project.json + canvases/<id>/work.json），返回画布绝对路径。之后把产物写进画布目录，再用 design_work_add_artifact 登记。',
  parameters: paramsOf({ root: ROOT, title: TITLE, kind: KIND }, ['root', 'title']),
  timeoutMs: 30_000,
  output: outputOf(
    {
      projectId: { type: 'string' },
      projectFile: { type: 'string' },
      canvasId: { type: 'string' },
      canvasFile: { type: 'string' },
      root: { type: 'string' },
      created: { type: 'boolean' },
      migrated: { type: 'boolean' },
    },
    ['projectId', 'projectFile', 'canvasId', 'canvasFile', 'root', 'created'],
    (_args, v) => text(`交付物就绪：${v.canvasFile}\n把产物写进 ${v.root} 的画布目录，画布会跟着刷新。`),
  ),
  async execute(args) {
    for (const key of ['root', 'title']) {
      if (typeof args?.[key] !== 'string' || !args[key].trim()) throw new Error(`缺少 ${key}`)
    }
    const ensured = ensureProject({ root: args.root, title: args.title, kind: args.kind })
    const canvasId = ensured.project.activeCanvasId
    return {
      projectId: ensured.project.id,
      projectFile: ensured.projectFile,
      canvasId,
      canvasFile: canvasWorkFile(ensured.projectFile, canvasId),
      root: args.root,
      created: ensured.created,
      migrated: Boolean(ensured.migrated),
    }
  },
}

const ADD_ARTIFACT_OUTPUT = outputOf(
  {
    rel: { type: 'string' },
    kind: { type: 'string' },
    title: { type: 'string' },
    pages: { type: 'number' },
    role: { type: 'string' },
    primary: { type: 'string' },
    artifactsCount: { type: 'number' },
  },
  ['rel', 'kind', 'title', 'pages', 'role', 'primary', 'artifactsCount'],
  (_args, v) => text(`已登记 ${v.title}（${v.rel}，${v.kind}，${v.pages} 页）；主产物 ${v.primary || '无'}。`),
)

export const addArtifactTool = {
  name: 'design_work_add_artifact',
  description: '把已经写进画布目录的文件登记进画布清单（同 rel 覆盖元信息，第一件自动成为主产物）。文件必须已存在。',
  parameters: paramsOf(
    {
      canvasFile: CANVAS_FILE,
      rel: { type: 'string', description: '相对画布目录的文件路径，例如 index.html' },
      kind: KIND,
      title: { type: 'string', description: '产物显示名' },
      pages: { type: 'number', description: '页数，默认 1' },
      primary: { type: 'boolean', description: '是否设为主产物' },
    },
    ['canvasFile', 'rel'],
  ),
  timeoutMs: 10_000,
  output: ADD_ARTIFACT_OUTPUT,
  async execute(args) {
    const saved = registerArtifact(args)
    return {
      rel: saved.artifact.rel,
      kind: saved.artifact.kind,
      title: saved.artifact.title,
      pages: saved.artifact.pages,
      role: saved.artifact.role,
      primary: saved.primary || '',
      artifactsCount: saved.work.artifacts.length,
    }
  },
}

const NEW_CANVAS_OUTPUT = outputOf(
  {
    canvasId: { type: 'string' },
    canvasFile: { type: 'string' },
    title: { type: 'string' },
    kind: { type: 'string' },
  },
  ['canvasId', 'canvasFile', 'title', 'kind'],
  (_args, v) => text(`新画布 ${v.canvasId}（${v.title}）已设为当前：${v.canvasFile}`),
)

export const newCanvasTool = {
  name: 'design_work_new_canvas',
  description: '在项目里新建一块画布并设为当前画布（最多 8 块）。新画布用新目录，旧画布不受影响。',
  parameters: paramsOf(
    {
      projectFile: { type: 'string', description: '项目 project.json 的绝对路径' },
      title: TITLE,
      kind: KIND,
    },
    ['projectFile', 'title'],
  ),
  timeoutMs: 10_000,
  output: NEW_CANVAS_OUTPUT,
  async execute(args) {
    const created = createCanvas({ projectFile: args.projectFile, title: args.title, kind: args.kind })
    return {
      canvasId: created.canvas.id,
      canvasFile: canvasWorkFile(args.projectFile, created.canvas.id),
      title: created.canvas.title,
      kind: created.canvas.kind,
    }
  },
}

export const workStateTool = {
  name: 'design_work_state',
  description: '读画布状态：标题、产物数量、最新产物与主产物。改稿前先读，避免重复开新目录。',
  parameters: paramsOf({ canvasFile: CANVAS_FILE }, ['canvasFile']),
  timeoutMs: 10_000,
  output: outputOf(
    {
      title: { type: 'string' },
      kind: { type: 'string' },
      artifactsCount: { type: 'number' },
      latestRel: { type: 'string' },
      latestKind: { type: 'string' },
      primary: { type: 'string' },
    },
    ['title', 'kind', 'artifactsCount', 'latestRel', 'latestKind', 'primary'],
    (_args, v) => {
      const tail = v.latestRel ? `，最新 ${v.latestRel}（${v.latestKind}）` : ''
      return text(`${v.title}：${v.artifactsCount} 个产物${tail}；主产物 ${v.primary || '无'}`)
    },
  ),
  async execute(args) {
    if (typeof args?.canvasFile !== 'string' || !args.canvasFile) throw new Error('缺少 canvasFile')
    const state = stateOf(args.canvasFile)
    return {
      title: state.work.title,
      kind: state.work.kind,
      artifactsCount: state.artifactsCount,
      latestRel: state.latest?.rel || '',
      latestKind: state.latest?.kind || '',
      primary: state.primary?.rel || '',
    }
  },
}

export const exportTool = {
  name: 'design_work_export',
  description: '把画布整树导出到 .design-work/export/<canvasId>/<stamp>/。P0 三格式：html / pdf / png。',
  parameters: paramsOf(
    {
      canvasFile: CANVAS_FILE,
      format: { type: 'string', description: 'html / pdf / png，默认 html' },
      stamp: { type: 'string', description: '导出目录名，默认时间戳' },
    },
    ['canvasFile'],
  ),
  timeoutMs: 120_000,
  output: outputOf(
    { format: { type: 'string' }, dir: { type: 'string' }, entry: { type: 'string' }, fileCount: { type: 'number' } },
    ['format', 'dir', 'entry', 'fileCount'],
    (_args, v) => text(`已导出 ${v.format}：${v.dir}（${v.fileCount} 个文件）`),
  ),
  async execute(args) {
    const run = await exportCanvas({ canvasFile: args.canvasFile, format: args.format || 'html', stamp: args.stamp })
    return { format: run.format || 'html', dir: run.dir, entry: run.entry || '', fileCount: run.fileCount }
  },
}

export const TOOLS = [workStartTool, addArtifactTool, newCanvasTool, workStateTool, exportTool]
