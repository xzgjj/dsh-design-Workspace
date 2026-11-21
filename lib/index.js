// dsh-design-workspace · Host 半片
// 职责：注册 5 个工具、开一个 /design-workspace 前缀网关（单 op 端点 + 只读资产 + 自检）。
// 不注册 main 面板、不做 iframe 壳、不跑模型、不发明第二套路由。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, normalize } from 'node:path'
import { TOOLS } from './tools.js'
import { OPS, dispatch } from './ops.js'
import { createTransport, errorEnvelope, httpStatus } from './transport.js'
import { ERR, OpError, PLUGIN_VERSION, SCHEMA_VERSION } from './contracts.js'

export const name = 'design-workspace'
export const inject = ['webServer', 'tools']

const BASE = '/design-workspace'
const BODY_LIMIT = 1_000_000
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

const transport = createTransport({ dispatch })

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
  if (!statSync(path).isFile()) throw new OpError(ERR.FORBIDDEN, 'asset 只读单个文件，不列目录')
  return path
}

function handleAsset(url, res, headOnly = false) {
  const path = assetPath(url.searchParams.get('path') || '')
  res.statusCode = 200
  res.setHeader('content-type', TYPES[extname(path).toLowerCase()] || 'application/octet-stream')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  if (headOnly) return res.end()
  res.end(readFileSync(path))
}

async function handlePost(req, res) {
  const payload = await readJsonBody(req)
  const op = payload.op
  const args = { ...payload }
  delete args.op
  const envelope = await transport.call(op, args)
  return sendJson(res, httpStatus(envelope), envelope)
}

function versionBody() {
  return {
    ok: true,
    plugin: name,
    version: PLUGIN_VERSION,
    schema: SCHEMA_VERSION,
    ops: OPS,
    tools: TOOLS.map((tool) => tool.name),
    routes: ['/api/health', '/api/version', 'POST /api', '/asset'],
  }
}

const GET_ROUTES = {
  '/api/health': (_url, res) => sendJson(res, 200, { ok: true, plugin: name, version: PLUGIN_VERSION }),
  '/api/version': (_url, res) => sendJson(res, 200, versionBody()),
  '/asset': (url, res) => handleAsset(url, res, false),
}

function handleGet(url, res, headOnly = false) {
  const rest = url.pathname.slice(BASE.length) || '/'
  if (rest === '/asset') return handleAsset(url, res, headOnly)
  const route = GET_ROUTES[rest]
  if (route) return route(url, res)
  return sendJson(res, 404, { ok: false, code: ERR.NOT_FOUND, message: `未知路由：${rest}` })
}

function methodNotAllowed(res) {
  return sendJson(res, 405, { ok: false, code: ERR.BAD_ARGS, message: '只支持 GET/HEAD/POST' })
}

function sendError(res, err) {
  const envelope = errorEnvelope(err)
  return sendJson(res, httpStatus(envelope), envelope)
}

async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://x')
  const rest = url.pathname.slice(BASE.length) || '/'
  try {
    if (req.method === 'POST') {
      if (rest === '/api') return await handlePost(req, res)
      return methodNotAllowed(res)
    }
    if (req.method === 'GET' || req.method === 'HEAD') return handleGet(url, res, req.method === 'HEAD')
    return methodNotAllowed(res)
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
