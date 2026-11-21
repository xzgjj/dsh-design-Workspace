# dsh-design-workspace

DeepSeek Harness 的设计工作台。**一个会话 = 一个交付物 = 一块画布**。

- 对话、工具、技能、审批、交付全部用宿主的，插件不自造会话。
- 画布只挂一个会话右栏页签（`sidebar.right.pane.tab`），不是全页 iframe 壳。
- 存储就一个目录：`<会话工作区>/.design-work/`，`project.json` 管画布索引，`canvases/<id>/work.json` 管单块交付物；没有作品库、没有页模型。

## 安装

```bash
dsh plugin --profile desktop add D:\dsh\plugins\dsh-design-workspace
```

装完硬刷新（Ctrl+Shift+R）。要求 DSH 0.2.2-rc.2+。

本地开发时也可以直接把这个目录当包挂进 profile（见 `docs/02-INTEGRATION.md`，该文件不进版本库）。

## 目录

```
lib/
  index.js      Host 半片：5 工具注册 + POST /api + GET /asset 旁路
  contracts.js  6 错误码 + 9 reason + 路径围栏与参数校验（冻结）
  project.js    project.json v3：画布增删改选、legacy 迁移、归档删除
  store.js      画布 work.json v2：围栏、原子写、产物清单、primary
  artifact.js   产物登记：去重、主产物、rel 围栏
  transport.js  scope ↔ 绝对路径、单 op 分发、统一信封
  versions.js   画布级快照 / 列表 / 恢复（≤20）
  export.js     整树导出（S2 扩 html/pdf/png）
  tools.js      模型工具 5 个
  client.js     浏览器半片：__ModuleLoader__ 包装 + 右栏页签
tests/
  *.test.mjs                  unit：契约 / store / project / artifact / tools / versions / client
  integration/op-api.test.mjs integration：POST /api、scope、信封、asset
  integration/host-api.test.mjs integration：5 工具链路 + 路由
  e2e/README.md               端到端预留（需要宿主运行时）
scripts/ci/                   CI 门禁（文档、注册表、质量、范围、保护测试）
ci/                           阈值、基线、批准记录
docs/testing.md               测试注册表（唯一事实来源，例外进版本库）
cordis.patch.yml   bundle 挂载声明
```

## 工具

| 工具 | 作用 |
|---|---|
| `design_work_start` | 确保项目与当前画布，返回画布 `work.json` 绝对路径 |
| `design_work_add_artifact` | 登记已写好的产物，第一件自动成为主产物 |
| `design_work_new_canvas` | 新建画布并设为当前（最多 8 块） |
| `design_work_state` | 读标题、产物数、最新与主产物 |
| `design_work_export` | 导出画布整树（html / pdf / png） |

产物内容由模型用技能 + 文件工具写；画布只读结果。

## 路由

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/design-workspace/api` | 单 op 端点（14 个 op，信封 `code/reason/message`） |
| GET | `/design-workspace/asset?path=` | 只读 `.design-work` 内的单文件 |
| GET | `/design-workspace/api/health` | 插件存活自检 |
| GET | `/design-workspace/api/version` | 版本、op 表、工具名、路由清单 |

## 测试与 CI

```bash
npm run test       # 按 docs/testing.md 注册表跑全部
npm run test:unit
npm run ci         # 全量门禁（本地与 GitHub Actions 同一套脚本）
npm run ci:fast    # 提交前
```

新增测试必须先在 `docs/testing.md` 的表格里登记；`check-registry` 会拦住遗漏。测试保护、规则审批、阈值收紧等规则见 `CI.md`。

## 文档

设计决策、接入细节、旧项目迁移清单放在 `docs/`，**默认不追踪**（见 `.gitignore`）。唯一例外是 `docs/testing.md`：它是测试策略的唯一事实来源，必须随仓库走。
