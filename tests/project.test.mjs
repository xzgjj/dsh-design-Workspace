import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CANVAS_MAX,
  DEFAULT_CANVAS,
  WORK_FILE,
  WORK_MARK,
  canvasWorkFile,
  createCanvas,
  designDir,
  ensureProject,
  inspectProject,
  projectPath,
  readProject,
  removeCanvas,
  renameProject,
  selectCanvas,
} from '../lib/project.js'

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-project-'))
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('ensureProject 建 project.json 与默认画布 c-main，幂等', () => {
  withRoot((root) => {
    const first = ensureProject({ root, title: '品牌官网' })
    assert.equal(first.created, true)
    assert.equal(existsSync(projectPath(root)), true)
    assert.equal(existsSync(canvasWorkFile(first.projectFile, DEFAULT_CANVAS)), true)
    assert.equal(readProject(first.projectFile).activeCanvasId, DEFAULT_CANVAS)

    const second = ensureProject({ root, title: '换个标题' })
    assert.equal(second.created, false)
    assert.equal(second.project.name, '品牌官网')
    assert.equal(designDir(root).endsWith(WORK_MARK), true)
  })
})

test('多画布：新建、切换、删除，且至少留一块', () => {
  withRoot((root) => {
    const { projectFile } = ensureProject({ root, title: '多画布' })
    const created = createCanvas({ projectFile, kind: 'slides', title: '路演稿' })
    assert.equal(created.canvas.id, 'c-2')
    assert.equal(readProject(projectFile).activeCanvasId, 'c-2')

    selectCanvas({ projectFile, canvasId: DEFAULT_CANVAS })
    assert.equal(readProject(projectFile).activeCanvasId, DEFAULT_CANVAS)

    const removed = removeCanvas({ projectFile, canvasId: 'c-2' })
    assert.equal(removed.removed, 'c-2')
    assert.throws(() => removeCanvas({ projectFile, canvasId: DEFAULT_CANVAS }), /至少保留一块画布/)

    for (let i = 2; i <= CANVAS_MAX; i += 1) createCanvas({ projectFile, title: `画布 ${i}` })
    assert.throws(() => createCanvas({ projectFile, title: '超限' }), /最多/)
  })
})

test('旧布局迁移：已有 .design-work/work.json 时不再新开项目', () => {
  withRoot((root) => {
    mkdirSync(join(root, WORK_MARK), { recursive: true })
    writeFileSync(join(root, WORK_MARK, WORK_FILE), JSON.stringify({ v: 1, id: 'old', title: '旧交付物', artifacts: [] }))
    const { project, created } = ensureProject({ root, title: '' })
    assert.equal(created, true)
    assert.equal(project.name, '旧交付物')
    assert.equal(readProject(projectPath(root)).canvases.length, 1)
  })
})

test('renameProject 与 inspectProject 统计产物', () => {
  withRoot((root) => {
    const { projectFile } = ensureProject({ root, title: '统计' })
    renameProject({ projectFile, name: '改名后的项目' })
    assert.equal(readProject(projectFile).name, '改名后的项目')

    const dir = designDir(root)
    writeFileSync(join(root, 'index.html'), '<html></html>')
    mkdirSync(join(dir, 'canvases', DEFAULT_CANVAS, 'artifacts'), { recursive: true })
    writeFileSync(join(dir, 'canvases', DEFAULT_CANVAS, 'artifacts', 'deck.pdf'), 'x')

    const inspected = inspectProject(projectFile)
    assert.equal(inspected.canvases.length, 1)
    assert.equal(inspected.canvases[0].artifactsCount, 1)
    assert.equal(inspected.canvases[0].active, true)
    assert.equal(inspected.canvases[0].bytes > 0, true)
  })
})
