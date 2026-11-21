// CLI 进程级集成：bin 入口、真实退出码、stdout JSON 信封、stdin 参数。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../../bin/dshdw.js', import.meta.url))
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function run(args, { cwd = ROOT, input = undefined } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8' })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { json = null }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json }
}

test('bin 入口：--version --json 输出 14 op / 5 工具', () => {
  const version = run(['--version', '--json'])
  assert.equal(version.status, 0)
  assert.equal(version.json.ok, true)
  assert.equal(version.json.ops.length, 14)
  assert.equal(version.json.tools.length, 5)
})

test('bin 入口：ensure → inspect 成功，缺项目退 3，未知命令退 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshdw-bin-'))
  try {
    const ensured = run(['project', 'ensure', '--root', root, '--title', '进程级', '--json'])
    assert.equal(ensured.status, 0)
    assert.equal(ensured.json.data.created, true)

    const inspected = run(['project', 'inspect', '--root', root, '--json'])
    assert.equal(inspected.status, 0)
    assert.equal(inspected.json.data.canvases.length, 1)

    const empty = mkdtempSync(join(root, 'empty-'))
    const missing = run(['project', 'inspect', '--root', empty, '--json'])
    assert.equal(missing.status, 3)
    assert.equal(missing.json.code, 'NOT_FOUND')

    const unknown = run(['canvas', 'rename', 'c-main'])
    assert.equal(unknown.status, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('bin 入口：--stdin 参数与 --dry-run 预演', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshdw-bin-'))
  try {
    const piped = run(['op', 'project.ensure', '--stdin', '--json'], { input: JSON.stringify({ root }) })
    assert.equal(piped.status, 0)
    assert.equal(piped.json.data.created, true)

    const dry = run(['project', 'ensure', '--root', root, '--title', '预演', '--dry-run', '--json'])
    assert.equal(dry.status, 0)
    assert.equal(dry.json.dryRun, true)
    assert.equal(dry.json.args.title, '预演')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
