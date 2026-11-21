import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../lib/index.js'
import { createWork } from '../../lib/store.js'

function fakeCtx() {
  const registered = []
  const servers = []
  return {
    tools: { register: (tool) => registered.push(tool) },
    webServer: {
      register: (entry) => {
        servers.push(entry)
        return entry
      },
    },
    effect: (fn) => fn(),
    registered,
    servers,
  }
}

async function call(handler, { url, method = 'GET' }) {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader: (key, value) => {
      res.headers[key] = value
    },
    end: (body) => {
      res.body = body
    },
  }
  await handler({ url, method }, res)
  return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null }
}

test('apply 注册工具与 /design-workspace 路由', () => {
  const ctx = fakeCtx()
  apply(ctx)
  assert.equal(ctx.registered.length, 2)
  assert.equal(ctx.servers.length, 1)
  assert.equal(ctx.servers[0].path, '/design-workspace')
  assert.equal(ctx.servers[0].kind, 'prefix')
})

test('health 返回插件名', async () => {
  const ctx = fakeCtx()
  apply(ctx)
  const res = await call(ctx.servers[0].handler, { url: '/design-workspace/api/health' })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.plugin, 'design-workspace')
  assert.match(res.headers['content-type'], /application\/json/)
})

test('state 串起 Host API 与 store，并拒绝越界路径', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-host-api-'))
  try {
    const { file } = createWork({ root, title: '集成测试' })
    const ctx = fakeCtx()
    apply(ctx)

    const ok = await call(ctx.servers[0].handler, {
      url: `/design-workspace/api/state?path=${encodeURIComponent(file)}`,
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.work.title, '集成测试')
    assert.equal(ok.body.artifactsCount, 0)

    const bad = await call(ctx.servers[0].handler, { url: '/design-workspace/api/state?path=/tmp/work.json' })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('state 只接受 GET', async () => {
  const ctx = fakeCtx()
  apply(ctx)
  const res = await call(ctx.servers[0].handler, { url: '/design-workspace/api/state', method: 'POST' })
  assert.equal(res.status, 405)
  assert.equal(res.body.error, 'METHOD_NOT_ALLOWED')
})
