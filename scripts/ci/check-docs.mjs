// 文档关：字数预算 + 重复段落 + 相对链接一致性。
// 预算分类：分析/记录不限；契约/规划 3000 字；其余 20KB。
// 首次引入把现存超限文档冻结为基线，之后只允许缩小或改写进预算。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs, readJson, writeJson, guardBaselineWrite, loadPolicy, matchesAny, listFiles, readText, sha256Text, finish, ROOT, rel } from './lib/common.mjs'

const args = parseArgs()
const policy = loadPolicy()
const updating = Boolean(args['update-baseline'])

const DOC_BASELINE = join(ROOT, 'ci', 'baselines', 'docs.json')
const DUP_BASELINE = join(ROOT, 'ci', 'baselines', 'doc-duplication.json')
const LINK_BASELINE = join(ROOT, 'ci', 'baselines', 'doc-links.json')

const files = listFiles({
  include: ['docs/**/*.md', '*.md', '**/CLAUDE.md', '**/implementation_plan*.md', '**/AGENT_EXECUTION_PROTOCOL.md', '**/SPEC.md', '**/CLI.md'],
})

const docBaseline = readJson(DOC_BASELINE, { files: {} })
const dupBaseline = readJson(DUP_BASELINE, { hashes: [] })
const linkBaseline = readJson(LINK_BASELINE, { missing: [] })

const issues = []
const summary = []
const notes = []
const skipped = []
let overBudgetFrozen = 0
let contractCount = 0
let analysisCount = 0

const nextDocs = {}

for (const file of files) {
  const text = readText(join(ROOT, file))
  const bytes = Buffer.byteLength(text, 'utf8')
  const chars = [...text.replace(/\s+/g, '')].length

  let kind = 'general'
  if (matchesAny(file, policy.docs.analysisPatterns)) kind = 'analysis'
  else if (matchesAny(file, policy.docs.contractPatterns)) kind = 'contract'

  const hash = sha256Text(text)
  let limitBytes = policy.docs.generalMaxBytes
  let limitChars = null
  if (kind === 'contract') {
    contractCount += 1
    limitChars = policy.docs.contractMaxChars
    limitBytes = null
  } else if (kind === 'analysis') {
    analysisCount += 1
    limitBytes = null
  }

  const frozen = docBaseline.files[file]
  const unchanged = frozen && frozen.sha256 === hash
  let over = false
  if (limitChars != null) over = chars > limitChars
  if (limitBytes != null) over = bytes > limitBytes

  if (over) {
    if (unchanged) overBudgetFrozen += 1
    else if (updating) {
      notes.push(`冻结 ${file}（${kind}，${chars} 字 / ${bytes} B）`)
    } else {
      const measured = limitChars != null ? `${chars} 字（上限 ${limitChars}）` : `${bytes} B（上限 ${limitBytes}）`
      issues.push(`文档超预算：${file} 是 ${kind}，${measured}`)
    }
  }

  nextDocs[file] = { sha256: hash, chars, bytes, kind }
}

if (updating) {
  guardBaselineWrite(DOC_BASELINE, true)
  writeJson(DOC_BASELINE, { generatedAt: new Date().toISOString(), limit: { generalMaxBytes: policy.docs.generalMaxBytes, contractMaxChars: policy.docs.contractMaxChars }, files: nextDocs })
  notes.push(`写入 ${rel(DOC_BASELINE)}：${Object.keys(nextDocs).length} 个文档`)
} else {
  summary.push(`文档 ${files.length} 个（契约 ${contractCount} / 分析 ${analysisCount} / 其他 ${files.length - contractCount - analysisCount}）`)
  summary.push(`超预算但已冻结 ${overBudgetFrozen} 个；未冻结超限 ${issues.length} 个`)
}

// 重复段落：按空行切块，规范化后做哈希；基线内命中不算新增。
const groups = new Map()
const paragraphBy = new Map()
for (const file of files) {
  const text = readText(join(ROOT, file))
  const blocks = text.split(/\n\s*\n/)
  blocks.forEach((block, index) => {
    const raw = block.trim()
    if (!raw || raw.startsWith('#') || raw.startsWith('```') || raw.startsWith('|')) return
    const normalized = raw
      .replace(/[`*_>~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const length = [...normalized.replace(/\s+/g, '')].length
    if (length < policy.docs.minDuplicateChars) return
    const hash = sha256Text(normalized)
    paragraphBy.set(`${file}#${index}`, { file, index, hash, preview: raw.slice(0, 60) })
    const group = groups.get(hash) || []
    group.push(`${file}#${index}`)
    groups.set(hash, group)
  })
}

const duplicateHashes = []
const duplicateGroups = []
for (const [hash, members] of groups) {
  if (members.length < 2) continue
  duplicateHashes.push(hash)
  duplicateGroups.push({ hash, members: members.map((key) => paragraphBy.get(key)) })
}

const knownHashes = new Set(dupBaseline.hashes)
const newDuplicates = duplicateGroups.filter((group) => !knownHashes.has(group.hash))
if (!updating) {
  summary.push(`重复段落组 ${duplicateGroups.length} 个（新增 ${newDuplicates.length} 个）`)
  for (const group of newDuplicates) {
    issues.push(`新增重复段落：${group.members.map((m) => `${m.file}#${m.index}`).join(' / ')} — “${group.members[0].preview}…”`)
  }
}
if (updating) {
  guardBaselineWrite(DUP_BASELINE, true)
  writeJson(DUP_BASELINE, { generatedAt: new Date().toISOString(), hashes: duplicateHashes.sort() })
  notes.push(`写入 ${rel(DUP_BASELINE)}：${duplicateHashes.length} 组重复段落`)
}

// 链接一致性：只查仓库内相对链接，外链与锚点跳过。
const missingLinks = []
const linkRe = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
for (const file of files) {
  const text = readText(join(ROOT, file))
  const base = dirname(join(ROOT, file))
  for (const match of text.matchAll(linkRe)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#|\/)/.test(target)) continue
    const clean = target.split('#')[0]
    if (!clean) continue
    const abs = resolve(base, clean)
    if (!existsSync(abs)) missingLinks.push({ file, target, resolved: rel(abs) })
  }
}

const knownMissing = new Set(linkBaseline.missing.map((item) => `${item.file}|${item.target}`))
const newMissing = missingLinks.filter((item) => !knownMissing.has(`${item.file}|${item.target}`))
if (!updating) {
  summary.push(`断链 ${missingLinks.length} 个（新增 ${newMissing.length} 个）`)
  for (const item of newMissing) issues.push(`断链：${item.file} → ${item.target}（解析为 ${item.resolved}）`)
}
if (updating) {
  guardBaselineWrite(LINK_BASELINE, true)
  writeJson(LINK_BASELINE, { generatedAt: new Date().toISOString(), missing: missingLinks.map(({ file, target, resolved }) => ({ file, target, resolved })) })
  notes.push(`写入 ${rel(LINK_BASELINE)}：${missingLinks.length} 个断链`)
}

finish('check-docs', { ok: issues.length === 0, summary, issues, notes, skipped, metrics: { files: files.length, contractCount, analysisCount, overBudgetFrozen, duplicateGroups: duplicateGroups.length, newDuplicates: newDuplicates.length, missingLinks: missingLinks.length } })
