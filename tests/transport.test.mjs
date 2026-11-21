// 传输层：scope ↔ 绝对路径、单 op 分发、信封与 HTTP 映射。
// 这一层是 HTTP / CLI / 测试共用入口，路径解析错会让所有入口一起错，所以单独锁。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ERR, REASON, OpError, opError } from '../lib/contracts.js'
import { createTransport, errorEnvelope, httpStatus } from '../lib/transport.js'
import { ensureProject } from '../lib/project.js'

test('scope 解析成绝对路径：项目/画布/内部分发都只走这一层', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-transport-'))
  try {
    const { projectFile, project } = ensureProject({ root, title: '传输' })
    const calls = []
    const transport = createTransport({
      dispatch: async (op, args) => {
        calls.push({ op, args })
        return { args }
      },
    })

    const ensured = await transport.call('project.ensure', { root, title: '传输' })
    assert.equal(ensured.ok, true)
    assert.equal(calls[0].args.root, root)

    const state = await transport.call('canvas.state', { root, scope: { projectId: project.id, canvasId: 'c-main' } })
    assert.equal(state.ok, true)
    assert.equal(existsSync(calls[1].args.canvasFile), true)

    const selected = await transport.call('project.select', { root, scope: { canvasId: 'c-main' } })
    assert.equal(selected.ok, true)
    assert.equal(calls[2].args.projectFile, projectFile)
    assert.equal(calls[2].args.canvasId, 'c-main')

    const wired = await transport.call('canvas.wire', { root, scope: { canvasId: 'c-main' } })
    assert.equal(wired.ok, true)
    assert.equal(calls[3].args.canvasId, 'c-main')
    assert.equal(calls[3].args.projectFile, projectFile)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('scope 不匹配 / 画布不存在 / 定位参数缺失都是冻结错误码', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-transport-'))
  try {
    const { project } = ensureProject({ root, title: '传输' })
    const transport = createTransport({ dispatch: async () => ({}) })

    const wrongProject = await transport.call('project.inspect', { root, scope: { projectId: 'other-id' } })
    assert.equal(wrongProject.ok, false)
    assert.equal(wrongProject.code, ERR.NOT_FOUND)

    const wrongCanvas = await transport.call('canvas.state', { root, scope: { canvasId: 'c-9' } })
    assert.equal(wrongCanvas.ok, false)
    assert.equal(wrongCanvas.code, ERR.NOT_FOUND)
    assert.equal(wrongCanvas.reason, REASON.CANVAS_NOT_FOUND)

    const noRoot = await transport.call('project.inspect', {})
    assert.equal(noRoot.code, ERR.BAD_ARGS)

    const scoped = await transport.call('project.inspect', { root, scope: { projectId: project.id } })
    assert.equal(scoped.ok, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('信封：OpError 带 reason，非 OpError 兜底 INTERNAL；6 码 HTTP 映射', () => {
  for (const code of Object.values(ERR)) {
    const envelope = errorEnvelope(opError(code, code === ERR.CONFLICT ? REASON.CANVAS_MIN : '', `${code} 失败`))
    assert.equal(envelope.ok, false)
    assert.equal(envelope.code, code)
    if (code === ERR.CONFLICT) assert.equal(envelope.reason, REASON.CANVAS_MIN)
    assert.equal(Object.hasOwn(envelope, 'error'), false)
  }
  const wrapped = errorEnvelope(new Error('boom'))
  assert.equal(wrapped.code, ERR.INTERNAL)
  assert.equal(wrapped.message, 'boom')

  assert.equal(httpStatus({ ok: true, code: ERR.INTERNAL }), 200)
  assert.equal(httpStatus({ ok: false, code: ERR.NOT_FOUND }), 404)
  assert.equal(httpStatus({ ok: false, code: ERR.INTERNAL }), 500)
  for (const code of [ERR.BAD_ARGS, ERR.CONFLICT, ERR.FORBIDDEN, ERR.LIMIT]) {
    assert.equal(httpStatus({ ok: false, code }), 400)
  }
})

test('dispatch 抛 OpError 时 call 返回同一信封，不重复包 error 字段', async () => {
  const transport = createTransport({
    dispatch: async () => {
      throw new OpError(ERR.BAD_ARGS, '参数不对')
    },
  })
  const result = await transport.call('nope', {})
  assert.equal(result.ok, false)
  assert.equal(result.code, ERR.BAD_ARGS)
  assert.equal(Object.hasOwn(result, 'error'), false)
})
