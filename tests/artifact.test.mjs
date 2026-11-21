import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CANVAS, canvasDir, canvasWorkFile, ensureProject } from '../lib/project.js'
import { createArtifact, registerArtifact } from '../lib/artifact.js'
import { addArtifact, blankWork, readWork } from '../lib/store.js'

function withCanvas(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-artifact-'))
  try {
    const { projectFile } = ensureProject({ root, title: '产物测试' })
    const canvasPath = canvasDir(projectFile, DEFAULT_CANVAS)
    fn({ root, projectFile, canvasPath, canvasFile: canvasWorkFile(projectFile, DEFAULT_CANVAS) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('register 缺文件 → NOT_FOUND + NO_ARTIFACT', () => {
  withCanvas(({ canvasFile }) => {
    assert.throws(() => registerArtifact({ canvasFile, rel: 'missing.html' }), (err) => err.code === 'NOT_FOUND' && err.reason === 'NO_ARTIFACT')
  })
})

test('register 第一件自动 primary，同 rel 覆盖元信息不重复登记', () => {
  withCanvas(({ canvasFile, canvasPath }) => {
    mkdirSync(join(canvasPath, 'artifacts'), { recursive: true })
    writeFileSync(join(canvasPath, 'artifacts', 'index.html'), '<html>v1</html>')
    const first = registerArtifact({ canvasFile, rel: 'artifacts/index.html', title: '首页' })
    assert.equal(first.artifact.rel, 'artifacts/index.html')
    assert.equal(first.artifact.kind, 'web')
    assert.equal(first.primary, 'artifacts/index.html')
    assert.equal(first.work.artifacts.length, 1)

    const second = registerArtifact({ canvasFile, rel: 'artifacts/index.html', title: '首页 v2', pages: 2 })
    assert.equal(second.work.artifacts.length, 1)
    assert.equal(second.artifact.title, '首页 v2')
    assert.equal(second.artifact.pages, 2)
  })
})

test('显式 primary 会降级旧主产物；页数超限 LIMIT', () => {
  withCanvas(({ canvasFile, canvasPath }) => {
    writeFileSync(join(canvasPath, 'a.html'), '<html>a</html>')
    writeFileSync(join(canvasPath, 'b.png'), 'png')
    registerArtifact({ canvasFile, rel: 'a.html' })
    const promoted = registerArtifact({ canvasFile, rel: 'b.png', primary: true })
    assert.equal(promoted.primary, 'b.png')
    const roles = readWork(canvasFile).artifacts.map((item) => `${item.rel}:${item.role}`)
    assert.deepEqual(roles.sort(), ['a.html:support', 'b.png:primary'])

    assert.throws(() => registerArtifact({ canvasFile, rel: 'a.html', pages: 500 }), (err) => err.code === 'LIMIT')
  })
})

test('rel 越界或绝对路径一律 BAD_ARGS，不落盘', () => {
  withCanvas(({ root, canvasFile }) => {
    writeFileSync(join(root, 'secret.html'), 'x')
    assert.throws(() => registerArtifact({ canvasFile, rel: '../secret.html' }), (err) => err.code === 'BAD_ARGS')
    assert.throws(() => registerArtifact({ canvasFile, rel: join(root, 'secret.html') }), (err) => err.code === 'BAD_ARGS')
  })
})

test('work.json 是索引，不能被登记成产物', () => {
  withCanvas(({ canvasFile }) => {
    assert.throws(() => registerArtifact({ canvasFile, rel: 'work.json' }), (err) => err.code === 'BAD_ARGS')
  })
})

test('createArtifact 可注入 store 端口：register 只经端口写清单', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-artifact-port-'))
  try {
    writeFileSync(join(root, 'x.html'), '<html>x</html>')
    const work = blankWork({ id: 'c-1', kind: 'web', title: 'x' })
    const writes = []
    const store = {
      requireCanvasFile: (value) => value,
      resolveCanvasRel: (_file, rel) => join(root, rel),
      mutateWork: (file, mutator) => {
        writes.push(file)
        return mutator(work)
      },
      addArtifact,
    }
    const factory = createArtifact({ store })
    const saved = factory.register({ canvasFile: 'c-1/work.json', rel: 'x.html' })
    assert.equal(saved.primary, 'x.html')
    assert.equal(saved.work.artifacts.length, 1)
    assert.deepEqual(writes, ['c-1/work.json'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
