# CI 规则

本仓库的 CI 只有一套实现：`scripts/ci/*.mjs`。本地 `npm run ci`、Git hooks 和 GitHub Actions 调用的都是这批脚本，避免“本地绿、CI 红”。

## 触发

| 时机 | 入口 | 范围 |
|---|---|---|
| 每次 `git commit` | `.githooks/pre-commit` | 文档预算、注册表、阈值收紧、Lint、受保护测试、unit |
| 每次 `git push` | `.githooks/pre-push` | 全部门禁（含集成、e2e、sanitizer、改动范围） |
| PR / push main | `.github/workflows/ci.yml` | 与 `npm run ci` 同一批脚本，分 job 并行 |
| 手工 | `npm run ci` / `node scripts/ci/run-all.mjs --gate <name>` | 全量或单关 |

`npm run ci:install-hooks` 把 `core.hooksPath` 指到 `.githooks`。hooks 不写全局 git 配置。

**重试上限**：`ci/policy.json` 的 `retry.maxAttempts` 固定为 1；脚本不做自动重试，失败即红。workflow 每个 job 有 `timeout-minutes`，不用“重跑脚本”掩盖不稳定。

## 门禁

| Gate | 自动判定 | 失败后先做什么 | 留给人判断 |
|---|---|---|---|
| `check-docs` | 文档字数/字节预算、重复段落、相对链接 | 删重复、拆文档、补链接 | 这段细节是否值得保留 |
| `check-registry` | `docs/testing.md` 与 `tests/**/*.test.mjs` 一一对应 | 补登记或删孤儿行 | 测试层级是否放对 |
| `check-policy` | 阈值只严不松 | 改回更严的值 | 放宽是否必要 |
| `check-lint` | `node --check` + 危险模式 + 两条契约 | 修代码，不关规则 | 命名与设计 |
| `check-types` | 有 tsconfig 就跑 `tsc --noEmit`；没有则诚实跳过 | 补类型或删空配置 | 类型是否值得引入 |
| `check-complexity` | 文件 400 行 / 函数 80 行 / 复杂度 12 / 嵌套 5 | 拆函数 | 抽象是否必要 |
| `check-duplication` | 生产代码连续 6 行重复 | 合并或说明 | 重复是否真的同义 |
| `check-unused` | lib 导出在仓库内无引用 | 删除或接入 | 是否是对外 API |
| `run-tests` | 按注册表跑 unit / integration / e2e | 修实现或用例 | 行为变更是否合理 |
| `check-protected` | 受保护测试被改/删 | 恢复或走批准 | 改测试是否在掩盖失败 |
| `check-rules` | 规则文件改动必须有独立批准 | 补批准或撤回 | 批准者与开发者是否分离 |
| `check-scope` | 改动白名单 + Diff 预算 | 拆 PR | 超范围是否批准 |
| `check-sanitizers` | 检测原生代码；需要时实际跑 ASan/UBSan/TSan | 配置并跑 | 内存问题是否真实 |

所有判定都读实际文件、Git diff 与测试输出，报告落在 `reports/ci/*.json`（CI 作为 artifact 上传）。

## 文档预算

- **契约/规划文档**：`CLAUDE.md`、`implementation_plan*`、`AGENT_EXECUTION_PROTOCOL.md`、`SPEC.md`、`docs/SPEC-*.md`、`CLI.md`、`docs/规划/**`，上限 **3000 字**（非空白字符）。
- **一般文档**：其余 Markdown，上限 **20 KB**。
- **分析/记录文档**：`docs/research/**` 及名字含“调研 / 分析 / 复盘 / 记录”的文件，**不设上限**。

现有超限文档在首次引入时冻结为基线（记录 sha256）：不改就继续存在；一旦改动，必须改到预算内。细节写不进 3000 字的，放分析文档，别把契约文档撑爆。

重复段落按空行切块、规范化后哈希；断链检查只查仓库内相对链接。老重复与老断链冻结，新增才红。

## 代码质量

- **Lint**：禁止 `debugger`、`eval`、`new Function`、`var`、`with`；`lib/` 禁止 `console.*`（确需保留行尾写 `ci-allow`）；`lib/client.js` 必须保留 `__ModuleLoader__.load`，`lib/index.js` 必须导出 `apply`。
- **类型**：当前纯 JS，未配置 `tsconfig.json`，类型关诚实跳过。新增 `tsconfig.json` 且安装 `typescript` 后自动执行。
- **复杂度**：超标的既有函数冻结；新增函数或继续变差才失败。
- **重复**：只扫生产代码 `lib/**`，测试与 CI 脚本不参与，避免样板误报。
- **未用导出**：入口文件（`package.json` 的 `main` / `exports`）豁免；其余导出无引用即失败。

## 改动范围与 Diff 预算

`ci/policy.json` 的 `scope.allow` 是白名单，`scope.deny` 一票否决（`assets/`、`reports/`、`.design-work/` 等）。默认预算 **20 个文件 / 500 行**。超范围或超预算需要 `diff-budget` 批准记录；本仓库首次引入 CI 的提交用一条 bootstrap 批准额度，但该额度只在 base 里还没有 `ci/policy.json` 时生效，且不允许带 `lib/` 改动。

小任务变大重构：先拆 PR，不要靠批准硬闯。

## 测试

`docs/testing.md` 是测试策略的唯一事实来源，表头固定为 `Scope | Level | Runner | Args | Metadata`。

- 测试金字塔：unit 多、integration 适量、e2e 少。当前 e2e 为空，等宿主运行时接入。
- 新增 `tests/**/*.test.mjs` 必须登记，否则 `check-registry` 失败；反向，登记了不存在的文件也失败。
- `run-tests.mjs` 只按表执行，Args 原样传给 runner；CI 不再维护第二份测试文件清单。
- `ci/protected-tests.json` 记录测试文件哈希。修改或删除受保护测试需要 `test-change` 批准记录 + PR 标签 `tests-approved`，且批准人不能等于作者。

## 规则变更

以下路径属于“规则文件”：`ci/**`、`scripts/ci/**`、`.github/**`、`.githooks/**`、`docs/testing.md`、`AGENTS.md`。

- PR 必须打 `ci-rules-approved` 标签，并提交 `ci/approvals/*.json` 的 `rules-change` 记录。
- `.github/CODEOWNERS` 把这些路径指给规则负责人；仓库分支保护需开启 **Require review from Code Owners**、**Dismiss stale approvals**、**Do not allow bypassing**。
- 脚本会校验 `approvedBy != author`；真正的分离由 CODEOWNERS + 分支保护兜底，脚本只做可判定部分。

## 内存检查

`check-sanitizers` 扫描 `*.c/cc/cpp/h/hpp`、`binding.gyp`、`CMakeLists.txt`、`Cargo.toml`。

- 没有原生代码：跳过并明确报告“不需要”。
- 出现原生代码：必须在 `ci/policy.json` 打开 `sanitizers.enabled`，填 `asan` / `ubsan` / `tsan` 三条可执行命令；CI 会实际执行，不接受“以后再说”。

## 基线、收紧与例外

- **首次引入即基线**：`ci/baselines/*.json` 与 `ci/policy.baseline.json` 记录当前状态。
- **规则只严不松**：`_monotonic` 里的阈值只能变小（预算、复杂度）或变大（测试层级下限、sanitizer 开关）。
- **基线只紧不宽**：已存在基线再改写，需要 `baseline-relax` 批准；否则 `guardBaselineWrite` 直接拒绝。
- **判定只认实测**：所有数字来自当前文件与命令输出，不读缓存、不读“上次结果”。

例外记录放 `ci/approvals/<date>-<topic>.json`：

```json
{
  "id": "2026-11-21-example",
  "kinds": ["rules-change"],
  "author": "agent",
  "approvedBy": "repo-owner",
  "approvedAt": "2026-11-21",
  "expires": "2026-12-31",
  "paths": ["scripts/ci/check-docs.mjs"],
  "reason": "为什么必须这次放宽"
}
```

## 已知限制

- `docs/` 默认不进版本库，GitHub runner 只能检查 `docs/testing.md` 等已提交文档；私有设计文档的预算与断链由本地 `npm run ci` 兜底。
- 类型检查等待 TypeScript 接入；现在只做语法检查。
- e2e 需要 DSH 宿主运行时，仓库内暂无可用 harness。
- Windows 本地与 Linux CI 的路径/大小写差异由测试用例覆盖一部分，不保证全部。

## 命令

```bash
npm run ci              # 全量
npm run ci:fast         # 提交前
npm run test            # 只跑注册表里的测试
npm run test:unit
npm run ci:baseline     # 仅首次引入；之后改写基线需要批准
npm run ci:install-hooks
node scripts/ci/run-all.mjs --gate docs
```
