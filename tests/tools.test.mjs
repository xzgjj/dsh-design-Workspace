import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { TOOLS, addArtifactTool, exportTool, newCanvasTool, workStartTool, workStateTool } from '../lib/tools.js'

test('工具面恰好 5 个，schema 扁平且 additionalProperties 关闭', () => {
  assert.deepEqual(TOOLS.map((tool) => tool.name), [
    'design_work_start',
    'design_work_add_artifact',
    'design_work_new_canvas',
    'design_work_state',
    'design_work_export',
  ])
  for (const tool of TOOLS) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.parameters.additionalProperties, false)
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(tool.output.schema.additionalProperties, false)
    assert.equal(JSON.stringify(tool.output.schema).includes('$ref'), false)
    assert.equal(Array.isArray(tool.output.schema.required), true)
  }
})

test('start → 写文件 → 登记 → state → 新画布 → 导出，整条链路走通', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tools-'))
  try {
    const started = await workStartTool.execute({ root, title: '品牌官网', kind: 'web' })
    assert.equal(started.created, true)
    assert.equal(started.canvasId, 'c-main')
    assert.equal(existsSync(started.canvasFile), true)
    assert.match(workStartTool.output.render({}, started)[0].text, /交付物就绪/)

    const canvasPath = dirname(started.canvasFile)
    writeFileSync(join(canvasPath, 'index.html'), '<html><body>ok</body></html>')

    const added = await addArtifactTool.execute({ canvasFile: started.canvasFile, rel: 'index.html', title: '首页', pages: 1 })
    assert.equal(added.rel, 'index.html')
    assert.equal(added.role, 'primary')
    assert.equal(added.artifactsCount, 1)
    assert.match(addArtifactTool.output.render({}, added)[0].text, /已登记 首页/)

    const state = await workStateTool.execute({ canvasFile: started.canvasFile })
    assert.equal(state.title, '品牌官网')
    assert.equal(state.artifactsCount, 1)
    assert.equal(state.latestRel, 'index.html')
    assert.equal(state.primary, 'index.html')
    assert.match(workStateTool.output.render({}, state)[0].text, /最新 index\.html/)

    const canvas = await newCanvasTool.execute({ projectFile: started.projectFile, title: '长文档', kind: 'doc' })
    assert.equal(canvas.canvasId, 'c-2')
    assert.equal(canvas.title, '长文档')
    assert.match(newCanvasTool.output.render({}, canvas)[0].text, /长文档/)

    const exported = await exportTool.execute({ canvasFile: started.canvasFile, format: 'html', stamp: 'tool' })
    assert.equal(exported.format, 'html')
    assert.equal(existsSync(join(exported.dir, 'site', 'index.html')), true)
    assert.equal(exported.fileCount >= 1, true)
    assert.match(exportTool.output.render({}, exported)[0].text, /已导出 html/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('工具不生成内容：登记不存在的文件直接报错', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tools-fail-'))
  try {
    const started = await workStartTool.execute({ root, title: '空画布' })
    await assert.rejects(
      () => addArtifactTool.execute({ canvasFile: started.canvasFile, rel: 'nope.html' }),
      (err) => err.code === 'NOT_FOUND' && err.reason === 'NO_ARTIFACT',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
