import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { ROOT } from '../scripts/ci/lib/common.mjs'

const code = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')

function loadClient() {
  let loaded = null
  const window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        loaded = { id, factory }
      },
    },
  }
  const context = vm.createContext({ window, console })
  vm.runInContext(code, context, { filename: 'lib/client.js' })
  assert.ok(loaded, 'client.js 必须调用 __ModuleLoader__.load')
  const React = { createElement: () => ({}) }
  const exports = loaded.factory((name) => {
    if (name === 'react') return React
    throw new Error(`意外依赖：${name}`)
  })
  return { id: loaded.id, exports }
}

function fakeCtx() {
  const tabs = []
  const slots = []
  return {
    effect: (fn) => fn(),
    sidebarRightTabs: { register: (tab) => tabs.push(tab) },
    slots: {
      inject: (_name, fn) => fn(),
      register: (slot, component) => slots.push({ ...slot, component }),
    },
    tabs,
    slotsList: slots,
  }
}

test('client 以手写 ModuleLoader 注册右栏页签', () => {
  const { id, exports } = loadClient()
  assert.equal(id, 'dsh-design-workspace')
  assert.equal(exports.name, 'design-workspace')
  assert.equal(JSON.stringify(exports.inject), JSON.stringify(['slots', 'sidebarRightTabs']))
  assert.equal(typeof exports.apply, 'function')
})

test('apply 注册页签、pane 与 title，键名一致', () => {
  const { exports } = loadClient()
  const ctx = fakeCtx()
  exports.apply(ctx)

  assert.equal(ctx.tabs.length, 1)
  assert.equal(ctx.tabs[0].id, 'design-workbench')
  assert.equal(ctx.tabs[0].kind, 'design-workbench')
  assert.equal(JSON.stringify(ctx.tabs[0].patterns), JSON.stringify(['**/.design-work/work.json']))
  assert.equal(ctx.tabs[0].guide[0].order, 40)

  assert.equal(ctx.slotsList.length, 4)
  assert.equal(
    JSON.stringify(ctx.slotsList.map((slot) => slot.name)),
    JSON.stringify(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title', 'sidebar.panellist', 'main']),
  )
})

test('apply 注册左栏「设计工作台」入口，并与 main 面板同键', () => {
  const { exports } = loadClient()
  const ctx = fakeCtx()
  exports.apply(ctx)

  const panel = ctx.slotsList.find((slot) => slot.name === 'sidebar.panellist')
  const main = ctx.slotsList.find((slot) => slot.name === 'main')
  assert.equal(panel.id, 'design-workspace')
  assert.equal(panel.order, 6)
  assert.equal(typeof panel.label, 'function')
  assert.equal(panel.label(), '设计工作台')
  assert.equal(main.key, panel.id)
  assert.equal(typeof panel.component, 'function')
  assert.equal(typeof main.component, 'function')
})
