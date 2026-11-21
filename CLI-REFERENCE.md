# dshdw CLI 参考手册

> 本文件是 `dshdw` 的完整参考：命令、参数、退出码、配置与权限。契约摘要见 [`CLI.md`](./CLI.md)；改命令名、参数或退出码时两份一起改。
>
> 定位：本机辅助入口，进程内复用 `lib/ops.js` 的 `dispatch`，不起 HTTP、不新增 op。`doctor` 与 `config show` 是本地命令，不注册路由。

## 1. 入口模式

| # | 模式 | 语法 | 适用 |
|---|---|---|---|
| ① | 子命令 | `dshdw <资源> <动作> [位置参数] [--flags]` | 人在终端操作 |
| ② | op 直通 | `dshdw op <opName> --args '<json>'` | 脚本、CI、契约对照 |
| ③ | 机器输出 | 任意命令加 `--json`，stdout 只出一行信封 | 管道、断言 |
| ④ | 预演 | 任意命令加 `--dry-run`，只打印 op 与 args，不执行 | 生成命令前自检 |
| ⑤ | stdin | `dshdw op <opName> --stdin`，从标准输入读参数 JSON | 参数大、避免终端转义 |

`--json` **只**控制输出形态，不承载 op 参数；op 参数用 `--args` 或 `--stdin`。

## 2. 命令列表

| 命令 | 映射 op | 位置参数 | 关键旗标 | 退出码 |
|---|---|---|---|---|
| `project ensure` | `project.ensure` | — | `--root --title --kind` | 0,2,3,5,6 |
| `project inspect` | `project.inspect` | — | `--root` / `--project-file` | 0,2,3,4 |
| `project rename <name>` | `project.rename` | `name` | `--project-file` | 0,2,3,4,6 |
| `canvas create` | `canvas.create` | — | `--project-file --title --kind` | 0,2,3,4,6 |
| `canvas select <id>` | `project.select` | `canvasId` | `--project-file` | 0,2,3,4 |
| `canvas remove <id>` | `canvas.remove` | `canvasId` | `--project-file` | 0,2,3,4 |
| `canvas state` | `canvas.state` | — | `--canvas-file` 或 `--project-file` + `--canvas-id` | 0,2,3 |
| `artifact add <rel>` | `artifact.register` | `rel` | `--kind --title --pages --primary` | 0,2,3,5,6 |
| `version list` | `version.list` | — | `--canvas-file` | 0,2 |
| `version snapshot` | `version.snapshot` | — | `--label --source` | 0,2,3,6 |
| `version restore <id>` | `version.restore` | `versionId` | `--canvas-file` | 0,2,3,4 |
| `export run` | `export.run` | — | `--format --stamp --canvas-file` | 0,2,3 |
| `op <opName>` | 目标 op（14 个直通） | `opName` | `--args --stdin --dry-run` | 跟随目标 op |
| `doctor` | 本地，不入表 | — | `--json` | 0,8 |
| `config show` | 本地，不入表 | — | `--json --config` | 0,2 |
| `--version` | 本地 | — | `--json` | 0 |
| `--help` | 本地 | — | — | 0 |

`canvas.wire` 只做路径拼接，不挂命令；`project.read` 只被 `op` 直通和内部画布解析使用。

## 3. 子命令语法与参数

### 3.1 全局旗标

| 旗标 | 值 | 说明 |
|---|---|---|
| `--root <dir>` | 路径 | 工作区根；优先于 profile / 环境变量 |
| `--project-file <path>` | 路径 | 项目索引 `project.json` |
| `--canvas-file <path>` | 路径 | 画布 `work.json`；给定时不再推断 |
| `--canvas-id <id>` | 字符串 | 配合项目索引定位画布 |
| `--config <path>` | 路径 | 追加配置文件，层级高于环境变量 |
| `--timeout <ms>` | 100–600000 | 单次 op 超时；默认 10000 |
| `--browser <path>` | 路径 | 覆盖 `doctor` 的浏览器探测（导出仍读 `CHROME_PATH`） |
| `--json` | 布尔 | stdout 输出 `{ok,op,data}` 或 `{ok:false,code,reason,message}` |
| `--dry-run` | 布尔 | 不执行 op，只打印目标 op 与 args |
| `--stdin` | 布尔 | 仅 `op`：从 stdin 读参数对象 |
| `--args <json>` | JSON 对象 | 仅 `op`：参数对象，与路径旗标合并 |
| `--help` / `--version` | 布尔 | 帮助 / 版本与 op、工具清单 |

### 3.2 各命令

- `project ensure [--root --title --kind]`：幂等建项目与默认画布；二次执行不覆盖项目名，返回 `created:false`。
- `project inspect [--root | --project-file]`：返回项目、各画布 id/kind/title/active/产物数/字节数与上限。
- `project rename <name> [--project-file]`：**只改项目名**；不挪目录、不改 id。空名报 `NAME_EMPTY`。
- `canvas create [--project-file --title --kind]`：新建画布并设为当前，id 从 `c-2` 顺序补空位；上限 8。
- `canvas select <id>`：只切 `activeCanvasId`。
- `canvas remove <id>`：整块画布复制到 `snapshots/<id>/archive-<stamp>/` 后摘索引，不物理删除；只剩一块时报 `CANVAS_MIN`。
- `canvas state [--canvas-file | --project-file --canvas-id]`：返回 work、产物清单、主产物与最新产物；不含文件内容。
- `artifact add <rel> [--kind --title --pages --primary]`：登记已存在的画布内文件；同 `rel` 覆盖元信息，首件自动 primary，显式 primary 会降级旧件。
- `version list`：倒序返回 `vNNN` 快照；没有版本返回空数组。
- `version snapshot [--label --source]`：整块画布副本 + `meta.json`；每块画布保留最近 20 版。
- `version restore <id>`：先自动存 `pre-restore`，再把目标版本整块写回；空版本 `CONFLICT`。
- `export run [--format html|pdf|png --stamp]`：产物落 `.design-work/export/<canvasId>/<stamp>/`；`entry` 与 `files[]` 相对导出的 `dir`，html 为 `site/index.html`；非法格式 `BAD_ARGS`；无浏览器 `LIMIT + BROWSER_MISSING`。
- `op <opName>`：只认 `lib/ops.js` 的 14 个冻结 op；未知 op 退出 2。
- `doctor`：本地检查 Node ≥20、插件版本/schema、op=14、工具=5、root 可写、profile 可解析、浏览器、项目是否初始化；任一项失败退出 8。
- `config show`：打印生效配置与来源，绝对路径脱敏为 `…/<末级>`。
- `--version`：插件版本、schema、op 表、工具名。

## 4. Profile 与配置加载

### 4.1 链路（低 → 高）

```
内置默认（root=cwd, output=human, timeout=10000）
  → 用户 profile: ~/.dsh/profiles/dshdw.json
  → DSHDW_* 环境变量
  → --config <path> 指定文件
  → 命令行旗标（--root / --project-file / --canvas-id / --browser / --timeout / --json）
```

- 只读用户 profile；**不读、不写项目内配置**，`project.json` 不参与配置链。
- 配置文件缺失、JSON 坏、字段未知或类型不符：`BAD_ARGS`，退出 2。
- `--config` 是追加层，不替换 profile。
- 相对路径按当前工作目录解析。

### 4.2 字段

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `root` | string | cwd | 工作区根 |
| `projectFile` | string? | null | 项目索引；空则 `<root>/.design-work/project.json` |
| `canvasId` | string? | null | 默认画布；空则取项目 `activeCanvasId` |
| `output` | `human` \| `json` | `human` | `--json` 覆盖 |
| `browser` | string? | null | 浏览器可执行文件；`doctor` 使用，导出仍读 `CHROME_PATH` |
| `timeout` | number | 10000 | 单次 op 超时（毫秒，100–600000） |

示例：

```json
{
  "root": "D:\\work\\deliverables",
  "canvasId": "c-main",
  "output": "human",
  "browser": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "timeout": 30000
}
```

### 4.3 画布路径解析顺序

1. `--canvas-file`；
2. `--canvas-id`（或 profile / `DSHDW_CANVAS_ID`）+ 项目索引；
3. 读项目 `activeCanvasId`。

解析不到项目或画布按 `NOT_FOUND`，退出 3。

## 5. 环境变量

| 变量 | 对应字段 | 说明 |
|---|---|---|
| `DSHDW_ROOT` | root | 工作区根 |
| `DSHDW_PROJECT_FILE` | projectFile | 项目索引 |
| `DSHDW_CANVAS_ID` | canvasId | 默认画布 |
| `DSHDW_OUTPUT` | output | `human` / `json` |
| `DSHDW_JSON` | output | 非 `0/false/no/off` 时等价 `--json` |
| `DSHDW_BROWSER` | browser | 浏览器路径 |
| `DSHDW_TIMEOUT` | timeout | 毫秒数 |
| `DSHDW_CONFIG` | — | 追加配置文件；`--config` 优先 |
| `CHROME_PATH` | — | 无头浏览器探测第一优先（`doctor` / pdf/png） |

## 6. 插件管理

- 本包既是 DSH 插件，也是 npm 包；插件装/升/卸走宿主 CLI（`dsh plugin ...`），`dshdw` 不写插件安装目录。
- `bin` 只声明 `dshdw`，三种调用形态：

```bash
dshdw --version                     # 全局安装
npx -p dsh-design-workspace dshdw --version
npm exec -- dshdw --version         # 本地 devDependency
```

- npm 包内 `files` 只带 `lib/`、`bin/`、`CLI.md`、`README.md`、`cordis.patch.yml`。
- 升级后 `dshdw doctor` 应与宿主加载的版本一致（`--version` 给出 plugin/version/schema/op/tools）。

## 7. 权限、边界与退出码

- 所有落盘写操作只在 `<root>/.design-work/` 内：项目索引、画布、快照、导出；越界由 op 的路径围栏拒绝。
- CLI 只读配置，不写任何配置文件；doctor 只读，不创建目录。
- 不新增错误码；领域失败统一 `{ok:false,code,reason?,message}`，`--json` 失败仍非零退出。
- 失败信封写 stdout（`--json`），人类错误写 stderr；成功结果写 stdout。

| 退出码 | 含义 | 来源 |
|---|---|---|
| 0 | 成功 | `ok:true` |
| 1 | 未分类兜底 | 非 `OpError` 异常 |
| 2 | 用法错误 | `BAD_ARGS` |
| 3 | 资源不存在 | `NOT_FOUND` |
| 4 | 状态冲突 | `CONFLICT` |
| 5 | 路径围栏拒绝 | `FORBIDDEN` |
| 6 | 超限 | `LIMIT` |
| 7 | 内部错误 | `INTERNAL` |
| 8 | 环境未就绪 | `doctor` 任一项失败 |

## 8. 可直接复制的示例

### 安装与自检

```bash
npm install -g dsh-design-workspace
dshdw --version
dshdw doctor
```

### 初始化

```bash
cd D:\work\my-deliverables
dshdw project ensure --title "深色 SaaS 落地页" --kind web
dshdw project inspect
```

### 日常操作

```bash
dshdw canvas create --title "长文档" --kind doc
dshdw canvas select c-2
dshdw canvas state
dshdw artifact add artifacts/index.html --kind web --title 首页 --primary
dshdw version snapshot --label "改稿前"
dshdw version list
dshdw version restore v001
dshdw export run --format html --stamp final
dshdw export run --format pdf --timeout 120000
```

### 脚本化 / CI

```bash
# JSON 信封 + 非零失败
dshdw project inspect --json
dshdw canvas state --json | jq '.data.artifactsCount'

# 直通 op，参数从参数串
dshdw op project.inspect --args '{"root":"./ws"}' --json

# 参数从 stdin，避免转义
printf '{"root":"./ws"}' | dshdw op project.ensure --stdin --json

# 先预演再执行
dshdw export run --dry-run --json
```

PowerShell：

```powershell
'{"root":"./ws"}' | dshdw op project.ensure --stdin --json
dshdw op project.inspect --args '{\"root\":\"./ws\"}' --json
```

## 9. 契约核对清单

- [x] 命令名与 `lib/cli.js` 的 `COMMANDS` 表一致。
- [x] 直通集合恰为 `OPS`（14 个），`doctor` / `config show` 不入表。
- [x] 六码分别占退出码 2–7，`doctor` 独占 8，兜底 1。
- [x] profile 字段与 `lib/cli-config.js` 一致，项目内无配置。
- [x] 示例命令均可在 `--dry-run` 下先验证参数。
