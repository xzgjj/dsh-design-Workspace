// CLI 本地自检：只读环境和已安装文件，不写盘、不注册 op/路由。
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { OPS } from './ops.js'
import { TOOLS } from './tools.js'
import { PLUGIN_VERSION, SCHEMA_VERSION } from './contracts.js'
import { findBrowser } from './renderer.js'
import { readProfile } from './cli-config.js'

function checkList({ config, env, home, find }) {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail })

  const major = Number(process.versions.node.split('.')[0])
  add('node', major >= 20, `Node ${process.versions.node}（要求 ≥20）`)
  add('plugin', true, `${PLUGIN_VERSION} / schema ${SCHEMA_VERSION}`)
  add('ops', OPS.length === 14, `${OPS.length} 个 op（冻结 14）`)
  add('tools', TOOLS.length === 5, `${TOOLS.length} 个工具（冻结 5）`)

  let rootOk = false
  let rootDetail = `工作区不存在：${config.root}`
  if (existsSync(config.root) && statSync(config.root).isDirectory()) {
    try {
      accessSync(config.root, constants.W_OK)
      rootOk = true
      rootDetail = `可写：${config.root}`
    } catch {
      rootDetail = `不可写：${config.root}`
    }
  }
  add('root', rootOk, rootDetail)

  let profileOk = true
  let profileDetail = '未设置（使用默认值）'
  try {
    const loaded = readProfile(home)
    if (loaded) profileDetail = '已加载'
  } catch {
    profileOk = false
    profileDetail = 'JSON 或字段不合法'
  }
  add('profile', profileOk, profileDetail)
  const configured = config.browser
  const browser = configured ? (existsSync(configured) ? configured : '') : find({ env })
  add('browser', Boolean(browser), browser || (configured ? `浏览器路径不存在：${configured}` : '未找到 Chrome/Edge（设 CHROME_PATH 或 profile.browser）'))

  const project = join(config.root, '.design-work', 'project.json')
  add('project', true, existsSync(project) ? '已初始化' : '未初始化（可运行 project ensure）')
  return checks
}

export function runDoctor({ config, env = process.env, home, findBrowser: find = findBrowser } = {}) {
  const checks = checkList({ config, env, home, find })
  return { ok: checks.every((check) => check.ok), checks }
}
