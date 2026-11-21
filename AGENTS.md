# 仓库规则（给后来的人 / 给 agent）

1. 这个包只做"交付物画布"。**不引入项目库、作品索引、页模型、全页 iframe 壳。**
2. 不自造对话。所有交互走宿主会话；画布只写草稿、只读产物。
3. 新增能力顺序：先加 Host 工具（模型能调），再加 API（画布能读），最后才加 UI。
4. `docs/` 默认不进版本库（`.gitignore` 已声明）；唯一例外是 `docs/testing.md`（测试注册表，CI 需要它在仓库里）。README 里只留公开信息。
5. 改完跑 `npm run ci`，绿了再提交；`pre-commit` 会自动跑 `npm run ci:fast`。
6. 提交粒度：一个能力一个 commit；消息写"为什么"，不写"改了什么文件"。
7. 不手改 `~/.dsh/profiles/*`；安装/升级走 CLI。
8. 客户端没有打包器时，手写 `window.__ModuleLoader__.load({ id, factory })`；有打包器再换，不混用两种格式。
9. 新增、改名、删除测试必须同步 `docs/testing.md` 的注册表；未登记文件或登记了不存在的文件都会让 CI 失败。
10. `ci/protected-tests.json` 里的测试属于回归保护：修改/删除需要 `test-change` 批准（PR 加 `tests-approved`），批准人不能是作者。
11. CI 规则与阈值只严不松。改 `ci/**`、`scripts/ci/**`、`.github/**`、`.githooks/**`、`docs/testing.md`、`AGENTS.md` 需要 `rules-change` 批准（PR 加 `ci-rules-approved`）。
12. 不绕过 hooks、不删测试、不放宽阈值来让失败消失；先修实现，例外走 `ci/approvals/` 并写清原因。
