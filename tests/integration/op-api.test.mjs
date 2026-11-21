import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  return Promise.resolve(handler(req, res)).then(() => {
    const raw = res.chunks.length ? Buffer.concat(res.chunks.map((c) => Buffer.from(c))).toString('utf8') : ''
    const type = res.headers['content-type'] || ''
    return {
      status: res.statusCode,
      headers: res.headers,
      text: raw,
      json: raw && /json/.test(type) ? JSON.parse(raw) : null,
    }
  })
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

test('version 快照/列表/恢复走 scope，恢复前自动存档', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-op-ver-'))
  try {
    const ctx = fakeCtx()
    apply(ctx)
    const handler = ctx.servers[0].handler
    const ensured = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'project.ensure', root, title: '版本接口' } })
    const canvasPath = join(dirname(ensured.json.projectFile), 'canvases', 'c-main')
    writeFileSync(join(canvasPath, 'index.html'), '<html>v1</html>')

    const snap = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'version.snapshot', root, scope: { canvasId: 'c-main' }, label: '初稿' } })
    assert.equal(snap.status, 200)
    assert.equal(snap.json.version.id, 'v001')

    writeFileSync(join(canvasPath, 'index.html'), '<html>v2</html>')
    const listed = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'version.list', root, scope: { canvasId: 'c-main' } } })
    assert.equal(listed.json.total, 1)

    const restored = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'version.restore', root, scope: { canvasId: 'c-main' }, versionId: 'v001' } })
    assert.equal(restored.json.restored, 'v001')
    assert.equal(readFileSync(join(canvasPath, 'index.html'), 'utf8'), '<html>v1</html>')
    const after = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'version.list', root, scope: { canvasId: 'c-main' } } })
    assert.equal(after.json.latest.source, 'pre-restore')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('asset：page 切片、thumb 查找、静态资源 max-age；export.run 走 op', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-op-page-'))
  try {
    const ctx = fakeCtx()
    apply(ctx)
    const handler = ctx.servers[0].handler
    const ensured = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'project.ensure', root, title: '分页测试' } })
    const canvasPath = join(dirname(ensured.json.projectFile), 'canvases', 'c-main')
    writeFileSync(join(canvasPath, 'index.html'), '<html><head><title>x</title></head><body><section>P1</section><section>P2</section></body></html>')
    writeFileSync(join(canvasPath, 'style.css'), 'body{}')
    const mkdirThumb = join(canvasPath, 'thumbs')
    mkdirSync(mkdirThumb, { recursive: true })
    writeFileSync(join(mkdirThumb, 'index.png'), 'png-bytes')

    const page2 = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(join(canvasPath, 'index.html'))}&page=2` })
    assert.equal(page2.status, 200)
    assert.equal(page2.headers['x-page'], '2')
    assert.match(page2.text, /P2/)

    const page9 = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(join(canvasPath, 'index.html'))}&page=9` })
    assert.equal(page9.status, 200)
    assert.equal(page9.headers['x-page-missing'], '1')

    const pageCss = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(join(canvasPath, 'style.css'))}&page=2` })
    assert.equal(pageCss.status, 400)
    assert.equal(pageCss.json.code, 'BAD_ARGS')

    const css = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(join(canvasPath, 'style.css'))}` })
    assert.equal(css.status, 200)
    assert.match(css.headers['cache-control'], /max-age=60/)

    const thumb = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(join(canvasPath, 'index.html'))}&thumb=1` })
    assert.equal(thumb.status, 200)
    assert.match(thumb.headers['content-type'], /image\/png/)

    mkdirSync(join(canvasPath, 'artifacts'), { recursive: true })
    writeFileSync(join(canvasPath, 'artifacts', 'deck.html'), '<html><body><section>deck</section></body></html>')
    writeFileSync(join(mkdirThumb, 'deck.png'), 'deck-png')
    const nestedThumb = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(join(canvasPath, 'artifacts', 'deck.html'))}&thumb=1` })
    assert.equal(nestedThumb.status, 200)
    assert.equal(nestedThumb.text, 'deck-png')

    const noThumb = await call(handler, { url: `/design-workspace/asset?path=${encodeURIComponent(join(canvasPath, 'style.css'))}&thumb=1` })
    assert.equal(noThumb.status, 404)
    assert.equal(noThumb.json.code, 'NOT_FOUND')

    const exported = await call(handler, { url: '/design-workspace/api', method: 'POST', body: { op: 'export.run', root, scope: { canvasId: 'c-main' }, format: 'html', stamp: 'op' } })
    assert.equal(exported.status, 200)
    assert.equal(exported.json.ok, true)
    assert.equal(exported.json.format, 'html')
    assert.equal(exported.json.fileCount >= 1, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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
