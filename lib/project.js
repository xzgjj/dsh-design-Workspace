// 项目与画布：project.json 是唯一索引，画布一个个落在 canvases/<id>/。
// 默认一块画布（c-main），允许新建多块；一个画布一个交付物。
// legacy 根 work.json 只迁一次：先快照，再建索引，失败回滚并保留原文件。
import { existsSync, rmSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { ERR, REASON, opError, optionalString, requireInside, requireString, toPosix } from './contracts.js'
import { copyFile, copyTree, ensureDir, nowIso, readJson, slugify, statOf, writeJsonAtomic, removeTree } from './fsx.js'
import { WORK_FILE, createCanvasWork, normalizeWork, writeWork } from './store.js'

export { WORK_FILE }

export const WORK_MARK = '.design-work'
const PROJECT_FILE = 'project.json'
export const DEFAULT_CANVAS = 'c-main'
export const CANVAS_MAX = 8

export function designDir(root) {
  return join(root, WORK_MARK)
}

export function projectPath(root) {
  return join(designDir(root), PROJECT_FILE)
}

export function canvasDir(projectFile, canvasId) {
  return join(dirname(projectFile), 'canvases', canvasId)
}

export function canvasWorkFile(projectFile, canvasId) {
  return join(canvasDir(projectFile, canvasId), WORK_FILE)
}

function stampOf(clock) {
  return clock().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

function archiveDirFor(projectFile, canvasId, clock) {
  const root = join(dirname(projectFile), 'snapshots', canvasId)
  ensureDir(root)
  const base = `archive-${stampOf(clock)}`
  let dest = join(root, base)
  let index = 2
  while (existsSync(dest)) {
    dest = join(root, `${base}-${index}`)
    index += 1
  }
  return dest
}

function seedProject({ title, kind, legacy, at }) {
  return {
    v: 3,
    id: `${slugify(title || legacy?.title)}-${at.slice(0, 10).replace(/-/g, '')}`,
    name: optionalString(title || legacy?.title, 80) || '未命名项目',
    kind: optionalString(kind || legacy?.kind, 40) || 'blank',
    createdAt: at,
    updatedAt: at,
    activeCanvasId: DEFAULT_CANVAS,
    canvases: [
      {
        id: DEFAULT_CANVAS,
        kind: optionalString(kind || legacy?.kind, 40) || 'blank',
        title: optionalString(title || legacy?.title, 80) || '主画布',
        createdAt: at,
        updatedAt: at,
      },
    ],
  }
}

function validRel(rel) {
  if (typeof rel !== 'string' || !rel) return ''
  const text = toPosix(rel).replace(/^\.\//, '')
  if (text.split('/').includes('..') || text.startsWith('/')) return ''
  return text
}

// legacy 产物原本相对工作区根；迁进画布时按 rel 位置复制，不删原文件。
function carryLegacyArtifacts({ root, canvasDirPath, legacy }) {
  const carried = []
  for (const item of Array.isArray(legacy.artifacts) ? legacy.artifacts : []) {
    const rel = validRel(item?.rel)
    if (!rel) continue
    const source = join(root, rel)
    if (existsSync(source) && statOf(source)?.isFile()) copyFile(source, join(canvasDirPath, rel))
    carried.push({ ...item, rel })
  }
  return carried
}

function migrateLegacy({ root, design, projectFile, legacy, clock }) {
  let wroteProject = false
  let canvasPath = ''
  try {
    const archive = join(design, 'snapshots', `legacy-${stampOf(clock)}`)
    ensureDir(archive)
    writeJsonAtomic(join(archive, 'work.json'), legacy)
    const at = clock()
    const project = seedProject({ title: '', kind: '', legacy, at })
    writeJsonAtomic(projectFile, project)
    wroteProject = true
    canvasPath = canvasDir(projectFile, DEFAULT_CANVAS)
    const createdCanvas = createCanvasWork({ canvasDir: canvasPath, id: DEFAULT_CANVAS, kind: project.kind, title: project.canvases[0].title, at })
    const work = createdCanvas.work
    const artifacts = carryLegacyArtifacts({ root, canvasDirPath: canvasPath, legacy })
    const migrated = normalizeWork({ ...work, ...legacy, id: DEFAULT_CANVAS, kind: project.kind, title: legacy.title || work.title, artifacts }, { id: DEFAULT_CANVAS })
    writeWork(join(canvasPath, WORK_FILE), migrated)
    return { project, projectFile, migrated: true, archive }
  } catch (err) {
    if (canvasPath) removeTree(canvasPath)
    if (wroteProject) rmSync(projectFile, { force: true })
    throw opError(ERR.INTERNAL, REASON.PROJECT_MIGRATE_FAIL, `legacy 迁移失败：${err?.message || err}`)
  }
}

export function createProject({ clock = nowIso } = {}) {
  function readProject(projectFile) {
    const file = requireString('projectFile', projectFile, 400)
    const project = readJson(file, null)
    if (!project) throw opError(ERR.NOT_FOUND, '', `项目不存在：${file}`)
    if (project.v !== 3) throw opError(ERR.CONFLICT, '', `项目索引版本不对（需 v3）：${file}`)
    if (!Array.isArray(project.canvases) || !project.canvases.length) throw opError(ERR.CONFLICT, '', '项目里没有任何画布')
    return project
  }

  function repairCanvases(projectFile, project) {
    for (const canvas of project.canvases) {
      const file = canvasWorkFile(projectFile, canvas.id)
      if (!existsSync(file)) createCanvasWork({ canvasDir: canvasDir(projectFile, canvas.id), id: canvas.id, kind: canvas.kind, title: canvas.title })
    }
    return project
  }

  function ensureProject({ root, title, kind }) {
    const cleanRoot = requireString('root', root, 400)
    if (!existsSync(cleanRoot)) throw opError(ERR.NOT_FOUND, '', `工作区不存在：${cleanRoot}`)
    const design = designDir(cleanRoot)
    requireInside(cleanRoot, design, 'root')
    ensureDir(design)
    const file = projectPath(cleanRoot)
    const existing = readJson(file, null)
    if (existing) {
      const project = repairCanvases(file, readProject(file))
      return { project, projectFile: file, created: false }
    }
    const legacy = readJson(join(design, 'work.json'), null)
    if (legacy && typeof legacy === 'object') {
      const migrated = migrateLegacy({ root: cleanRoot, design, projectFile: file, legacy, clock })
      return { project: migrated.project, projectFile: file, created: true, migrated: true, archive: migrated.archive }
    }
    const at = clock()
    const project = seedProject({ title, kind, at })
    writeJsonAtomic(file, project)
    createCanvasWork({ canvasDir: canvasDir(file, DEFAULT_CANVAS), id: DEFAULT_CANVAS, kind: project.kind, title: project.canvases[0].title, at })
    return { project, projectFile: file, created: true }
  }

  function createCanvas({ projectFile, kind, title }) {
    const file = requireString('projectFile', projectFile, 400)
    const project = readProject(file)
    if (project.canvases.length >= CANVAS_MAX) throw opError(ERR.LIMIT, REASON.CANVAS_LIMIT, `一块项目最多 ${CANVAS_MAX} 块画布`)
    const at = clock()
    let id = ''
    for (let i = 2; i <= CANVAS_MAX; i += 1) {
      if (!project.canvases.some((canvas) => canvas.id === `c-${i}`)) {
        id = `c-${i}`
        break
      }
    }
    if (!id) throw opError(ERR.LIMIT, REASON.CANVAS_LIMIT, `一块项目最多 ${CANVAS_MAX} 块画布`)
    const canvas = { id, kind: optionalString(kind, 40) || 'blank', title: optionalString(title, 80) || '新画布', createdAt: at, updatedAt: at }
    project.canvases.push(canvas)
    project.activeCanvasId = canvas.id
    project.updatedAt = at
    writeJsonAtomic(file, project)
    createCanvasWork({ canvasDir: canvasDir(file, canvas.id), id: canvas.id, kind: canvas.kind, title: canvas.title, at })
    return { project, canvas }
  }

  function selectCanvas({ projectFile, canvasId }) {
    const file = requireString('projectFile', projectFile, 400)
    const project = readProject(file)
    const canvas = project.canvases.find((item) => item.id === canvasId)
    if (!canvas) throw opError(ERR.NOT_FOUND, REASON.CANVAS_NOT_FOUND, `没有这块画布：${canvasId}`)
    project.activeCanvasId = canvas.id
    project.updatedAt = clock()
    writeJsonAtomic(file, project)
    return { project, canvas }
  }

  function renameProject({ projectFile, name }) {
    const file = requireString('projectFile', projectFile, 400)
    const project = readProject(file)
    let next = ''
    try {
      next = requireString('name', name, 80)
    } catch (err) {
      throw opError(ERR.BAD_ARGS, REASON.NAME_EMPTY, err?.message || '项目名不能为空')
    }
    project.name = next
    project.updatedAt = clock()
    writeJsonAtomic(file, project)
    return { project }
  }

  // 删除 = 归档：整块画布目录移到 snapshots/<canvasId>/archive-<stamp>/，只摘索引。
  function removeCanvas({ projectFile, canvasId }) {
    const file = requireString('projectFile', projectFile, 400)
    const project = readProject(file)
    if (project.canvases.length <= 1) throw opError(ERR.CONFLICT, REASON.CANVAS_MIN, '至少保留一块画布')
    const index = project.canvases.findIndex((item) => item.id === canvasId)
    if (index < 0) throw opError(ERR.NOT_FOUND, REASON.CANVAS_NOT_FOUND, `没有这块画布：${canvasId}`)
    const source = canvasDir(file, canvasId)
    let archived = ''
    if (existsSync(source)) {
      const dest = archiveDirFor(file, canvasId, clock)
      copyTree(source, dest, { skip: [] })
      removeTree(source)
      archived = toPosix(relative(dirname(file), dest))
    }
    project.canvases.splice(index, 1)
    if (project.activeCanvasId === canvasId) project.activeCanvasId = project.canvases[0].id
    project.updatedAt = clock()
    writeJsonAtomic(file, project)
    return { project, removed: canvasId, archived }
  }

  function inspectProject(projectFile) {
    const file = requireString('projectFile', projectFile, 400)
    const project = readProject(file)
    const canvases = project.canvases.map((canvas) => {
      const dir = canvasDir(file, canvas.id)
      const work = normalizeWork(readJson(join(dir, WORK_FILE), null), { id: canvas.id, kind: canvas.kind, title: canvas.title })
      const artifacts = work.artifacts.filter((item) => existsSync(join(dir, item.rel)))
      const bytes = artifacts.reduce((sum, item) => sum + (statOf(join(dir, item.rel))?.size || 0), 0)
      return {
        id: canvas.id,
        kind: canvas.kind,
        title: canvas.title,
        active: project.activeCanvasId === canvas.id,
        artifactsCount: artifacts.length,
        latestRel: artifacts.at(-1)?.rel || '',
        primary: work.primary,
        bytes,
      }
    })
    return { project, projectFile: file, canvases, canvasLimit: CANVAS_MAX }
  }

  return { ensureProject, readProject, createCanvas, selectCanvas, renameProject, removeCanvas, inspectProject }
}

const defaultProject = createProject()

export const ensureProject = defaultProject.ensureProject
export const readProject = defaultProject.readProject
export const createCanvas = defaultProject.createCanvas
export const selectCanvas = defaultProject.selectCanvas
export const renameProject = defaultProject.renameProject
export const removeCanvas = defaultProject.removeCanvas
export const inspectProject = defaultProject.inspectProject
