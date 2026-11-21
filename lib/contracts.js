// 对外契约：错误码、细分 reason、信封、路径围栏、参数校验。
// 所有 op 都从这里出发，禁止各模块自造错误字符串或第七个码。
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

// 细分语义走 reason，码集合不扩。对外只读，避免调用方改表。
export const REASON = Object.freeze({
  CANVAS_MIN: 'CANVAS_MIN',
  CANVAS_LIMIT: 'CANVAS_LIMIT',
  CANVAS_NOT_FOUND: 'CANVAS_NOT_FOUND',
  BROWSER_MISSING: 'BROWSER_MISSING',
  NAME_EMPTY: 'NAME_EMPTY',
  PROJECT_MIGRATE_FAIL: 'PROJECT_MIGRATE_FAIL',
  NOT_WORK_FILE: 'NOT_WORK_FILE',
  FENCE: 'FENCE',
  NO_ARTIFACT: 'NO_ARTIFACT',
})

export class OpError extends Error {
  constructor(code, message, reason = '') {
    super(message)
    this.name = 'OpError'
    this.code = code
    if (reason) this.reason = reason
  }
}

export function opError(code, reason, message) {
  return new OpError(code, message, reason)
}

// 任何落盘路径都必须落在 <root>/.design-work 之内。
export function requireInside(rootDir, path, label = 'path') {
  const rel = relative(normalize(rootDir), normalize(path))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw opError(ERR.FORBIDDEN, REASON.FENCE, `${label} 超出交付物目录：${path}`)
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

// 产物 rel 只允许画布内相对路径：拒绝绝对路径、盘符与任何 .. 段。
export function requireRelative(value, label = 'rel', max = 400) {
  const text = requireString(label, value, max).replace(/\\/g, '/')
  if (isAbsolute(text) || /^[A-Za-z]:/.test(text)) {
    throw new OpError(ERR.BAD_ARGS, `${label} 必须是画布内相对路径：${text}`)
  }
  const normalized = text.split('/').filter((part) => part && part !== '.').join('/')
  if (!normalized || normalized.split('/').includes('..')) {
    throw new OpError(ERR.BAD_ARGS, `${label} 不能为空或包含 ..：${text}`)
  }
  return normalized
}

export function optionalNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0, name = 'value' } = {}) {
  if (value == null || value === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) throw new OpError(ERR.BAD_ARGS, `${name} 必须是数字`)
  if (number < min || number > max) throw new OpError(ERR.LIMIT, `${name} 必须在 ${min}–${max} 之间`)
  return Math.round(number)
}

export function optionalBoolean(value) {
  if (value == null) return false
  if (typeof value === 'boolean') return value
  const text = String(value).toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(text)) return true
  if (['false', '0', 'no', 'off', ''].includes(text)) return false
  throw new OpError(ERR.BAD_ARGS, `布尔参数不认识：${String(value)}`)
}

export function toPosix(value) {
  return String(value).replace(/\\/g, '/')
}
