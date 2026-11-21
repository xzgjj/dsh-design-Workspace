// 规则审批关：CI 规则文件本身被改动时，必须出现独立批准人。
import { finish, changedFiles, currentAuthor, findApproval, loadPolicy, matchesAny, refHasFile } from './lib/common.mjs'

const policy = loadPolicy()
const base = process.env.CI_BASE_SHA || process.env.GITHUB_BEFORE || ''
const staged = process.argv.includes('--staged')
const usableBase = base && !/^0+$/.test(base)

if (!usableBase && !staged) {
  finish('check-rules', {
    ok: true,
    summary: ['没有 base ref，跳过规则变更审批（CI 里由 CI_BASE_SHA 提供）'],
    skipped: ['本地运行未指定 base'],
  })
}

const changes = changedFiles({ base: usableBase ? base : undefined, staged })
const ruleFiles = changes.files.map((file) => file.path).filter((path) => matchesAny(path, policy.rules.paths))
if (!ruleFiles.length) {
  finish('check-rules', { ok: true, summary: [`本次未改动 CI 规则文件（${changes.files.length} 个文件）`] })
}

const approval = findApproval({
  kinds: ['rules-change'],
  label: policy.rules.label,
  allowBootstrap: !usableBase ? staged : !refHasFile(base, 'ci/policy.json'),
})
const issues = []
if (!approval) {
  issues.push(`规则文件改动需要独立批准（PR 标签 ${policy.rules.label}）：${ruleFiles.join(', ')}`)
}
if (approval && approval.approvedBy === currentAuthor()) {
  issues.push(`批准人不能等于改动作者（${approval.approvedBy}）`)
}

finish('check-rules', {
  ok: issues.length === 0,
  summary: [
    `规则文件改动 ${ruleFiles.length} 个`,
    approval ? `批准：${approval.id} / ${approval.approvedBy}` : '未找到批准记录',
  ],
  issues,
  metrics: { ruleFiles, approval: approval?.id || null },
})
