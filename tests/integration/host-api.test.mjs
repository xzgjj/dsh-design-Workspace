import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { apply } from '../../lib/index.js'

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader: (key, value) => {
      res.headers[key.toLowerCase()] = value
    },
    end: (body) => {
      res.body = body || ''
    },
  }
  return res
}

async function send(handler, req) {
  const res = makeRes()
  await handler(req, res)
  return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null }
}

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
      res.headers[key.toLowerCase()] = value
    },
    end: (body) => {
      res.body = body || ''
    },
  }
  await handler({ url, method }, res)
  return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null }
}

test('apply 注册 5 个工具与 /design-workspace 前缀路由', () => {
  const ctx = fakeCtx()
  apply(ctx)
  assert.equal(ctx.registered.length, 5)
  assert.deepEqual(ctx.registered.map((tool) => tool.name), [
    'design_work_start',
    'design_work_add_artifact',
    'design_work_new_canvas',
    'design_work_state',
    'design_work_export',
  ])
  assert.equal(ctx.servers.length, 1)
  assert.equal(ctx.servers[0].path, '/design-workspace')
  assert.equal(ctx.servers[0].kind, 'prefix')
})

test('health 返回插件名与缓存头', async () => {
  const ctx = fakeCtx()
  apply(ctx)
  const res = await call(ctx.servers[0].handler, { url: '/design-workspace/api/health' })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.plugin, 'design-workspace')
  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('工具链路 start → 写产物 → 登记 → state → 导出（不经过 HTTP）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-host-api-'))
  try {
    const ctx = fakeCtx()
    apply(ctx)
    const [start, addArtifact, , state, exportTool] = ctx.registered

    const started = await start.execute({ root, title: '集成测试', kind: 'web' })
    assert.equal(started.created, true)
    const canvasPath = dirname(started.canvasFile)
    writeFileSync(join(canvasPath, 'index.html'), '<html><body>host</body></html>')

    const added = await addArtifact.execute({ canvasFile: started.canvasFile, rel: 'index.html', title: '首页' })
    assert.equal(added.artifactsCount, 1)

    const st = await state.execute({ canvasFile: started.canvasFile })
    assert.equal(st.title, '集成测试')
    assert.equal(st.artifactsCount, 1)
    assert.equal(st.primary, 'index.html')

    const exported = await exportTool.execute({ canvasFile: started.canvasFile, format: 'html', stamp: 'host' })
    assert.equal(existsSync(join(exported.dir, 'site', 'index.html')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('POST /api 支持对象/字符串/流式 body；超 1MB 与非 GET/POST 方法拒绝', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-host-body-'))
  try {
    const ctx = fakeCtx()
    apply(ctx)
    const handler = ctx.servers[0].handler
    const url = '/design-workspace/api'

    const stringBody = await send(handler, { url, method: 'POST', body: JSON.stringify({ op: 'project.ensure', root }) })
    assert.equal(stringBody.status, 200)
    assert.equal(stringBody.body.ok, true)

    const streamed = await send(handler, Object.assign(Readable.from([Buffer.from(JSON.stringify({ op: 'project.ensure', root }))]), { url, method: 'POST' }))
    assert.equal(streamed.status, 200)
    assert.equal(streamed.body.created, false)

    const tooLarge = await send(handler, Object.assign(Readable.from([Buffer.alloc(1_000_001)]), { url, method: 'POST' }))
    assert.equal(tooLarge.status, 400)
    assert.equal(tooLarge.body.code, 'LIMIT')

    const wrongMethod = await send(handler, { url, method: 'DELETE' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.body.code, 'BAD_ARGS')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('旧 /api/state 已下线，只留 POST /api + GET 旁路', async () => {
  const ctx = fakeCtx()
  apply(ctx)
  const gone = await call(ctx.servers[0].handler, { url: '/design-workspace/api/state?path=/tmp/work.json' })
  assert.equal(gone.status, 404)
  assert.equal(gone.body.ok, false)
  assert.equal(gone.body.code, 'NOT_FOUND')

  const method = await call(ctx.servers[0].handler, { url: '/design-workspace/api/health', method: 'POST' })
  assert.equal(method.status, 405)
  assert.equal(method.body.ok, false)
})
