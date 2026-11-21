// dsh-design-workspace · Host 半片
// 职责只有三件：注册工具、开一个只读状态接口、把交付物路径围栏在 .design-work 内。
// 不注册 main 面板、不做 iframe 壳、不跑模型。
import { readState } from './store.js'
import { TOOLS } from './tools.js'

export const name = 'design-workspace'
export const inject = ['webServer', 'tools']

const BASE = '/design-workspace'

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export function apply(ctx) {
  for (const tool of TOOLS) ctx.tools.register(tool)

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: BASE,
      async handler(req, res) {
        const url = new URL(req.url || '/', 'http://x')
        const rest = url.pathname.slice(BASE.length) || '/'
        try {
          if (rest === '/api/health') return sendJson(res, 200, { ok: true, plugin: name })
          if (rest === '/api/state') {
            if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
            const file = url.searchParams.get('path') || ''
            return sendJson(res, 200, readState(file))
          }
          return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' })
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: String(err?.message || err) })
        }
      },
    }),
  )
}
