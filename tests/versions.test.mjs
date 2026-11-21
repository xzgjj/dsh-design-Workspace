import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_CANVAS, canvasWorkFile, createCanvas, ensureProject } from '../lib/project.js'
import { listVersions, restoreCanvas, snapshotCanvas } from '../lib/versions.js'
import { exportCanvas } from '../lib/export.js'

function withCanvas(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-versions-'))
  try {
    const { projectFile } = ensureProject({ root, title: '版本测试' })
    fn({ root, projectFile, canvasFile: canvasWorkFile(projectFile, DEFAULT_CANVAS) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('快照 → 列表 → 恢复：内容回到旧版，且恢复前自动存一版', () => {
  withCanvas(({ canvasFile }) => {
    const folder = canvasFile.replace(/[\\/]work\.json$/, '')
    writeFileSync(join(folder, 'index.html'), 'v1')

    const first = snapshotCanvas({ canvasFile, label: '初稿' })
    assert.equal(first.version.id, 'v001')
    assert.equal(first.version.seq, 1)
    assert.equal(first.version.files.length, 2)  // 内容文件 + work.json

    writeFileSync(join(folder, 'index.html'), 'v2')
    snapshotCanvas({ canvasFile, label: '二稿' })

    const listed = listVersions(canvasFile)
    assert.equal(listed.total, 2)
    assert.equal(listed.latest.id, 'v002')
    assert.equal(listed.latest.label, '二稿')

    const restored = restoreCanvas({ canvasFile, versionId: 'v001' })
    assert.equal(restored.restored, 'v001')
    assert.equal(readFileSync(join(folder, 'index.html'), 'utf8'), 'v1')

    const after = listVersions(canvasFile)
    assert.equal(after.total, 3)
    assert.equal(after.latest.source, 'pre-restore')
  })
})

test('版本只保留最近 20 个，编号不重复', () => {
  withCanvas(({ canvasFile }) => {
    for (let i = 0; i < 25; i += 1) snapshotCanvas({ canvasFile, label: `第 ${i} 次` })
    const listed = listVersions(canvasFile)
    assert.equal(listed.total, 20)
    assert.equal(listed.latest.seq, 25)
    assert.equal(listed.versions.at(-1).seq, 6)
  })
})

test('恢复不存在的版本会报 NOT_FOUND', () => {
  withCanvas(({ canvasFile }) => {
    assert.throws(() => restoreCanvas({ canvasFile, versionId: 'v999' }), /没有这个版本/)
  })
})

test('空版本恢复 CONFLICT，且跨画布互不影响', () => {
  withCanvas(({ projectFile, canvasFile }) => {
    const second = createCanvas({ projectFile, title: '第二块' })
    const secondFile = canvasWorkFile(projectFile, second.canvas.id)
    const secondPath = dirname(secondFile)
    writeFileSync(join(secondPath, 'keep.txt'), '第二块的内容')

    snapshotCanvas({ canvasFile, label: '只存主画布' })
    assert.equal(listVersions(secondFile).total, 0)

    const design = dirname(dirname(dirname(canvasFile)))
    const emptyDir = join(design, 'snapshots', DEFAULT_CANVAS, 'v999')
    mkdirSync(emptyDir, { recursive: true })
    writeFileSync(join(emptyDir, 'meta.json'), JSON.stringify({ v: 1, id: 'v999', seq: 999, canvasId: DEFAULT_CANVAS, files: [], fileCount: 0 }))

    assert.throws(() => restoreCanvas({ canvasFile, versionId: 'v999' }), (err) => err.code === 'CONFLICT')
    assert.equal(readFileSync(join(secondPath, 'keep.txt'), 'utf8'), '第二块的内容')
  })
})

test('导出把画布内容整树复制并写 manifest', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-versions-export-'))
  try {
    const { projectFile } = ensureProject({ root, title: '版本测试' })
    const canvasFile = canvasWorkFile(projectFile, DEFAULT_CANVAS)
    const folder = canvasFile.replace(/[\\/]work\.json$/, '')
    writeFileSync(join(folder, 'index.html'), '<html></html>')
    const run = await exportCanvas({ canvasFile, stamp: 'test' })
    assert.equal(run.fileCount, 1)
    assert.equal(run.dir.includes(join('export', 'c-main', 'test')), true)
    assert.equal(readFileSync(join(run.dir, 'site', 'index.html'), 'utf8'), '<html></html>')
    const manifest = JSON.parse(readFileSync(join(run.dir, 'manifest.json'), 'utf8'))
    assert.equal(manifest.files.length, 1)
    assert.equal(manifest.canvasId, DEFAULT_CANVAS)
    assert.equal(manifest.format, 'html')
    assert.equal(root.length > 0, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
