# 测试策略（唯一事实来源）

本文件登记测试范围、层级、运行方式与元数据。`scripts/ci/run-tests.mjs` 只按这张表执行；`tests/**/*.test.mjs` 只要没登记，`check-registry` 就直接失败。

## 原则

- 测试金字塔：大量快速单元测试，适量集成测试，少量端到端。当前 3 个单元文件、1 个集成文件；e2e 等宿主运行时接入后再登记。
- 用例独立、环境可重复：每个用例自建临时目录并清理；不共享可变状态，不依赖执行顺序。
- 先登记、后写测试：新增、改名、删除测试都必须同步本表。

## 注册表

| Scope | Level | Runner | Args | Metadata |
|---|---|---|---|---|
| `lib/store.js` | unit | node | `--test tests/store.test.mjs` | `fast, isolated, tmpdir` |
| `lib/client.js` | unit | node | `--test tests/client.test.mjs` | `fast, isolated, fake-ctx` |
| `scripts/ci/**` | unit | node | `--test tests/ci/ci.test.mjs` | `fast, isolated` |
| `lib/index.js` | integration | node | `--test tests/integration/host-api.test.mjs` | `fast, isolated, fake-ctx, tmpdir` |
| `lib/project.js` | unit | node | `--test tests/project.test.mjs` | `fast, isolated, tmpdir` |
| `lib/versions.js` | unit | node | `--test tests/versions.test.mjs` | `fast, isolated, tmpdir` |
| `lib/index.js` | integration | node | `--test tests/integration/op-api.test.mjs` | `fast, isolated, fake-ctx, tmpdir` |

## 列含义

- **Scope**：被覆盖的生产路径。必须真实存在；可用 `lib/**` 这类 glob。
- **Level**：`unit` / `integration` / `e2e`，决定由哪个 CI 任务执行。
- **Runner**：当前只允许 `node`（Node 内置 test runner）。
- **Args**：原样传给 runner 的参数，必须且只能包含一个 `tests/**/*.test.mjs`。
- **Metadata**：逗号分隔标签，允许 `fast`、`slow`、`isolated`、`shared`、`tmpdir`、`fake-ctx`、`needs-host`、`needs-browser`、`needs-vm`。

## 新增测试

1. 放到 `tests/unit`、`tests/integration`、`tests/e2e`；根目录 `tests/*.test.mjs` 是历史 unit 位置。
2. 在本表加一行，Scope 填被覆盖的生产路径。
3. 跑 `npm run ci`；目录与注册表不一致会直接红。

## 执行

- 本地：`npm run test` 跑全部登记；`npm run test:unit` 只跑单元；`npm run ci` 跑全门禁。
- CI：unit 跑 Node 20 / 22 矩阵；integration、e2e 分开跑；失败不自动重试。

## 例外

- 修改或删除受保护测试：需要 `test-change` 批准记录，PR 加 `tests-approved` 标签；批准人不能是作者。
- 删除文件、把用例改成 skip、改断言，都会触发 `check-protected`；不会因为“让失败消失”而静默通过。
- e2e 暂为空：等 `tests/e2e` 出现第一个 `*.test.mjs` 时，必须在本表登记，CI 的 e2e 任务会自动接手。
