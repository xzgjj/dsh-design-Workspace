import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
      res.headers[key] = value
    },
    end: (value) => {
      res.chunks.push(value)
    },
  }
  const req = { url, method, body }
  return Promise.resolve(handler(req, res)).then(() => ({
    status: res.statusCode,
    headers: res.headers,
    json: res.chunks.length ? JSON.parse(Buffer.concat(res.chunks.map((c) => Buffer.from(c))).toString('utf8')) : null,
  }))
}

test('describe 暴露版本、op 表与工具名', () => {
  const info = describe()
  assert.equal(info.plugin, 'design-workspace')
  assert.equal(info.schema, 3)
  assert.equal(info.ops.includes('version.restore'), true)
  assert.equal(info.ops.includes('export.run'), true)
  assert.equal(info.tools.length, 2)
})

test('POST /api 走单个 op 端点：ensure → canvas.state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-op-api-'))
  try {
    const ctx = fakeCtx()
    apply(ctx)
    const handler = ctx.servers[0].handler

    const ensured = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'project.ensure', root, title: '接口测试' } })
    assert.equal(ensured.status, 200)
    assert.equal(ensured.json.ok, true)
    assert.equal(ensured.json.op, 'project.ensure')
    assert.equal(ensured.json.created, true)
    const canvasFile = ensured.json.project.canvases[0].id

    const wire = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'canvas.wire', projectFile: ensured.json.projectFile, canvasId: canvasFile } })
    assert.equal(wire.json.canvasFile.endsWith('work.json'), true)

    const state = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'canvas.state', canvasFile: wire.json.canvasFile } })
    assert.equal(state.json.artifactsCount, 0)
    assert.equal(state.json.work.title, '主画布')

    const unknown = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'nope.op' } })
    assert.equal(unknown.status, 400)
    assert.equal(unknown.json.error, 'BAD_ARGS')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('/api/version 与 /asset 围栏', async () => {
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
    assert.equal(denied.json.error, 'FORBIDDEN')

    const target = join(ensured.json.projectFile.replace(/[\\/]project\.json$/, ''), 'canvases', 'c-main', 'work.json')
    const served = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(target)}` })
    assert.equal(served.status, 200)
    assert.match(served.headers['content-type'], /application\/json/)

    const wrongMethod = await call(handler, { url: '/design-workspace/api/version', method: 'POST' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.json.error, 'METHOD_NOT_ALLOWED')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
