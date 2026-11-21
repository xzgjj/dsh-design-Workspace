// dsh-design-workspace · Host 半片
// 职责：注册 5 个工具、开一个 /design-workspace 前缀网关（单 op 端点 + 只读资产 + 自检）。
// 不注册 main 面板、不做 iframe 壳、不跑模型、不发明第二套路由。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, normalize, sep } from 'node:path'
import { TOOLS } from './tools.js'
import { OPS, dispatch } from './ops.js'
import { createTransport, errorEnvelope, httpStatus } from './transport.js'
import { ERR, OpError, PLUGIN_VERSION, SCHEMA_VERSION, optionalBoolean, optionalNumber } from './contracts.js'

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
  const thumb = optionalBoolean(url.searchParams.get('thumb'))
  if (thumb) return serveThumb(path, res, headOnly)
  const page = pageOf(url)
  if (page) return servePage(path, page, res, headOnly)
  sendFile(res, path, headOnly)
}

function sendFile(res, path, headOnly = false, type = '') {
  const ext = extname(path).toLowerCase()
  const mime = type || TYPES[ext] || 'application/octet-stream'
  const cache = ext === '.html' || ext === '.htm' || ext === '.json' ? 'no-store' : 'public, max-age=60'
  res.statusCode = 200
  res.setHeader('content-type', mime)
  res.setHeader('cache-control', cache)
  res.setHeader('x-content-type-options', 'nosniff')
  if (headOnly) return res.end()
  res.end(readFileSync(path))
}

function canvasRootOf(file) {
  const marker = `${sep}canvases${sep}`
  const at = file.indexOf(marker)
  if (at < 0) return dirname(file)
  const id = file.slice(at + marker.length).split(sep)[0]
  if (!id) return dirname(file)
  return file.slice(0, at + marker.length + id.length)
}

function serveThumb(path, res, headOnly) {
  const thumb = join(canvasRootOf(path), 'thumbs', `${basename(path, extname(path))}.png`)
  if (!existsSync(thumb)) throw new OpError(ERR.NOT_FOUND, '还没有缩略图')
  sendFile(res, thumb, headOnly, 'image/png')
}

function pageOf(url) {
  const raw = url.searchParams.get('page')
  if (raw == null || raw === '') return 0
  return optionalNumber(raw, { min: 1, max: 200, name: 'page' })
}

function sectionOf(html, page) {
  const sections = [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)].map((match) => match[0])
  if (sections.length < page) return ''
  const head = /<head[\s\S]*?<\/head>/i.exec(html)?.[0] || ''
  return `<!doctype html><html>${head}<body>${sections[page - 1]}</body></html>`
}

function servePage(path, page, res, headOnly) {
  const ext = extname(path).toLowerCase()
  if (ext !== '.html' && ext !== '.htm') throw new OpError(ERR.BAD_ARGS, 'page 只对 html 产物有效')
  const html = readFileSync(path, 'utf8')
  const slice = sectionOf(html, page)
  if (!slice) {
    res.setHeader('x-page-missing', '1')
    return sendFile(res, path, headOnly, 'text/html; charset=utf-8')
  }
  res.statusCode = 200
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-page', String(page))
  if (headOnly) return res.end()
  return res.end(slice)
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
