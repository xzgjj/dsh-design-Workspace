// 无头浏览器探测与渲染：pdf / png 都走本机 Chrome/Edge，缺失时报 BROWSER_MISSING。
// 独立临时 profile，不复用用户浏览器；超时杀进程，失败不留半截文件由 export 清理。
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ERR, REASON, opError } from './contracts.js'

const WIN_NAMES = ['chrome.exe', 'msedge.exe']
const UNIX_NAMES = ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome']

function winCandidates(env) {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean)
  return roots.flatMap((base) => [
    join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ])
}

function darwinCandidates() {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]
}

function linuxCandidates() {
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
}

function pathCandidates(env, names, platform = process.platform) {
  const win = platform === 'win32'
  const dirs = String(env.PATH || env.Path || '')
    .split(win ? ';' : ':')
    .filter(Boolean)
  return dirs.flatMap((dir) => names.map((name) => (win ? join(dir, name) : posix.join(dir, name))))
}

// 探测顺序：CHROME_PATH → 平台常见安装路径 → PATH 里的已知可执行名。
export function findBrowser({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  if (env.CHROME_PATH && exists(env.CHROME_PATH)) return env.CHROME_PATH
  const fixed = platform === 'win32' ? winCandidates(env) : platform === 'darwin' ? darwinCandidates() : linuxCandidates()
  for (const candidate of fixed) if (exists(candidate)) return candidate
  const names = platform === 'win32' ? WIN_NAMES : UNIX_NAMES
  for (const candidate of pathCandidates(env, names, platform)) if (exists(candidate)) return candidate
  return ''
}

function chromeArgs({ format, outFile, profile }) {
  const common = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    `--user-data-dir=${profile}`,
  ]
  if (format === 'pdf') return [...common, '--no-pdf-header-footer', `--print-to-pdf=${outFile}`]
  return [...common, '--window-size=1440,900', `--screenshot=${outFile}`]
}

function runBrowser({ exe, format, url, outFile, timeoutMs = 90_000 }) {
  return new Promise((resolve, reject) => {
    const profile = mkdtempSync(join(tmpdir(), 'dshdw-browser-'))
    const args = [...chromeArgs({ format, outFile, profile }), url]
    const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      rmSync(profile, { recursive: true, force: true })
      reject(opError(ERR.INTERNAL, '', `浏览器启动失败：${err.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      rmSync(profile, { recursive: true, force: true })
      if (timedOut) return reject(opError(ERR.LIMIT, '', `渲染超时（${timeoutMs}ms）`))
      if (!existsSync(outFile)) return reject(opError(ERR.INTERNAL, '', `渲染失败（退出码 ${code}）`))
      return resolve({ outFile, bytes: 0 })
    })
  })
}

export function createRenderer({ find = findBrowser, run = runBrowser, timeoutMs = 90_000 } = {}) {
  async function render({ format, file, outFile }) {
    const exe = find()
    if (!exe) throw opError(ERR.LIMIT, REASON.BROWSER_MISSING, '没有可用的 Chrome/Edge；装浏览器或设置 CHROME_PATH')
    const url = pathToFileURL(file).href
    await run({ exe, format, url, outFile, timeoutMs })
    return { outFile, browser: exe, source: file }
  }
  return { render, find, available: () => Boolean(find()) }
}
