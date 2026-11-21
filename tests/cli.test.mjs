// CLI 契约：参数解析、子命令映射、14 op 直通、profile 链、脱敏、退出码、doctor。
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCli, exitCodeOf } from '../lib/cli.js'
import { loadConfig, profilePath, redactValue } from '../lib/cli-config.js'
import { runDoctor } from '../lib/cli-doctor.js'
import { OPS } from '../lib/ops.js'
import { TOOLS } from '../lib/tools.js'

function capture() {
  const lines = []
  return { write: (text) => lines.push(String(text)), text: () => lines.join('') }
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'dshdw-cli-root-'))
  const home = mkdtempSync(join(tmpdir(), 'dshdw-cli-home-'))
  return { root, home, cleanup: () => { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } }
}

async function cli(argv, { root, home, env = {}, stdinText = '', doctorDeps } = {}) {
  const stdout = capture()
  const stderr = capture()
  const code = await runCli(argv, { cwd: root, home, env, stdinText, stdout, stderr, doctorDeps })
  let json = null
  try { json = JSON.parse(stdout.text()) } catch { json = null }
  return { code, stdout: stdout.text(), stderr: stderr.text(), json }
}

function writeProfile(home, patch) {
  const file = profilePath(home)
  mkdirSync(join(home, '.dsh', 'profiles'), { recursive: true })
  writeFileSync(file, JSON.stringify(patch))
  return file
}

test('--version 暴露 op/tool 表；--help 列出命令且不调 op', async () => {
  const ws = workspace()
  try {
    const version = await cli(['--version', '--json'], ws)
    assert.equal(version.code, 0)
    assert.equal(version.json.ok, true)
    assert.equal(version.json.ops.length, OPS.length)
    assert.equal(version.json.tools.length, TOOLS.length)
    const help = await cli(['--help'], ws)
    assert.equal(help.code, 0)
    assert.match(help.stdout, /project ensure/)
    assert.match(help.stdout, /config show/)
  } finally { ws.cleanup() }
})

test('project ensure / inspect / rename 走 dispatch 且 --json 信封一致', async () => {
  const ws = workspace()
  try {
    const ensured = await cli(['project', 'ensure', '--root', ws.root, '--title', '深色落地页', '--kind', 'web', '--json'], ws)
    assert.equal(ensured.code, 0)
    assert.equal(ensured.json.ok, true)
    assert.equal(ensured.json.op, 'project.ensure')
    assert.equal(ensured.json.data.project.name, '深色落地页')
    assert.equal(ensured.json.data.created, true)

    const human = await cli(['project', 'ensure'], ws)
    assert.equal(human.code, 0)
    assert.match(human.stdout, /深色落地页/)

    const inspected = await cli(['project', 'inspect', '--root', ws.root, '--json'], ws)
    assert.equal(inspected.json.data.canvases.length, 1)
    assert.equal(inspected.json.data.canvases[0].active, true)

    const renamed = await cli(['project', 'rename', '新名字', '--root', ws.root, '--json'], ws)
    assert.equal(renamed.json.data.project.name, '新名字')
  } finally { ws.cleanup() }
})

test('canvas create / select / state / remove 覆盖生命周期', async () => {
  const ws = workspace()
  try {
    await cli(['project', 'ensure', '--root', ws.root, '--json'], ws)
    const created = await cli(['canvas', 'create', '--root', ws.root, '--title', '长文档', '--json'], ws)
    assert.equal(created.code, 0)
    assert.equal(created.json.data.canvas.id, 'c-2')
    assert.equal(created.json.data.project.activeCanvasId, 'c-2')

    const selected = await cli(['canvas', 'select', 'c-main', '--root', ws.root, '--json'], ws)
    assert.equal(selected.json.data.project.activeCanvasId, 'c-main')

    const state = await cli(['canvas', 'state', '--root', ws.root, '--json'], ws)
    assert.equal(state.code, 0)
    assert.equal(state.json.data.work.id, 'c-main')
    assert.equal(state.json.data.artifactsCount, 0)

    const removed = await cli(['canvas', 'remove', 'c-2', '--root', ws.root, '--json'], ws)
    assert.equal(removed.json.data.removed, 'c-2')
    assert.equal(removed.json.data.project.canvases.length, 1)
  } finally { ws.cleanup() }
})

test('artifact add / version 三连 / export run 串起画布交付', async () => {
  const ws = workspace()
  try {
    await cli(['project', 'ensure', '--root', ws.root, '--json'], ws)
    const canvas = join(ws.root, '.design-work', 'canvases', 'c-main')
    writeFileSync(join(canvas, 'index.html'), '<html><body><section>一页</section></body></html>')

    const added = await cli(['artifact', 'add', 'index.html', '--pages', '2', '--title', '首页', '--primary', '--json'], ws)
    assert.equal(added.code, 0)
    assert.equal(added.json.data.artifact.rel, 'index.html')
    assert.equal(added.json.data.artifact.pages, 2)
    assert.equal(added.json.data.primary, 'index.html')

    const snapshot = await cli(['version', 'snapshot', '--label', '改稿前', '--json'], ws)
    assert.equal(snapshot.code, 0)
    assert.equal(snapshot.json.data.version.id, 'v001')

    const listed = await cli(['version', 'list', '--json'], ws)
    assert.equal(listed.json.data.total, 1)
    assert.equal(listed.json.data.latest.label, '改稿前')

    const restored = await cli(['version', 'restore', 'v001', '--json'], ws)
    assert.equal(restored.json.data.restored, 'v001')
    assert.match(restored.json.data.before, /^v\d{3}$/)

    const exported = await cli(['export', 'run', '--format', 'html', '--stamp', 'cli', '--json'], ws)
    assert.equal(exported.code, 0)
    assert.equal(exported.json.data.format, 'html')
    assert.equal(exported.json.data.entry, 'site/index.html')
    assert.equal(existsSync(join(exported.json.data.dir, 'site', 'index.html')), true)
    const manifest = JSON.parse(readFileSync(join(exported.json.data.dir, 'manifest.json'), 'utf8'))
    assert.equal(manifest.format, 'html')
  } finally { ws.cleanup() }
})

test('op 直通集合等于冻结 14 op，参数走 --args/--stdin', async () => {
  const ws = workspace()
  try {
    for (const op of OPS) {
      const dry = await cli(['op', op, '--dry-run', '--json'], ws)
      assert.equal(dry.code, 0, op)
      assert.equal(dry.json.dryRun, true)
      assert.equal(dry.json.op, op)
    }
    assert.equal(new Set(OPS).size, 14)

    await cli(['project', 'ensure', '--root', ws.root, '--json'], ws)
    const viaArgs = await cli(['op', 'project.inspect', '--args', JSON.stringify({ projectFile: join(ws.root, '.design-work', 'project.json') }), '--json'], ws)
    assert.equal(viaArgs.code, 0)
    assert.equal(viaArgs.json.data.canvases.length, 1)

    const viaStdin = await cli(['op', 'project.ensure', '--stdin', '--json'], { ...ws, stdinText: JSON.stringify({ root: ws.root }) })
    assert.equal(viaStdin.code, 0)
    assert.equal(viaStdin.json.data.created, false)

    const unknown = await cli(['op', 'nope.op', '--json'], ws)
    assert.equal(unknown.code, 2)
    assert.equal(unknown.json.code, 'BAD_ARGS')
  } finally { ws.cleanup() }
})

test('profile 链：默认 → profile → 环境变量 → --config → CLI 旗标', () => {
  const ws = workspace()
  try {
    const defaults = loadConfig({ cwd: ws.root, home: ws.home, env: {} })
    assert.equal(defaults.config.root, ws.root)
    assert.equal(defaults.config.output, 'human')
    assert.equal(defaults.config.timeout, 10000)

    writeProfile(ws.home, { root: ws.root, output: 'json', canvasId: 'c-2', timeout: 5000 })
    const fromProfile = loadConfig({ cwd: ws.root, home: ws.home, env: {} })
    assert.equal(fromProfile.config.output, 'json')
    assert.equal(fromProfile.config.canvasId, 'c-2')
    assert.equal(fromProfile.config.timeout, 5000)

    const fromEnv = loadConfig({ cwd: ws.root, home: ws.home, env: { DSHDW_CANVAS_ID: 'c-3', DSHDW_TIMEOUT: '7000' } })
    assert.equal(fromEnv.config.canvasId, 'c-3')
    assert.equal(fromEnv.config.timeout, 7000)

    const extra = join(ws.home, 'override.json')
    writeFileSync(extra, JSON.stringify({ canvasId: 'c-4' }))
    const fromFile = loadConfig({ cwd: ws.root, home: ws.home, env: { DSHDW_CANVAS_ID: 'c-3' }, configFile: extra })
    assert.equal(fromFile.config.canvasId, 'c-4')
  } finally { ws.cleanup() }
})

test('配置校验：坏 JSON / 未知字段 / 非法 output 与 timeout 退 2', async () => {
  const ws = workspace()
  try {
    const file = profilePath(ws.home)
    mkdirSync(join(ws.home, '.dsh', 'profiles'), { recursive: true })
    writeFileSync(file, '{ bad json')
    const broken = await cli(['config', 'show', '--json'], ws)
    assert.equal(broken.code, 2)
    assert.equal(broken.json.code, 'BAD_ARGS')

    writeFileSync(file, JSON.stringify({ nope: 1 }))
    const unknown = await cli(['config', 'show', '--json'], ws)
    assert.equal(unknown.code, 2)

    writeFileSync(file, JSON.stringify({ output: 'xml' }))
    const output = await cli(['config', 'show', '--json'], ws)
    assert.equal(output.code, 2)

    writeFileSync(file, JSON.stringify({ timeout: 0 }))
    const timeout = await cli(['config', 'show', '--json'], ws)
    assert.equal(timeout.code, 2)
  } finally { ws.cleanup() }
})

test('config show 脱敏且 --json 输出生效配置来源', async () => {
  const ws = workspace()
  try {
    const profile = writeProfile(ws.home, { root: ws.root, projectFile: join(ws.root, '.design-work', 'project.json') })
    const shown = await cli(['config', 'show', '--json'], ws)
    assert.equal(shown.code, 0)
    assert.equal(shown.json.ok, true)
    assert.equal(shown.json.config.root, redactValue(ws.root))
    assert.equal(shown.json.sources.includes('profile'), true)
    assert.equal(shown.stdout.includes(ws.root), false)
    const human = await cli(['config', 'show'], ws)
    assert.equal(human.code, 0)
    assert.equal(human.stdout.includes(ws.root), false)
    assert.match(human.stdout, /profile/)
    assert.equal(profile.endsWith('dshdw.json'), true)
  } finally { ws.cleanup() }
})

test('退出码：六码 2–7、兜底 1、doctor 8', async () => {
  assert.equal(exitCodeOf({ code: 'BAD_ARGS' }), 2)
  assert.equal(exitCodeOf({ code: 'NOT_FOUND' }), 3)
  assert.equal(exitCodeOf({ code: 'CONFLICT' }), 4)
  assert.equal(exitCodeOf({ code: 'FORBIDDEN' }), 5)
  assert.equal(exitCodeOf({ code: 'LIMIT' }), 6)
  assert.equal(exitCodeOf({ code: 'INTERNAL' }), 7)
  assert.equal(exitCodeOf(new Error('boom')), 1)
  assert.equal(exitCodeOf({ code: 'DOCTOR' }), 8)

  const ws = workspace()
  try {
    const missing = await cli(['project', 'inspect', '--root', ws.root, '--json'], ws)
    assert.equal(missing.code, 3)
    assert.equal(missing.json.code, 'NOT_FOUND')

    await cli(['project', 'ensure', '--root', ws.root, '--json'], ws)
    const removeLast = await cli(['canvas', 'remove', 'c-main', '--json'], ws)
    assert.equal(removeLast.code, 4)
    assert.equal(removeLast.json.code, 'CONFLICT')

    let last = null
    for (let i = 0; i < 8; i += 1) last = await cli(['canvas', 'create', '--json'], ws)
    assert.equal(last.code, 6)
    assert.equal(last.json.code, 'LIMIT')
  } finally { ws.cleanup() }
})

test('doctor 本地自检：全绿 0，缺浏览器 8，且不注册 op/路由', async () => {
  const ws = workspace()
  try {
    const fakeBrowser = join(ws.root, 'fake-chrome.exe')
    writeFileSync(fakeBrowser, 'x')
    const good = runDoctor({ config: { root: ws.root, browser: fakeBrowser, timeout: 10000 }, home: ws.home })
    assert.equal(good.ok, true)
    assert.equal(good.checks.every((check) => check.ok), true)
    assert.equal(OPS.includes('doctor'), false)

    const bad = runDoctor({ config: { root: ws.root, browser: '' }, findBrowser: () => '', home: ws.home })
    assert.equal(bad.ok, false)
    assert.equal(bad.checks.some((check) => !check.ok), true)

    const doctor = await cli(['doctor', '--json'], { ...ws, doctorDeps: { findBrowser: () => '' } })
    assert.equal(doctor.code, 8)
    assert.equal(doctor.json.doctor, true)
    assert.equal(doctor.json.ok, false)
  } finally { ws.cleanup() }
})

test('profile.output=json 同时影响成功与失败输出', async () => {
  const ws = workspace()
  try {
    writeProfile(ws.home, { root: ws.root, output: 'json' })
    const ok = await cli(['project', 'ensure'], ws)
    assert.equal(ok.code, 0)
    assert.equal(ok.json.ok, true)
    assert.equal(ok.stderr, '')

    const empty = join(ws.root, 'empty')
    mkdirSync(empty, { recursive: true })
    const failed = await cli(['project', 'inspect', '--root', empty], ws)
    assert.equal(failed.code, 3)
    assert.equal(failed.json.code, 'NOT_FOUND')
    assert.equal(failed.stderr, '')
  } finally { ws.cleanup() }
})

test('profile 字段非法时 doctor 发现并整体不就绪', () => {
  const ws = workspace()
  try {
    writeProfile(ws.home, { output: 'xml' })
    const result = runDoctor({ config: { root: ws.root, browser: 'missing.exe' }, home: ws.home, findBrowser: () => '' })
    assert.equal(result.ok, false)
    assert.equal(result.checks.find((check) => check.name === 'profile').ok, false)
    assert.equal(result.checks.find((check) => check.name === 'browser').ok, false)
  } finally { ws.cleanup() }
})

test('--dry-run 只打印 op 与 args，不落盘', async () => {
  const ws = workspace()
  try {
    const dry = await cli(['project', 'ensure', '--root', ws.root, '--title', '预演', '--dry-run', '--json'], ws)
    assert.equal(dry.code, 0)
    assert.equal(dry.json.dryRun, true)
    assert.equal(dry.json.args.title, '预演')
    assert.equal(existsSync(join(ws.root, '.design-work')), false)
  } finally { ws.cleanup() }
})
