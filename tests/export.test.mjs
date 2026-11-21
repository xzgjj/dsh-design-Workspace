import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_CANVAS, canvasDir, canvasWorkFile, ensureProject } from '../lib/project.js'
import { createExport, exportCanvas, FORMATS } from '../lib/export.js'
import { findBrowser, createRenderer } from '../lib/renderer.js'
import { registerArtifact } from '../lib/artifact.js'
import { ERR, REASON, opError } from '../lib/contracts.js'

async function withCanvas(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-export-'))
  try {
    const { projectFile } = ensureProject({ root, title: '导出测试' })
    return await fn({ root, projectFile, canvasPath: canvasDir(projectFile, DEFAULT_CANVAS), canvasFile: canvasWorkFile(projectFile, DEFAULT_CANVAS) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeSite(canvasPath) {
  writeFileSync(join(canvasPath, 'index.html'), '<html><head></head><body><section>P1</section><section>P2</section></body></html>')
  writeFileSync(join(canvasPath, 'style.css'), 'body{}')
}

test('html 导出整站复制 + manifest，且 export/ 不回流产物清单', async () => {
  await withCanvas(async ({ canvasFile, canvasPath }) => {
    writeSite(canvasPath)
    registerArtifact({ canvasFile, rel: 'index.html', title: '首页' })
    const run = await exportCanvas({ canvasFile, format: 'html', stamp: 'test' })
    assert.equal(run.format, 'html')
    assert.equal(run.dir.includes(join('export', 'c-main', 'test')), true)
    assert.equal(readFileSync(join(run.dir, 'site', 'index.html'), 'utf8').includes('<section>P1</section>'), true)
    assert.equal(existsSync(join(run.dir, 'site', 'style.css')), true)
    assert.equal(run.entry, 'site/index.html')
    assert.equal(run.fileCount, 2)

    const manifest = JSON.parse(readFileSync(join(run.dir, 'manifest.json'), 'utf8'))
    assert.equal(manifest.format, 'html')
    assert.equal(manifest.entry, 'site/index.html')
    assert.equal(manifest.canvasId, DEFAULT_CANVAS)
    assert.equal(manifest.fileCount, 2)
    assert.equal(manifest.files.includes('manifest.json'), false)
  })
})

test('未知格式（含 pptx/zip）一律 BAD_ARGS，不生成目录', async () => {
  await withCanvas(async ({ canvasFile, canvasPath }) => {
    writeSite(canvasPath)
    for (const format of ['pptx', 'zip', 'docx']) {
      await assert.rejects(() => exportCanvas({ canvasFile, format, stamp: 'bad' }), (err) => err.code === ERR.BAD_ARGS)
    }
    assert.equal(existsSync(join(dirname(dirname(canvasPath)), 'export', 'c-main', 'bad')), false)
  })
})

test('无浏览器：LIMIT + BROWSER_MISSING，且清理半截目录', async () => {
  await withCanvas(async ({ canvasFile, canvasPath }) => {
    writeSite(canvasPath)
    registerArtifact({ canvasFile, rel: 'index.html' })
    const renderer = {
      render: async () => {
        throw opError(ERR.LIMIT, REASON.BROWSER_MISSING, '没有浏览器')
      },
    }
    const runner = createExport({ renderer })
    await assert.rejects(() => runner.run({ canvasFile, format: 'pdf', stamp: 'nobrowser' }), (err) => err.code === ERR.LIMIT && err.reason === REASON.BROWSER_MISSING)
    assert.equal(existsSync(join(dirname(dirname(canvasPath)), 'export', 'c-main', 'nobrowser')), false)
  })
})

test('pdf/png 走 renderer，成功后 manifest 记 entry 与文件数', async () => {
  await withCanvas(async ({ canvasFile, canvasPath }) => {
    writeSite(canvasPath)
    registerArtifact({ canvasFile, rel: 'index.html' })
    const calls = []
    const renderer = {
      render: async ({ format, outFile, file }) => {
        calls.push({ format, file })
        writeFileSync(outFile, `fake-${format}`)
      },
    }
    const runner = createExport({ renderer })
    const pdf = await runner.run({ canvasFile, format: 'pdf', stamp: 'pdf' })
    assert.equal(pdf.format, 'pdf')
    assert.equal(pdf.fileCount, 1)
    assert.equal(pdf.entry.endsWith('.pdf'), true)
    assert.equal(readFileSync(join(pdf.dir, pdf.entry), 'utf8'), 'fake-pdf')
    assert.equal(calls[0].format, 'pdf')

    const png = await runner.run({ canvasFile, format: 'PNG', stamp: 'png' })
    assert.equal(png.format, 'png')
    assert.equal(png.entry.endsWith('.png'), true)
    assert.equal(readFileSync(join(png.dir, png.entry), 'utf8'), 'fake-png')
  })
})

test('渲染失败删掉半截目录并保留原始错误', async () => {
  await withCanvas(async ({ canvasFile, canvasPath }) => {
    writeSite(canvasPath)
    registerArtifact({ canvasFile, rel: 'index.html' })
    const renderer = {
      render: async ({ outFile }) => {
        writeFileSync(outFile, 'half')
        throw new Error('boom')
      },
    }
    const runner = createExport({ renderer })
    await assert.rejects(() => runner.run({ canvasFile, format: 'png', stamp: 'fail' }), /boom/)
    assert.equal(existsSync(join(dirname(dirname(canvasPath)), 'export', 'c-main', 'fail')), false)
  })
})

test('没有 html 入口时 pdf/png 报 BAD_ARGS，html 仍可导出', async () => {
  await withCanvas(async ({ canvasFile, canvasPath }) => {
    writeFileSync(join(canvasPath, 'deck.pdf'), 'not html')
    registerArtifact({ canvasFile, rel: 'deck.pdf' })
    const runner = createExport({ renderer: { render: async () => {} } })
    await assert.rejects(() => runner.run({ canvasFile, format: 'pdf', stamp: 'x' }), (err) => err.code === ERR.BAD_ARGS)
    const html = await runner.run({ canvasFile, format: 'html', stamp: 'x' })
    assert.equal(html.entry, '')
    assert.equal(existsSync(join(html.dir, 'site', 'deck.pdf')), true)
  })
})

test('findBrowser：CHROME_PATH 优先，其次常见路径与 PATH；都没有返回空串', () => {
  const linuxNone = findBrowser({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => false })
  assert.equal(linuxNone, '')

  const envChrome = findBrowser({ platform: 'linux', env: { CHROME_PATH: '/x/chrome' }, exists: (path) => path === '/x/chrome' })
  assert.equal(envChrome, '/x/chrome')

  const chromium = findBrowser({ platform: 'linux', env: { PATH: '/opt/bin' }, exists: (path) => path === '/opt/bin/chromium' })
  assert.equal(chromium, '/opt/bin/chromium')

  const winChrome = join('C:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe')
  const win = findBrowser({ platform: 'win32', env: { ProgramFiles: 'C:\\PF' }, exists: (path) => path === winChrome })
  assert.equal(win, winChrome)
})

test('createRenderer 无浏览器时抛 BROWSER_MISSING，不启动进程', async () => {
  let launched = false
  const renderer = createRenderer({
    find: () => '',
    run: async () => {
      launched = true
    },
  })
  assert.equal(renderer.available(), false)
  await assert.rejects(() => renderer.render({ format: 'pdf', file: 'x.html', outFile: 'x.pdf' }), (err) => err.code === ERR.LIMIT && err.reason === REASON.BROWSER_MISSING)
  assert.equal(launched, false)
  assert.equal(FORMATS.length, 3)
})
