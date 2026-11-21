// CLI 配置层：默认 → 用户 profile → DSHDW_* 环境变量 → --config 文件。
// 只读配置；项目内 project.json 永远不参与，也不提供写配置的命令。
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { ERR, OpError } from './contracts.js'

const PROFILE_PARTS = ['.dsh', 'profiles', 'dshdw.json']
const OUTPUTS = ['human', 'json']
const FIELD_NAMES = ['root', 'projectFile', 'canvasId', 'output', 'browser', 'timeout']

const DEFAULTS = Object.freeze({
  root: '',
  projectFile: null,
  canvasId: null,
  output: 'human',
  browser: null,
  timeout: 10000,
})

const ENV_FIELDS = Object.freeze({
  DSHDW_ROOT: 'root',
  DSHDW_PROJECT_FILE: 'projectFile',
  DSHDW_CANVAS_ID: 'canvasId',
  DSHDW_OUTPUT: 'output',
  DSHDW_JSON: 'json',
  DSHDW_BROWSER: 'browser',
  DSHDW_TIMEOUT: 'timeout',
})

export function profilePath(home = homedir()) {
  return join(home, ...PROFILE_PARTS)
}

function bad(message) {
  return new OpError(ERR.BAD_ARGS, message)
}

function readLayer(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw bad(`${label} 读不出来（需要 JSON）：${err.message}`)
  }
}

function asText(value, name, optional = false) {
  if (value == null || value === '') {
    if (optional) return null
    throw bad(`${name} 不能为空`)
  }
  if (typeof value !== 'string') throw bad(`${name} 必须是字符串`)
  return value
}

function asTimeout(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 100 || number > 600000) throw bad('timeout 必须是 100–600000 的毫秒数')
  return Math.round(number)
}

const VALIDATORS = {
  root: (value) => asText(value, 'root'),
  projectFile: (value) => asText(value, 'projectFile', true),
  canvasId: (value) => asText(value, 'canvasId', true),
  output: (value) => {
    if (!OUTPUTS.includes(value)) throw bad(`output 只能是 ${OUTPUTS.join('/')}`)
    return value
  },
  browser: (value) => asText(value, 'browser', true),
  timeout: (value) => asTimeout(value),
}

function validate(patch, label) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw bad(`${label} 必须是对象`)
  const clean = {}
  for (const key of Object.keys(patch)) {
    if (!FIELD_NAMES.includes(key)) throw bad(`${label} 有不认识的字段：${key}`)
    clean[key] = VALIDATORS[key](patch[key])
  }
  return clean
}

function envLayer(env) {
  const patch = {}
  const used = []
  for (const [name, field] of Object.entries(ENV_FIELDS)) {
    const value = env[name]
    if (value == null || value === '') continue
    used.push(name)
    if (field === 'json') {
      patch.output = ['0', 'false', 'no', 'off'].includes(String(value).toLowerCase()) ? 'human' : 'json'
      continue
    }
    patch[field] = field === 'timeout' ? asTimeout(value) : asText(value, name, field !== 'root')
  }
  return { patch, used }
}

export function readProfile(home = homedir()) {
  const file = profilePath(home)
  if (!existsSync(file)) return null
  return validate(readLayer(file, 'profile'), 'profile')
}

export function loadConfig({ cwd = process.cwd(), env = process.env, home = homedir(), configFile = '' } = {}) {
  const config = { ...DEFAULTS, root: cwd }
  const sources = []
  const profile = profilePath(home)
  const fromProfile = readProfile(home)
  if (fromProfile) {
    config.root = cwd
    Object.assign(config, fromProfile)
    sources.push('profile')
  }
  const fromEnv = envLayer(env)
  Object.assign(config, fromEnv.patch)
  if (fromEnv.used.length) sources.push(`env:${fromEnv.used.join(',')}`)

  const explicit = configFile || env.DSHDW_CONFIG
  if (explicit) {
    const file = resolve(cwd, explicit)
    if (!existsSync(file)) throw bad(`配置文件不存在：${file}`)
    Object.assign(config, validate(readLayer(file, 'config'), 'config'))
    sources.push('config')
  }

  config.root = resolve(cwd, config.root || '.')
  if (config.projectFile) config.projectFile = resolve(cwd, config.projectFile)
  return { config, sources, profileFile: profile }
}

export function redactValue(value) {
  if (value == null || value === '') return value
  if (typeof value !== 'string') return value
  if (!/[\\/]/.test(value) && !/^[A-Za-z]:/.test(value)) return value
  const parts = value.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return `…/${basename(parts.join('/')) || parts.at(-1) || value}`
}
