import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWork, readState, isWorkFile, workRoot } from '../lib/store.js'
import { workStartTool, workStateTool } from '../lib/tools.js'

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-design-workspace-'))
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('isWorkFile 只认 .design-work/work.json', () => {
  assert.equal(isWorkFile(join('/ws', '.design-work', 'work.json')), true)
  if (process.platform === 'win32') assert.equal(isWorkFile('C:\\ws\\.design-work\\work.json'), true)
  assert.equal(isWorkFile('/ws/work.json'), false)
  assert.equal(isWorkFile('/ws/.design-work/nested/work.json'), false)
  assert.equal(isWorkFile(''), false)
})

test('createWork 幂等，并返回固定路径', () => {
  withRoot((root) => {
    const a = createWork({ root, title: '深色 SaaS 落地页' })
    assert.equal(a.created, true)
    assert.equal(workRoot(a.file), root)
    const b = createWork({ root, title: '另一个标题' })
    assert.equal(b.created, false)
    assert.equal(b.work.title, '深色 SaaS 落地页')
  })
})

test('readState 统计产物并按时间倒序', () => {
  withRoot((root) => {
    const { file } = createWork({ root, title: '落地页' })
    writeFileSync(join(root, 'index.html'), '<html></html>')
    writeFileSync(join(root, 'deck.pdf'), 'x'.repeat(100))
    const s = readState(file)
    assert.equal(s.artifactsCount, 2)
    assert.equal(s.latest.rel.endsWith('.pdf') || s.latest.rel.endsWith('.html'), true)
    assert.equal(s.artifacts.find((a) => a.rel === 'index.html').kind, 'web')
    assert.equal(s.artifacts.find((a) => a.rel === 'deck.pdf').kind, 'deck')
  })
})

test('readState 拒绝越界路径', () => {
  withRoot((root) => {
    createWork({ root, title: 'x' })
    assert.throws(() => readState(join(root, 'work.json')), /不是合法的交付物文件/)
    assert.throws(() => readState(join(root, 'nested', '.design-work', 'work.json')), /不存在/)
  })
})

test('工具：start → state 串起来', async () => {
  await withRootAsync(async (root) => {
    const started = await workStartTool.execute({ root, title: '品牌官网' })
    assert.equal(started.created, true)
    const st = await workStateTool.execute({ workFile: started.workFile })
    assert.equal(st.title, '品牌官网')
    assert.equal(st.artifactsCount, 0)
  })
})

async function withRootAsync(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-design-workspace-'))
  try {
    return await fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
