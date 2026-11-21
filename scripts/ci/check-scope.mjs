// 改动范围关：白名单 + Diff 预算；超范围或超预算需 diff-budget 批准。
import { finish, changedFiles, findApproval, loadPolicy, matchesAny, refHasFile } from './lib/common.mjs'

const policy = loadPolicy()
const base = process.env.CI_BASE_SHA || process.env.GITHUB_BEFORE || ''
const staged = process.argv.includes('--staged')
const usableBase = base && !/^0+$/.test(base)

if (!usableBase && !staged) {
  finish('check-scope', {
    ok: true,
    summary: ['没有 base ref，跳过 Diff 预算（CI 里由 CI_BASE_SHA 提供）'],
    skipped: ['本地运行未指定 base；pr 场景必须提供'],
  })
}

const changes = changedFiles({ base: usableBase ? base : undefined, staged })
if (!changes.files.length) {
  finish('check-scope', { ok: true, summary: [`改动 0 个文件（${changes.mode}）`] })
}

// bootstrap 批准只在“base 里还没有 ci/policy.json”的引入提交生效，且不能带 lib 改动。
const bootstrapMode = !usableBase ? staged : !refHasFile(base, 'ci/policy.json')
let approval = findApproval({ kinds: ['diff-budget'], allowBootstrap: bootstrapMode })
if (approval?.bootstrap && changes.files.some((file) => file.path.startsWith('lib/'))) approval = null
const budget = approval?.limits || policy.scope.diffBudget
const issues = []
const denied = []
for (const file of changes.files) {
  if (matchesAny(file.path, policy.scope.deny)) denied.push(file.path)
  else if (!matchesAny(file.path, policy.scope.allow)) issues.push(`不在改动白名单：${file.path}`)
}
for (const file of denied) issues.push(`禁止改动的路径：${file}`)

const lines = changes.files.reduce((sum, file) => sum + file.added + file.deleted, 0)
if (changes.files.length > budget.maxFiles) issues.push(`改动文件 ${changes.files.length} 个，超过预算 ${budget.maxFiles}`)
if (lines > budget.maxLines) issues.push(`改动行数 ${lines}，超过预算 ${budget.maxLines}`)

const summary = [
  `改动 ${changes.files.length} 个文件 / ${lines} 行（预算 ${budget.maxFiles} / ${budget.maxLines}）`,
  approval ? `使用批准额度：${approval.id}（${approval.approvedBy}）` : '使用默认预算',
]
const biggest = [...changes.files].sort((a, b) => b.added + b.deleted - (a.added + a.deleted)).slice(0, 5)
if (biggest.length) summary.push(`最大改动：${biggest.map((file) => `${file.path} +${file.added}/-${file.deleted}`).join('；')}`)

finish('check-scope', {
  ok: issues.length === 0,
  summary,
  issues,
  metrics: { files: changes.files.length, lines, budget, mode: changes.mode, approval: approval?.id || null },
})
