// 对外契约：错误码、信封、路径围栏、参数校验。
// 所有 op 都从这里出发，禁止各模块自造错误字符串。
import { isAbsolute, normalize, relative } from 'node:path'

export const PLUGIN_VERSION = '0.2.0'
export const SCHEMA_VERSION = 3

export const ERR = {
  BAD_ARGS: 'BAD_ARGS',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
  LIMIT: 'LIMIT',
  INTERNAL: 'INTERNAL',
}

export class OpError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OpError'
    this.code = code
  }
}


// 任何落盘路径都必须落在 <root>/.design-work 之内。
export function requireInside(rootDir, path, label = 'path') {
  const rel = relative(rootDir, normalize(path))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new OpError(ERR.FORBIDDEN, `${label} 超出交付物目录：${path}`)
  }
  return path
}

export function requireString(name, value, max = 200) {
  if (typeof value !== 'string' || !value.trim()) throw new OpError(ERR.BAD_ARGS, `缺少 ${name}`)
  const text = value.trim()
  if (text.length > max) throw new OpError(ERR.LIMIT, `${name} 超过 ${max} 字`)
  return text
}

export function optionalString(value, max = 200) {
  if (value == null) return ''
  if (typeof value !== 'string') throw new OpError(ERR.BAD_ARGS, `参数必须是字符串：${String(value)}`)
  return value.trim().slice(0, max)
}
