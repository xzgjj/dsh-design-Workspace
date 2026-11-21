// dsh-design-workspace · Host 半片
// 职责：注册工具、开一个 /design-workspace 前缀网关（单 op 端点 + 只读资产 + 版本自检）。
// 不注册 main 面板、不做 iframe 壳、不跑模型、不发明第二套路由。
import { existsSync, readFileSync } from 'node:fs'
import { extname, isAbsolute, normalize } from 'node:path'
import { readState } from './store.js'
import { TOOLS } from './tools.js'
import { OPS, dispatch } from './ops.js'
import { ERR, OpError, PLUGIN_VERSION, SCHEMA_VERSION } from './contracts.js'

export const name = 'design-workspace'
export const inject = ['webServer', 'tools']

const BASE = '/design-workspace'
const BODY_LIMIT = 1_000_000
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}


async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return JSON.parse(req.body)
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new OpError(ERR.LIMIT, '请求体超过 1MB')
    chunks.push(chunk)
  }
  if (!size) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function assetPath(value) {
  if (typeof value !== 'string' || !isAbsolute(normalize(value))) throw new OpError(ERR.BAD_ARGS, 'asset 需要绝对路径')
  const path = normalize(value)
  if (!/[\\/]\.design-work[\\/]/.test(path)) throw new OpError(ERR.FORBIDDEN, 'asset 只读 .design-work 内的文件')
  if (!existsSync(path)) throw new OpError(ERR.NOT_FOUND, `资产不存在：${path}`)
  return path
}

function handleAsset(url, res) {
  const path = assetPath(url.searchParams.get('path') || '')
  res.statusCode = 200
  res.setHeader('content-type', TYPES[extname(path).toLowerCase()] || 'application/octet-stream')
  res.setHeader('cache-control', 'no-store')
  res.end(readFileSync(path))
}

async function handlePost(req, res) {
  const payload = await readJsonBody(req)
  const op = payload.op
  const args = { ...payload }
  delete args.op
  const result = await dispatch(op, args)
  return sendJson(res, 200, { ok: true, op, ...result })
}

function versionBody() {
  return {
    ok: true,
    plugin: name,
    version: PLUGIN_VERSION,
    schema: SCHEMA_VERSION,
    ops: OPS,
    tools: TOOLS.map((tool) => tool.name),
    routes: ['/api/health', '/api/version', '/api/state', 'POST /api', '/asset'],
  }
}

function legacyState(url, res) {
  // 旧接口保留给右栏页签：路径非法时按 400 回，不升级成 500。
  try {
    return sendJson(res, 200, readState(url.searchParams.get('path') || ''))
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: String(err?.message || err) })
  }
}

const GET_ROUTES = {
  '/api/health': (_url, res) => sendJson(res, 200, { ok: true, plugin: name, version: PLUGIN_VERSION }),
  '/api/version': (_url, res) => sendJson(res, 200, versionBody()),
  '/api/state': legacyState,
  '/asset': handleAsset,
}

function handleGet(url, res) {
  const rest = url.pathname.slice(BASE.length) || '/'
  const route = GET_ROUTES[rest]
  if (route) return route(url, res)
  return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' })
}

function methodNotAllowed(res) {
  return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
}

function sendError(res, err) {
  if (err instanceof OpError) {
    const status = err.code === ERR.NOT_FOUND ? 404 : 400
    return sendJson(res, status, { ok: false, error: err.code, message: err.message })
  }
  return sendJson(res, 500, { ok: false, error: ERR.INTERNAL, message: String(err?.message || err) })
}

async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://x')
  const rest = url.pathname.slice(BASE.length) || '/'
  try {
    if (req.method !== 'GET') {
      if (rest === '/api' && req.method === 'POST') return await handlePost(req, res)
      return methodNotAllowed(res)
    }
    return handleGet(url, res)
  } catch (err) {
    return sendError(res, err)
  }
}

export function apply(ctx) {
  for (const tool of TOOLS) ctx.tools.register(tool)

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: BASE,
      handler,
    }),
  )
}

// 供自检脚本直接读：不发请求也能拿到版本与 op 表。
export function describe() {
  return { plugin: name, version: PLUGIN_VERSION, schema: SCHEMA_VERSION, ops: OPS, tools: TOOLS.map((tool) => tool.name) }
}

