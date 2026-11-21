// 项目与画布：project.json 是唯一索引，画布一个个落在 canvases/<id>/。
// 默认一块画布（c-main），允许新建多块；一个画布一个交付物。
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ERR, OpError, optionalString, requireInside, requireString } from './contracts.js'
import { ensureDir, listTree, nowIso, readJson, slugify, writeJsonAtomic } from './fsx.js'

export const WORK_MARK = '.design-work'
const PROJECT_FILE = 'project.json'
export const WORK_FILE = 'work.json'
export const DEFAULT_CANVAS = 'c-main'
export const CANVAS_MAX = 8

export function designDir(root) {
  return join(root, WORK_MARK)
}

export function projectPath(root) {
  return join(designDir(root), PROJECT_FILE)
}

function canvasDir(projectFile, canvasId) {
  const design = dirname(projectFile)
  return join(design, 'canvases', canvasId)
}

export function canvasWorkFile(projectFile, canvasId) {
  return join(canvasDir(projectFile, canvasId), WORK_FILE)
}

export function readProject(projectFile) {
  const project = readJson(projectFile, null)
  if (!project) throw new OpError(ERR.NOT_FOUND, `项目不存在：${projectFile}`)
  if (!Array.isArray(project.canvases) || !project.canvases.length) {
    throw new OpError(ERR.CONFLICT, '项目里没有任何画布')
  }
  return project
}

function nextCanvasId(project) {
  for (let i = 2; i <= CANVAS_MAX; i += 1) {
    const id = `c-${i}`
    if (!project.canvases.some((canvas) => canvas.id === id)) return id
  }
  throw new OpError(ERR.LIMIT, `一块项目最多 ${CANVAS_MAX} 块画布`)
}

function blankWork({ id, kind, title }) {
  const at = nowIso()
  return { v: 2, id, kind: kind || 'blank', title: title || '未命名交付物', status: 'draft', createdAt: at, updatedAt: at, artifacts: [] }
}

function writeCanvas(projectFile, canvas, work) {
  const dir = canvasDir(projectFile, canvas.id)
  ensureDir(join(dir, 'artifacts'))
  writeJsonAtomic(join(dir, WORK_FILE), work)
  return dir
}

function legacyWork(design) {
  const file = join(design, WORK_FILE)
  const work = readJson(file, null)
  if (!work || typeof work !== 'object') return null
  return work
}

function seedProject(root, title, kind, legacy) {
  const at = nowIso()
  return {
    v: 3,
    id: `${slugify(title || legacy?.title)}-${at.slice(0, 10).replace(/-/g, '')}`,
    name: optionalString(title || legacy?.title, 80) || '未命名项目',
    kind: kind || legacy?.kind || 'blank',
    createdAt: at,
    updatedAt: at,
    activeCanvasId: DEFAULT_CANVAS,
    canvases: [
      {
        id: DEFAULT_CANVAS,
        kind: kind || legacy?.kind || 'blank',
        title: optionalString(legacy?.title, 80) || '主画布',
        createdAt: at,
        updatedAt: at,
      },
    ],
  }
}

export function ensureProject({ root, title, kind }) {
  const cleanRoot = requireString('root', root, 400)
  if (!existsSync(cleanRoot)) throw new OpError(ERR.NOT_FOUND, `工作区不存在：${cleanRoot}`)
  const design = designDir(cleanRoot)
  requireInside(cleanRoot, design, 'root')
  ensureDir(design)
  const file = projectPath(cleanRoot)
  const existing = readJson(file, null)
  if (existing) {
    const project = readProject(file)
    for (const canvas of project.canvases) writeCanvas(file, canvas, readJson(canvasWorkFile(file, canvas.id), blankWork(canvas)))
    return { project, projectFile: file, created: false }
  }
  const legacy = legacyWork(design)
  const project = seedProject(cleanRoot, title, kind, legacy)
  const work = { ...blankWork({ id: DEFAULT_CANVAS, kind: project.kind, title: project.canvases[0].title }), artifacts: legacy?.artifacts || [] }
  writeJsonAtomic(file, project)
  writeCanvas(file, project.canvases[0], work)
  return { project, projectFile: file, created: true }
}

export function createCanvas({ projectFile, kind, title }) {
  const file = requireString('projectFile', projectFile, 400)
  const project = readProject(file)
  if (project.canvases.length >= CANVAS_MAX) throw new OpError(ERR.LIMIT, `一块项目最多 ${CANVAS_MAX} 块画布`)
  const at = nowIso()
  const canvas = { id: nextCanvasId(project), kind: optionalString(kind, 40) || 'blank', title: optionalString(title, 80) || '新画布', createdAt: at, updatedAt: at }
  project.canvases.push(canvas)
  project.activeCanvasId = canvas.id
  project.updatedAt = at
  writeJsonAtomic(file, project)
  writeCanvas(file, canvas, blankWork(canvas))
  return { project, canvas }
}

export function selectCanvas({ projectFile, canvasId }) {
  const file = requireString('projectFile', projectFile, 400)
  const project = readProject(file)
  const canvas = project.canvases.find((item) => item.id === canvasId)
  if (!canvas) throw new OpError(ERR.NOT_FOUND, `没有这块画布：${canvasId}`)
  project.activeCanvasId = canvas.id
  project.updatedAt = nowIso()
  writeJsonAtomic(file, project)
  return { project, canvas }
}

export function renameProject({ projectFile, name }) {
  const file = requireString('projectFile', projectFile, 400)
  const project = readProject(file)
  project.name = requireString('name', name, 80)
  project.updatedAt = nowIso()
  writeJsonAtomic(file, project)
  return { project }
}

export function removeCanvas({ projectFile, canvasId }) {
  const file = requireString('projectFile', projectFile, 400)
  const project = readProject(file)
  if (project.canvases.length <= 1) throw new OpError(ERR.CONFLICT, '至少保留一块画布')
  const index = project.canvases.findIndex((item) => item.id === canvasId)
  if (index < 0) throw new OpError(ERR.NOT_FOUND, `没有这块画布：${canvasId}`)
  project.canvases.splice(index, 1)
  if (project.activeCanvasId === canvasId) project.activeCanvasId = project.canvases[0].id
  project.updatedAt = nowIso()
    writeJsonAtomic(file, project)
  return { project, removed: canvasId }
}

export function inspectProject(projectFile) {
  const file = requireString('projectFile', projectFile, 400)
  const project = readProject(file)
  const canvases = project.canvases.map((canvas) => {
    const dir = canvasDir(file, canvas.id)
    const tree = listTree(dir)
    const artifacts = tree.files.filter((file) => file.rel !== WORK_FILE)
    return {
      id: canvas.id,
      kind: canvas.kind,
      title: canvas.title,
      active: project.activeCanvasId === canvas.id,
      artifactsCount: artifacts.length,
      latestRel: artifacts[0]?.rel || '',
      bytes: artifacts.reduce((sum, item) => sum + item.bytes, 0),
    }
  })
  return { project, projectFile: file, canvases }
}
