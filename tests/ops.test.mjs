// op 分发层：冻结 14 个名字、未知 op 拒绝、root/projectFile 两种定位。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ERR } from '../lib/contracts.js'
import { OPS, dispatch } from '../lib/ops.js'
import { ensureProject } from '../lib/project.js'

const FROZEN = [
  'project.ensure', 'project.inspect', 'project.select', 'project.rename', 'project.read',
  'canvas.create', 'canvas.remove', 'canvas.state', 'canvas.wire', 'artifact.register',
  'version.list', 'version.snapshot', 'version.restore', 'export.run',
]

test('op 表恰好 14 个且名字冻结', () => {
  assert.deepEqual([...OPS].sort(), [...FROZEN].sort())
  assert.equal(new Set(OPS).size, 14)
})

test('dispatch 未知 op 直接 BAD_ARGS，不做任何落盘', async () => {
  await assert.rejects(() => dispatch('nope.op', {}), (err) => err.code === ERR.BAD_ARGS)
})

test('project.inspect / read 支持 root 兜底；canvas.wire 只拼路径', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ops-'))
  try {
    await dispatch('project.ensure', { root, title: 'op 测试' })
    const inspected = await dispatch('project.inspect', { root })
    assert.equal(inspected.project.name, 'op 测试')
    assert.equal(inspected.canvases.length, 1)

    const read = await dispatch('project.read', { root })
    assert.equal(read.project.v, 3)
    assert.equal(read.canvasLimit, 8)

    const wired = await dispatch('canvas.wire', { projectFile: inspected.projectFile, canvasId: 'c-main' })
    assert.equal(wired.canvasFile.endsWith('c-main\\work.json') || wired.canvasFile.endsWith('c-main/work.json'), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
