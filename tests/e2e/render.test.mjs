// 真实浏览器端到端：有 Chrome/Edge 才跑，缺浏览器时显式 skip，不制造假绿灯。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRenderer, findBrowser } from '../../lib/renderer.js'

const browser = findBrowser()

test('真实浏览器：pdf/png 产物落盘且非空', { skip: !browser && '未找到 Chrome/Edge' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshdw-e2e-render-'))
  try {
    const source = join(dir, 'page.html')
    writeFileSync(source, '<html><body><h1>E2E</h1><section>一页</section></body></html>')
    const renderer = createRenderer({ timeoutMs: 60_000 })

    const pdf = join(dir, 'page.pdf')
    const png = join(dir, 'page.png')
    await renderer.render({ format: 'pdf', file: source, outFile: pdf })
    await renderer.render({ format: 'png', file: source, outFile: png })

    assert.equal(existsSync(pdf), true)
    assert.equal(existsSync(png), true)
    assert.equal(statSync(pdf).size > 0, true)
    assert.equal(statSync(png).size > 0, true)
    assert.equal(readFileSync(pdf).subarray(0, 4).toString(), '%PDF')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
