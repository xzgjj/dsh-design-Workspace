import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CANVAS_MAX,
  DEFAULT_CANVAS,
  WORK_FILE,
  WORK_MARK,
  canvasDir,
  canvasWorkFile,
  createCanvas,
  createProject,
  designDir,
  ensureProject,
  inspectProject,
  projectPath,
  readProject,
  removeCanvas,
  renameProject,
  selectCanvas,
} from '../lib/project.js'
import { addArtifact, mutateWork, readWork } from '../lib/store.js'

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-project-'))
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('createProject 工厂可注入 clock，时间戳可复现', () => {
  withRoot((root) => {
    const fixed = '2026-11-21T00:00:00.000Z'
    const project = createProject({ clock: () => fixed })
    const ensured = project.ensureProject({ root, title: '定时项目' })
    assert.equal(ensured.project.createdAt, fixed)
    assert.equal(ensured.project.canvases[0].createdAt, fixed)
    const work = readWork(canvasWorkFile(ensured.projectFile, DEFAULT_CANVAS))
    assert.equal(work.ts.updatedAt, fixed)
  })
})

test('ensureProject 建 project.json(v3) 与画布 work.json(v2)，二次进入幂等', () => {
  withRoot((root) => {
    const first = ensureProject({ root, title: '品牌官网', kind: 'web' })
    assert.equal(first.created, true)
    assert.equal(existsSync(projectPath(root)), true)
    assert.equal(readProject(first.projectFile).v, 3)
    assert.equal(readProject(first.projectFile).activeCanvasId, DEFAULT_CANVAS)
    const work = readWork(canvasWorkFile(first.projectFile, DEFAULT_CANVAS))
    assert.equal(work.v, 2)
    assert.equal(work.kind, 'web')
    assert.notEqual(work.ts.createdAt, '')

    const second = ensureProject({ root, title: '换个标题' })
    assert.equal(second.created, false)
    assert.equal(second.project.name, '品牌官网')
    assert.equal(designDir(root).endsWith(WORK_MARK), true)
  })
})

test('多画布：新建、切换、归档删除；至少留一块，最多 8 块', () => {
  withRoot((root) => {
    const { projectFile } = ensureProject({ root, title: '多画布' })
    const created = createCanvas({ projectFile, kind: 'slides', title: '路演稿' })
    assert.equal(created.canvas.id, 'c-2')
    assert.equal(readProject(projectFile).activeCanvasId, 'c-2')

    const canvasFile = canvasWorkFile(projectFile, 'c-2')
    writeFileSync(join(canvasDir(projectFile, 'c-2'), 'deck.html'), '<html>deck</html>')
    const removed = removeCanvas({ projectFile, canvasId: 'c-2' })
    assert.equal(removed.removed, 'c-2')
    assert.equal(existsSync(canvasFile), false)
    assert.equal(removed.archived.startsWith('snapshots/c-2/archive-'), true)
    const archived = readFileSync(join(designDir(root), removed.archived, WORK_FILE), 'utf8')
    assert.match(archived, /路演稿/)
    assert.equal(readProject(projectFile).activeCanvasId, DEFAULT_CANVAS)

    selectCanvas({ projectFile, canvasId: DEFAULT_CANVAS })
    assert.throws(() => removeCanvas({ projectFile, canvasId: DEFAULT_CANVAS }), (err) => err.code === 'CONFLICT' && err.reason === 'CANVAS_MIN')
    assert.throws(() => selectCanvas({ projectFile, canvasId: 'c-9' }), (err) => err.code === 'NOT_FOUND' && err.reason === 'CANVAS_NOT_FOUND')

    for (let i = 2; i <= CANVAS_MAX; i += 1) createCanvas({ projectFile, title: `画布 ${i}` })
    assert.throws(() => createCanvas({ projectFile, title: '超限' }), (err) => err.code === 'LIMIT' && err.reason === 'CANVAS_LIMIT')
  })
})

test('renameProject 只改项目名；空名 BAD_ARGS + NAME_EMPTY', () => {
  withRoot((root) => {
    const { projectFile } = ensureProject({ root, title: '统计' })
    renameProject({ projectFile, name: '改名后的项目' })
    assert.equal(readProject(projectFile).name, '改名后的项目')
    assert.throws(() => renameProject({ projectFile, name: '  ' }), (err) => err.code === 'BAD_ARGS' && err.reason === 'NAME_EMPTY')
  })
})

test('inspectProject 按登记清单统计产物、给出 primary 与画布上限', () => {
  withRoot((root) => {
    const { projectFile } = ensureProject({ root, title: '统计' })
    const dir = canvasDir(projectFile, DEFAULT_CANVAS)
    writeFileSync(join(dir, 'index.html'), '<html></html>')
    writeFileSync(join(dir, 'artifacts', 'deck.pdf'), 'x')
    mutateWork(canvasWorkFile(projectFile, DEFAULT_CANVAS), (work) => {
      addArtifact(work, { rel: 'index.html', kind: 'web', title: '首页', pages: 1 })
      addArtifact(work, { rel: 'artifacts/deck.pdf', kind: 'deck', title: 'PDF', pages: 2 })
      return work
    })

    const inspected = inspectProject(projectFile)
    assert.equal(inspected.canvasLimit, CANVAS_MAX)
    assert.equal(inspected.canvases.length, 1)
    assert.equal(inspected.canvases[0].artifactsCount, 2)
    assert.equal(inspected.canvases[0].latestRel, 'artifacts/deck.pdf')
    assert.equal(inspected.canvases[0].primary, 'index.html')
    assert.equal(inspected.canvases[0].active, true)
    assert.equal(inspected.canvases[0].bytes > 0, true)
  })
})

test('legacy 迁移：先快照根 work.json，产物搬进画布，原文件不删', () => {
  withRoot((root) => {
    mkdirSync(join(root, WORK_MARK), { recursive: true })
    writeFileSync(join(root, WORK_MARK, WORK_FILE), JSON.stringify({ v: 1, id: 'old', title: '旧交付物', kind: 'web', artifacts: [{ rel: 'index.html', kind: 'web' }] }))
    writeFileSync(join(root, 'index.html'), '<html>legacy</html>')
    writeFileSync(join(root, 'notes.txt'), '不属于产物的旁文件')
    const { project, created, migrated, archive } = ensureProject({ root, title: '' })
    assert.equal(created, true)
    assert.equal(migrated, true)
    assert.equal(project.name, '旧交付物')
    assert.equal(existsSync(join(root, WORK_MARK, WORK_FILE)), true)
    assert.equal(existsSync(join(archive, WORK_FILE)), true)
    const work = readWork(canvasWorkFile(projectPath(root), DEFAULT_CANVAS))
    assert.equal(work.artifacts.length, 1)
    assert.equal(work.artifacts[0].rel, 'index.html')
    assert.equal(readFileSync(join(canvasDir(projectPath(root), DEFAULT_CANVAS), 'index.html'), 'utf8'), '<html>legacy</html>')
    assert.equal(existsSync(join(canvasDir(projectPath(root), DEFAULT_CANVAS), 'notes.txt')), false)
  })
})

test('legacy 迁移失败回滚：不留下半截 project.json，legacy 原样保留', () => {
  withRoot((root) => {
    mkdirSync(join(root, WORK_MARK), { recursive: true })
    writeFileSync(join(root, WORK_MARK, WORK_FILE), JSON.stringify({ v: 1, id: 'old', title: '旧交付物', artifacts: [] }))
    writeFileSync(join(root, WORK_MARK, 'snapshots'), '占位：让快照目录建不出来')
    assert.throws(() => ensureProject({ root, title: '' }), (err) => err.code === 'INTERNAL' && err.reason === 'PROJECT_MIGRATE_FAIL')
    assert.equal(existsSync(projectPath(root)), false)
    assert.equal(existsSync(join(root, WORK_MARK, WORK_FILE)), true)
  })
})
