import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { apply, describe } from '../../lib/index.js'

function fakeCtx() {
  const servers = []
  return {
    tools: { register: () => {} },
    webServer: { register: (entry) => servers.push(entry) },
    effect: (fn) => fn(),
    servers,
  }
}

function call(handler, { url, method = 'GET', body }) {
  const res = {
    statusCode: 0,
    headers: {},
    chunks: [],
    setHeader: (key, value) => {
      res.headers[key.toLowerCase()] = value
    },
    end: (value) => {
      if (value != null) res.chunks.push(value)
    },
  }
  const req = { url, method, body }
  return Promise.resolve(handler(req, res)).then(() => ({
    status: res.statusCode,
    headers: res.headers,
    json: res.chunks.length ? JSON.parse(Buffer.concat(res.chunks.map((c) => Buffer.from(c))).toString('utf8')) : null,
  }))
}

const EXPECTED_OPS = [
  'project.ensure',
  'project.read',
  'project.inspect',
  'project.select',
  'project.rename',
  'canvas.create',
  'canvas.remove',
  'canvas.state',
  'canvas.wire',
  'artifact.register',
  'version.list',
  'version.snapshot',
  'version.restore',
  'export.run',
]

const EXPECTED_TOOLS = [
  'design_work_start',
  'design_work_add_artifact',
  'design_work_new_canvas',
  'design_work_state',
  'design_work_export',
]

test('契约对账：op=14、tools=5、schema=3，名字集合精确相等', () => {
  const info = describe()
  assert.equal(info.plugin, 'design-workspace')
  assert.equal(info.schema, 3)
  assert.equal(info.ops.length, 14)
  assert.deepEqual([...info.ops].sort(), [...EXPECTED_OPS].sort())
  assert.equal(info.tools.length, 5)
  assert.deepEqual([...info.tools].sort(), [...EXPECTED_TOOLS].sort())
})

test('POST /api 走单个 op：ensure → 登记（scope）→ state（scope）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-op-api-'))
  try {
    const ctx = fakeCtx()
    apply(ctx)
    const handler = ctx.servers[0].handler

    const ensured = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'project.ensure', root, title: '接口测试', kind: 'web' } })
    assert.equal(ensured.status, 200)
    assert.equal(ensured.json.ok, true)
    assert.equal(ensured.json.op, 'project.ensure')
    assert.equal(ensured.json.created, true)
    const projectId = ensured.json.project.id
    const canvasId = ensured.json.project.canvases[0].id
    const canvasFile = join(dirname(ensured.json.projectFile), 'canvases', canvasId, 'work.json')
    writeFileSync(join(dirname(canvasFile), 'index.html'), '<html>api</html>')

    const registered = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'artifact.register', root, scope: { projectId, canvasId }, rel: 'index.html', title: '首页' } })
    assert.equal(registered.status, 200)
    assert.equal(registered.json.primary, 'index.html')
    assert.equal(registered.json.work.artifacts.length, 1)

    const state = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'canvas.state', root, scope: { projectId, canvasId } } })
    assert.equal(state.status, 200)
    assert.equal(state.json.work.title, '接口测试')
    assert.equal(state.json.artifactsCount, 1)
    assert.equal(state.json.primary.rel, 'index.html')

    const wire = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'canvas.wire', projectFile: ensured.json.projectFile, canvasId } })
    assert.equal(wire.json.canvasFile.endsWith('work.json'), true)

    const wrongProject = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'canvas.state', root, scope: { projectId: 'p-other', canvasId } } })
    assert.equal(wrongProject.status, 404)
    assert.equal(wrongProject.json.code, 'NOT_FOUND')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('信封只认 code/reason/message，未知 op 与缺项目分别 400/404', async () => {
  const ctx = fakeCtx()
  apply(ctx)
  const handler = ctx.servers[0].handler

  const unknown = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'nope.op' } })
  assert.equal(unknown.status, 400)
  assert.equal(unknown.json.ok, false)
  assert.equal(unknown.json.code, 'BAD_ARGS')
  assert.equal('error' in unknown.json, false)

  const missing = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'project.read', root: join(tmpdir(), 'dsh-none-now') } })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.code, 'NOT_FOUND')
  assert.match(missing.json.message, /项目/)

  const limited = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'project.ensure', root: '', title: 'x' } })
  assert.equal(limited.status, 400)
  assert.equal(limited.json.code, 'BAD_ARGS')
})

test('/api/version 与 /asset：MIME、围栏、HEAD、405', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-op-asset-'))
  try {
    const ctx = fakeCtx()
    apply(ctx)
    const handler = ctx.servers[0].handler

    const version = await call(handler, { url: '/design-workspace/api/version' })
    assert.equal(version.status, 200)
    assert.equal(version.json.schema, 3)
    assert.equal(version.json.routes.includes('POST /api'), true)

    const ensured = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'project.ensure', root, title: '资产测试' } })
    assert.equal(ensured.json.ok, true)

    const denied = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(join(root, 'secret.txt'))}` })
    assert.equal(denied.status, 400)
    assert.equal(denied.json.code, 'FORBIDDEN')

    const missing = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(join(root, '.design-work', 'nope.txt'))}` })
    assert.equal(missing.status, 404)
    assert.equal(missing.json.code, 'NOT_FOUND')

    const target = join(root, '.design-work', 'canvases', 'c-main', 'work.json')
    const served = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(target)}` })
    assert.equal(served.status, 200)
    assert.match(served.headers['content-type'], /application\/json/)
    assert.equal(served.headers['x-content-type-options'], 'nosniff')

    const head = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(target)}`, method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.json, null)

    const wrongMethod = await call(handler, { url: '/design-workspace/api/version', method: 'POST' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.json.code, 'BAD_ARGS')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
