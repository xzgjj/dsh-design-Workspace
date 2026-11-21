# e2e（预留）

端到端测试需要 DSH 宿主运行时与浏览器，当前仓库没有可用 harness，因此 `tests/e2e` 暂不放 `*.test.mjs`。

接入时：

1. 在这里放 `*.test.mjs`，优先用宿主提供的真实会话、右栏页签与 API。
2. 在 `docs/testing.md` 注册一行，Level 填 `e2e`，Metadata 至少含 `slow` 与 `needs-host`。
3. CI 的 `e2e` job 会自动按表执行；没有登记会先被 `check-registry` 拦下。

不要用单元测试冒充 e2e：e2e 只验证“会话 → 工具 → 产物 → 画布”这条真实链路。
