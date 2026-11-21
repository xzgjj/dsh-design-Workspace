import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CANVAS, canvasDir, canvasWorkFile, ensureProject } from '../lib/project.js'
import {
  MAX_PAGES,
  addArtifact,
  blankWork,
  canvasDirOf,
  createCanvasWork,
  createStore,
  inferKind,
  mutateWork,
  readWork,
  requireCanvasFile,
  resolveCanvasRel,
  stateOf,
  writeWork,
} from '../lib/store.js'

function withProject(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-store-'))
  try {
    const { projectFile } = ensureProject({ root, title: '存储测试' })
    fn({ root, projectFile, canvasFile: canvasWorkFile(projectFile, DEFAULT_CANVAS), canvasPath: canvasDir(projectFile, DEFAULT_CANVAS) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('blankWork 是 v2 形状：status/primary/artifacts/ts', () => {
  const work = blankWork({ id: 'c-main', kind: 'web', title: '落地页', at: '2026-11-21T00:00:00.000Z' })
  assert.equal(work.v, 2)
  assert.equal(work.id, 'c-main')
  assert.equal(work.kind, 'web')
  assert.equal(work.status, 'draft')
  assert.equal(work.primary, null)
  assert.deepEqual(work.artifacts, [])
  assert.equal(work.ts.createdAt, '2026-11-21T00:00:00.000Z')
})

test('createCanvasWork 建 artifacts 目录且幂等', () => {
  withProject(({ canvasPath, canvasFile }) => {
    const again = createCanvasWork({ canvasDir: canvasPath, id: DEFAULT_CANVAS, kind: 'web', title: 'x' })
    assert.equal(again.created, false)
    assert.equal(again.file, canvasFile)
    assert.equal(existsSync(join(canvasPath, 'artifacts')), true)
    assert.equal(canvasDirOf(canvasFile), canvasPath)
  })
})

test('requireCanvasFile 只认 canvases/<id>/work.json，越界形状 NOT_WORK_FILE', () => {
  withProject(({ root, canvasFile }) => {
    assert.equal(requireCanvasFile(canvasFile), canvasFile)
    const outside = join(root, 'work.json')
    writeFileSync(outside, '{}')
    assert.throws(() => requireCanvasFile(outside), (err) => err.code === 'BAD_ARGS' && err.reason === 'NOT_WORK_FILE')
    assert.throws(() => requireCanvasFile(join(root, '.design-work', 'missing', 'work.json')), (err) => err.code === 'BAD_ARGS')
  })
})

test('writeWork 原子且不留 .tmp，mutateWork 回写 ts.updatedAt', () => {
  withProject(({ canvasFile }) => {
    const written = writeWork(canvasFile, { ...readWork(canvasFile), title: '新标题' })
    assert.equal(written.title, '新标题')
    assert.equal(readdirSync(canvasDirOf(canvasFile)).some((name) => name.includes('.tmp-')), false)
    const mutated = mutateWork(canvasFile, (work) => ({ ...work, status: 'ready' }))
    assert.equal(mutated.status, 'ready')
    assert.notEqual(mutated.ts.updatedAt, '')
  })
})

test('resolveCanvasRel 拒绝越界与绝对路径，放行画布内文件', () => {
  withProject(({ canvasFile, canvasPath }) => {
    writeFileSync(join(canvasPath, 'index.html'), '<html></html>')
    assert.equal(resolveCanvasRel(canvasFile, 'index.html'), join(canvasPath, 'index.html'))
    assert.throws(() => resolveCanvasRel(canvasFile, '../escape.html'), (err) => err.code === 'BAD_ARGS')
    assert.throws(() => resolveCanvasRel(canvasFile, '/abs.html'), (err) => err.code === 'BAD_ARGS')
  })
})

test('addArtifact 第一件成为 primary，同 rel 覆盖，显式 primary 降级旧件', () => {
  const work = blankWork({ id: 'c-1', kind: 'web', title: 'x' })
  addArtifact(work, { rel: 'index.html', kind: 'web', title: '首页', pages: 1 })
  assert.equal(work.primary, 'index.html')
  addArtifact(work, { rel: 'index.html', kind: 'web', title: '首页 v2', pages: 2 })
  assert.equal(work.artifacts.length, 1)
  assert.equal(work.artifacts[0].title, '首页 v2')
  addArtifact(work, { rel: 'deck.pdf', kind: 'deck', title: 'PDF', pages: 3, role: 'primary' })
  assert.equal(work.primary, 'deck.pdf')
  assert.equal(work.artifacts.find((item) => item.rel === 'index.html').role, 'support')
  assert.equal(work.artifacts.find((item) => item.rel === 'deck.pdf').role, 'primary')
})

test('stateOf 只回已存在的登记产物，并渲染 latest/primary', () => {
  withProject(({ canvasFile, canvasPath }) => {
    writeFileSync(join(canvasPath, 'index.html'), '<html>ok</html>')
    writeFileSync(join(canvasPath, 'gone.pdf'), 'x')
    mutateWork(canvasFile, (work) => {
      addArtifact(work, { rel: 'index.html', kind: 'web', title: '首页', pages: 1 })
      addArtifact(work, { rel: 'gone.pdf', kind: 'deck', title: '会消失', pages: 1 })
      return work
    })
    rmSync(join(canvasPath, 'gone.pdf'))
    const state = stateOf(canvasFile)
    assert.equal(state.work.v, 2)
    assert.equal(state.artifactsCount, 1)
    assert.equal(state.artifacts[0].rel, 'index.html')
    assert.equal(state.latest.rel, 'index.html')
    assert.equal(state.primary.rel, 'index.html')
    assert.equal(state.artifacts[0].bytes > 0, true)
  })
})

test('createStore 工厂可注入 clock，写入时间可复现', () => {
  withProject(({ canvasFile }) => {
    const fixed = '2026-11-21T00:00:00.000Z'
    const store = createStore({ clock: () => fixed })
    const work = store.mutateWork(canvasFile, (current) => ({ ...current, title: '由工厂写入' }))
    assert.equal(work.ts.updatedAt, fixed)
    assert.equal(store.readWork(canvasFile).title, '由工厂写入')
    assert.equal(store.requireCanvasFile(canvasFile), canvasFile)
  })
})

test('inferKind 覆盖 web/deck/doc/sheet/image，未知回退 file；pages 上限受约束', () => {
  assert.equal(inferKind('a.html'), 'web')
  assert.equal(inferKind('a.pptx'), 'deck')
  assert.equal(inferKind('a.docx'), 'doc')
  assert.equal(inferKind('a.xlsx'), 'sheet')
  assert.equal(inferKind('a.png'), 'image')
  assert.equal(inferKind('a.bin'), 'file')
  workWithPages()
  function workWithPages() {
    const work = blankWork({ id: 'c-1' })
    addArtifact(work, { rel: 'x.html', pages: 999 })
    assert.equal(work.artifacts[0].pages, MAX_PAGES)
  }
})
