// 本机 CLI：子命令是 13 个 op 的薄映射，op 直通覆盖冻结 14 个；doctor/config 属本地层。
// 不起 HTTP、不写项目内配置、不新增 op；所有领域动作都走 dispatch。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canvasWorkFile } from './project.js'
import { OPS, dispatch } from './ops.js'
import { TOOLS } from './tools.js'
import { ERR, OpError, PLUGIN_VERSION, SCHEMA_VERSION } from './contracts.js'
import { loadConfig, redactValue } from './cli-config.js'
import { runDoctor } from './cli-doctor.js'

const BOOLEAN_FLAGS = new Set(['json', 'dry-run', 'stdin', 'help', 'version', 'primary'])
const VALUE_FLAGS = new Set([
  'root', 'project-file', 'canvas-file', 'canvas-id', 'config', 'timeout', 'browser',
  'title', 'kind', 'label', 'source', 'format', 'stamp', 'pages', 'args',
])
const EXIT_CODES = Object.freeze({ BAD_ARGS: 2, NOT_FOUND: 3, CONFLICT: 4, FORBIDDEN: 5, LIMIT: 6, INTERNAL: 7, DOCTOR: 8 })

const USAGE = `dshdw — 交付物画布的本机辅助入口

用法：
  dshdw <资源> <动作> [位置参数] [--flags]
  dshdw op <opName> [--args '<json>' | --stdin] [--dry-run]
  dshdw doctor | dshdw config show | dshdw --version | dshdw --help

命令：
  project ensure                 确保项目与默认画布（project.ensure）
  project inspect                项目与画布概览（project.inspect）
  project rename <name>          改项目名（project.rename）
  canvas create                  新建画布并设为当前（canvas.create）
  canvas select <id>             切当前画布（project.select）
  canvas remove <id>             归档并摘除画布（canvas.remove）
  canvas state                   读画布状态与产物（canvas.state）
  artifact add <rel>             登记产物（artifact.register）
  version list                   列快照（version.list）
  version snapshot               存快照（version.snapshot）
  version restore <id>           恢复快照（version.restore）
  export run                     整树导出（export.run）
  op <opName>                    直通 14 op（脚本/CI）
  doctor                         环境自检（本地，不入 op 表）
  config show                    生效配置（脱敏）

全局旗标：
  --root <dir>            工作区根（默认 cwd / profile.root）
  --project-file <path>   项目索引
  --canvas-file <path>    画布 work.json
  --canvas-id <id>        配合项目索引定位画布
  --config <path>         追加配置文件（高于环境变量）
  --timeout <ms>          单次 op 超时（默认 10000）
  --json                  机器信封
  --dry-run               只打印 op 与 args，不执行
  --stdin                 op 参数从 stdin 读 JSON
  --args '<json>'         op 参数对象

退出码：0 成功；2 BAD_ARGS；3 NOT_FOUND；4 CONFLICT；5 FORBIDDEN；6 LIMIT；7 INTERNAL；8 doctor 未就绪；1 兜底。
`

const COMMANDS = {
  'project ensure': { op: 'project.ensure', min: 0, max: 0, build: (ctx) => ({ root: ctx.config.root, title: ctx.flags.title, kind: ctx.flags.kind }) },
  'project inspect': { op: 'project.inspect', min: 0, max: 0, build: (ctx) => inspectArgs(ctx) },
  'project rename': { op: 'project.rename', min: 1, max: 1, build: (ctx) => ({ projectFile: projectFileOf(ctx), name: ctx.words[0] }) },
  'canvas create': { op: 'canvas.create', min: 0, max: 0, build: (ctx) => ({ projectFile: projectFileOf(ctx), title: ctx.flags.title, kind: ctx.flags.kind }) },
  'canvas select': { op: 'project.select', min: 1, max: 1, build: (ctx) => ({ projectFile: projectFileOf(ctx), canvasId: ctx.words[0] }) },
  'canvas remove': { op: 'canvas.remove', min: 1, max: 1, build: (ctx) => ({ projectFile: projectFileOf(ctx), canvasId: ctx.words[0] }) },
  'canvas state': { op: 'canvas.state', min: 0, max: 0, build: async (ctx) => ({ canvasFile: await canvasFileOf(ctx) }) },
  'artifact add': {
    op: 'artifact.register',
    min: 1,
    max: 1,
    build: async (ctx) => ({
      canvasFile: await canvasFileOf(ctx),
      rel: ctx.words[0],
      kind: ctx.flags.kind,
      title: ctx.flags.title,
      pages: ctx.flags.pages,
      primary: ctx.flags.primary,
    }),
  },
  'version list': { op: 'version.list', min: 0, max: 0, build: async (ctx) => ({ canvasFile: await canvasFileOf(ctx) }) },
  'version snapshot': {
    op: 'version.snapshot',
    min: 0,
    max: 0,
    build: async (ctx) => ({ canvasFile: await canvasFileOf(ctx), label: ctx.flags.label, source: ctx.flags.source }),
  },
  'version restore': { op: 'version.restore', min: 1, max: 1, build: async (ctx) => ({ canvasFile: await canvasFileOf(ctx), versionId: ctx.words[0] }) },
  'export run': {
    op: 'export.run',
    min: 0,
    max: 0,
    build: async (ctx) => ({ canvasFile: await canvasFileOf(ctx), format: ctx.flags.format || 'html', stamp: ctx.flags.stamp }),
  },
}

function prune(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''))
}

function flagKind(name) {
  if (BOOLEAN_FLAGS.has(name)) return 'bool'
  if (VALUE_FLAGS.has(name)) return 'value'
  throw new OpError(ERR.BAD_ARGS, `不认识的旗标：--${name}`)
}

function takeNext(argv, index, name) {
  const next = argv[index + 1]
  if (next == null || String(next).startsWith('--')) throw new OpError(ERR.BAD_ARGS, `--${name} 缺少值`)
  return String(next)
}

function consumeFlag(argv, index, flags) {
  const body = String(argv[index]).slice(2)
  const eq = body.indexOf('=')
  const name = eq >= 0 ? body.slice(0, eq) : body
  if (flagKind(name) === 'bool') {
    flags[name] = true
    return index
  }
  flags[name] = eq >= 0 ? body.slice(eq + 1) : takeNext(argv, index, name)
  return eq >= 0 ? index : index + 1
}

function parseArgv(argv) {
  const flags = {}
  const words = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index])
    if (arg === '--') {
      words.push(...argv.slice(index + 1))
      break
    }
    if (!arg.startsWith('--')) {
      words.push(arg)
      continue
    }
    index = consumeFlag(argv, index, flags)
  }
  return { flags, words }
}

function projectFileOf(ctx) {
  if (ctx.flags['project-file']) return resolve(ctx.cwd, ctx.flags['project-file'])
  if (ctx.config.projectFile) return ctx.config.projectFile
  return resolve(ctx.config.root, '.design-work', 'project.json')
}

function inspectArgs(ctx) {
  if (ctx.flags['project-file']) return { projectFile: resolve(ctx.cwd, ctx.flags['project-file']) }
  if (ctx.config.projectFile) return { projectFile: ctx.config.projectFile }
  return { root: ctx.config.root }
}

// 画布解析顺序：--canvas-file → canvasId + 项目索引 → 项目 activeCanvasId。
async function canvasFileOf(ctx) {
  if (ctx.flags['canvas-file']) return resolve(ctx.cwd, ctx.flags['canvas-file'])
  const projectFile = projectFileOf(ctx)
  const canvasId = ctx.flags['canvas-id'] || ctx.config.canvasId
  if (canvasId) return canvasWorkFile(projectFile, canvasId)
  const read = await dispatch('project.read', { projectFile })
  return canvasWorkFile(projectFile, read.project.activeCanvasId)
}

function tooMany(definition, words) {
  if (words.length < definition.min) throw new OpError(ERR.BAD_ARGS, '缺少位置参数')
  if (words.length > definition.max) throw new OpError(ERR.BAD_ARGS, `多余的参数：${words.join(' ')}`)
}

function localCommand(words) {
  if (words[0] === 'doctor') {
    if (words.length > 1) throw new OpError(ERR.BAD_ARGS, `doctor 不接受位置参数：${words.slice(1).join(' ')}`)
    return { name: 'doctor', spec: { local: 'doctor' } }
  }
  if (words[0] === 'config' && words[1] === 'show') {
    if (words.length > 2) throw new OpError(ERR.BAD_ARGS, `config show 不接受位置参数：${words.slice(2).join(' ')}`)
    return { name: 'config show', spec: { local: 'config' }, rest: [] }
  }
  if (words[0] !== 'op') return null
  if (!words[1]) throw new OpError(ERR.BAD_ARGS, 'op 缺少 opName')
  if (words.length > 2) throw new OpError(ERR.BAD_ARGS, `op 只接一个 opName：${words.slice(2).join(' ')}`)
  return { name: 'op', spec: { local: 'op' }, rest: [], opName: words[1] }
}

function resolveCommand(words) {
  if (!words.length) return null
  const local = localCommand(words)
  if (local) return local
  if (words.length < 2) throw new OpError(ERR.BAD_ARGS, `不认识命令：${words.join(' ')}`)
  const name = `${words[0]} ${words[1]}`
  const spec = COMMANDS[name]
  if (!spec) throw new OpError(ERR.BAD_ARGS, `不认识命令：${name}`)
  return { name, spec, rest: words.slice(2) }
}

function opArgs(ctx, extra) {
  const fromArgs = ctx.flags.args ? parseJson(ctx.flags.args, '--args') : {}
  const fromStdin = ctx.flags.stdin ? parseJson(ctx.stdinText, '--stdin') : {}
  const pathFlags = prune({
    root: ctx.flags.root ? resolve(ctx.cwd, ctx.flags.root) : undefined,
    projectFile: ctx.flags['project-file'] ? resolve(ctx.cwd, ctx.flags['project-file']) : undefined,
    canvasFile: ctx.flags['canvas-file'] ? resolve(ctx.cwd, ctx.flags['canvas-file']) : undefined,
    canvasId: ctx.flags['canvas-id'],
  })
  return prune({ ...fromArgs, ...fromStdin, ...pathFlags, ...extra })
}

function parseJson(text, label) {
  try {
    const value = JSON.parse(text || '')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需要 JSON 对象')
    return value
  } catch (err) {
    throw new OpError(ERR.BAD_ARGS, `${label} 解析失败：${err.message}`)
  }
}

const HUMAN_RENDERERS = {
  'project.ensure': (data) => `项目「${data.project.name}」${data.created ? '已创建' : '已存在'}（${data.project.canvases.length} 块画布）`,
  'project.inspect': (data) => data.canvases.map((canvas) => `${canvas.active ? '*' : ' '} ${canvas.id}  ${canvas.title}  ${canvas.artifactsCount} 件`).join('\n'),
  'project.rename': (data) => `项目已改名为「${data.project.name}」`,
  'canvas.create': (data) => `新建画布 ${data.canvas.id}「${data.canvas.title}」，已设为当前`,
  'project.select': (data) => `当前画布：${data.canvas.id}「${data.canvas.title}」`,
  'canvas.remove': (data) => `已移除画布 ${data.removed}${data.archived ? `（归档到 ${data.archived}）` : ''}`,
  'canvas.state': (data) => `画布「${data.work.title}」：${data.artifactsCount} 件产物；主产物 ${data.primary?.rel || '无'}；最新 ${data.latest?.rel || '无'}`,
  'artifact.register': (data) => `已登记 ${data.artifact.rel}（${data.artifact.kind}，主产物 ${data.primary === data.artifact.rel ? '是' : '否'}）`,
  'version.list': (data) => (data.versions.length ? data.versions.map((version) => `${version.id}  ${version.at}  ${version.label}  ${version.fileCount} 个文件`).join('\n') : '还没有版本'),
  'version.snapshot': (data) => `已存快照 ${data.version.id} → ${data.dir}`,
  'version.restore': (data) => `已恢复 ${data.restored}（恢复前存档 ${data.before}）`,
  'export.run': (data) => `已导出 ${data.format}：${data.dir}（${data.fileCount} 个文件，入口 ${data.entry || '无'}）`,
}

function human(op, data) {
  const render = HUMAN_RENDERERS[op]
  return render ? render(data) : JSON.stringify(data, null, 2)
}

function doctorHuman(result) {
  return result.checks.map((check) => `${check.ok ? '✓' : '✗'} ${check.name}  ${check.detail}`).join('\n')
}

function configHuman(config, sources) {
  const keys = Object.keys(config).map((key) => `${key}: ${redactValue(config[key])}`)
  return `${keys.join('\n')}\n来源: ${sources.join(' → ') || 'default'}`
}

function versionPayload() {
  return { ok: true, op: 'version', plugin: 'design-workspace', version: PLUGIN_VERSION, schemaVersion: SCHEMA_VERSION, ops: OPS, tools: TOOLS.map((tool) => tool.name) }
}

function failResult(err, jsonMode, stdout, stderr) {
  const code = err?.code && Object.hasOwn(EXIT_CODES, err.code) ? err.code : 'INTERNAL'
  const envelope = prune({ ok: false, code, reason: err?.reason, message: err?.message || String(err) })
  if (jsonMode) stdout.write(`${JSON.stringify(envelope)}\n`)
  else stderr.write(`✗ [${code}] ${envelope.message}\n`)
  return exitCodeOf(err)
}

export function exitCodeOf(err) {
  if (!err) return 1
  return EXIT_CODES[err.code] || 1
}

async function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise
  let timer = null
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new OpError(ERR.INTERNAL, `op 超时（${ms}ms）`)), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function applyFlags(config, flags, cwd) {
  if (flags.root) config.root = resolve(cwd, flags.root)
  if (flags['project-file']) config.projectFile = resolve(cwd, flags['project-file'])
  if (flags['canvas-id']) config.canvasId = flags['canvas-id']
  if (flags.browser) config.browser = flags.browser
  if (flags.timeout) {
    const number = Number(flags.timeout)
    if (!Number.isFinite(number) || number < 100 || number > 600000) throw new OpError(ERR.BAD_ARGS, '--timeout 必须是 100–600000 的毫秒数')
    config.timeout = Math.round(number)
  }
  if (flags.json) config.output = 'json'
}

function printDoctor(ctx) {
  const result = runDoctor({ config: ctx.config, env: ctx.env, home: ctx.home, findBrowser: ctx.doctorDeps?.findBrowser })
  ctx.stdout.write(ctx.json ? `${JSON.stringify({ ok: result.ok, doctor: true, checks: result.checks })}\n` : `${doctorHuman(result)}\n`)
  return result.ok ? 0 : EXIT_CODES.DOCTOR
}

function printConfig(ctx) {
  const safe = Object.fromEntries(Object.entries(ctx.config).map(([key, value]) => [key, redactValue(value)]))
  ctx.stdout.write(ctx.json ? `${JSON.stringify({ ok: true, config: safe, sources: ctx.sources })}\n` : `${configHuman(ctx.config, ctx.sources)}\n`)
  return 0
}

function printResult(ctx, op, data) {
  if (ctx.json) {
    ctx.stdout.write(`${JSON.stringify({ ok: true, op, data })}\n`)
    return 0
  }
  ctx.stdout.write(`${human(op, data)}\n`)
  return 0
}

async function execute(ctx, command) {
  const { stdout } = ctx
  if (command.spec.local === 'doctor') return printDoctor(ctx)
  if (command.spec.local === 'config') return printConfig(ctx)
  const args = command.spec.local === 'op' ? opArgs(ctx, {}) : prune(await command.spec.build(ctx))
  const op = command.opName || command.spec.op
  if (ctx.flags['dry-run']) {
    stdout.write(ctx.json ? `${JSON.stringify({ ok: true, op, dryRun: true, args })}\n` : `${op} ${JSON.stringify(args)}\n`)
    return 0
  }
  const data = await withTimeout(dispatch(op, args), ctx.config.timeout)
  return printResult(ctx, op, data)
}

export async function runCli(argv = [], options = {}) {
  const stdout = options.stdout || process.stdout
  const stderr = options.stderr || process.stderr
  const cwd = options.cwd || process.cwd()
  const jsonHint = argv.includes('--json')
  let jsonMode = jsonHint
  let flags = {}
  try {
    const parsed = parseArgv(argv)
    flags = parsed.flags
    if (flags.version) {
      const payload = versionPayload()
      stdout.write(flags.json ? `${JSON.stringify(payload)}\n` : `design-workspace ${PLUGIN_VERSION}（schema ${SCHEMA_VERSION}，${OPS.length} op / ${TOOLS.length} 工具）\n`)
      return 0
    }
    if (flags.help || !parsed.words.length) {
      stdout.write(USAGE)
      return 0
    }
    const command = resolveCommand(parsed.words)
    if (!command.spec.local) tooMany(command.spec, command.rest)
    const loaded = loadConfig({ cwd, env: options.env || process.env, home: options.home, configFile: flags.config })
    applyFlags(loaded.config, flags, cwd)
    jsonMode = loaded.config.output === 'json'
    return await execute(
      { config: loaded.config, sources: loaded.sources, flags, words: command.rest, cwd, env: options.env || process.env, home: options.home, stdinText: options.stdinText || '', doctorDeps: options.doctorDeps, stdout, json: jsonMode },
      command,
    )
  } catch (err) {
    return failResult(err, jsonMode || (jsonHint && options.jsonErrors !== false), stdout, stderr)
  }
}

export async function main(argv = process.argv.slice(2)) {
  const stdinText = argv.includes('--stdin') ? readFileSync(0, 'utf8') : ''
  const code = await runCli(argv, { stdinText })
  process.exitCode = code
  return code
}
