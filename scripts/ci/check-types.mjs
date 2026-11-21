// 类型检查关：项目没有 TS 时诚实跳过；一旦出现 tsconfig / typescript 就自动接管。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { finish, ROOT } from './lib/common.mjs'

const tsconfig = ['tsconfig.json', 'jsconfig.json'].map((name) => join(ROOT, name)).find((path) => existsSync(path))
const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

if (!tsconfig) {
  finish('check-types', {
    ok: true,
    summary: ['未配置 TypeScript：跳过类型检查（纯 JS 项目，语法由 check-lint 负责）'],
    skipped: ['没有 tsconfig.json / jsconfig.json'],
  })
}

if (!existsSync(tsc)) {
  finish('check-types', {
    ok: false,
    summary: ['检测到 tsconfig，但本地没有 typescript'],
    issues: ['请在 devDependencies 安装 typescript，或删除 tsconfig.json（二选一，避免空转）'],
  })
}

const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', tsconfig], { cwd: ROOT, encoding: 'utf8' })
finish('check-types', {
  ok: result.status === 0,
  summary: [`tsc --noEmit · ${tsconfig.replace(ROOT, '')}`],
  issues: result.status === 0 ? [] : [(result.stdout || result.stderr || '').trim().slice(0, 2000)],
  metrics: { exitCode: result.status },
})
