# dshdw CLI 契约

本机辅助入口：进程内复用 `dispatch`，不起 HTTP，不新增 op。命令/参数/退出码变更先改本文件。完整参数、示例与插件管理见 [`CLI-REFERENCE.md`](./CLI-REFERENCE.md)。

## 入口模式

| 模式 | 语法 | 用途 |
|---|---|---|
| 子命令 | `dshdw <资源> <动作> [参数] [--flags]` | 终端日常 |
| op 直通 | `dshdw op <opName> --args '<json>'` | 脚本 / CI |
| 机器输出 | 任意命令加 `--json` | 一行信封 |
| 预演 | 加 `--dry-run` | 只打印 op 与 args |
| stdin | `dshdw op <opName> --stdin` | 参数走管道 |

`--json` 只控输出；op 参数用 `--args` 或 `--stdin`。

## 命令

| 命令 | op | 位置参数 | 关键旗标 |
|---|---|---|---|
| `project ensure` | `project.ensure` | — | `--root --title --kind` |
| `project inspect` | `project.inspect` | — | `--root / --project-file` |
| `project rename <name>` | `project.rename` | name | `--project-file` |
| `canvas create` | `canvas.create` | — | `--project-file --title --kind` |
| `canvas select <id>` | `project.select` | id | `--project-file` |
| `canvas remove <id>` | `canvas.remove` | id | `--project-file` |
| `canvas state` | `canvas.state` | — | `--canvas-file` 或项目 + `--canvas-id` |
| `artifact add <rel>` | `artifact.register` | rel | `--kind --title --pages --primary` |
| `version list` | `version.list` | — | `--canvas-file` |
| `version snapshot` | `version.snapshot` | — | `--label --source` |
| `version restore <id>` | `version.restore` | id | `--canvas-file` |
| `export run` | `export.run` | — | `--format html\|pdf\|png --stamp` |
| `op <opName>` | 目标 op（14 个） | opName | `--args --stdin --dry-run` |
| `doctor` | 本地，不入表 | — | `--json` |
| `config show` | 本地，不入表 | — | `--json --config` |
| `--version` / `--help` | 本地 | — | `--json` |

`canvas.wire` 不挂命令。

## 配置链（低 → 高）

```
默认（root=cwd, output=human, timeout=10000）
→ ~/.dsh/profiles/dshdw.json
→ DSHDW_* 环境变量
→ --config <path>
→ 命令行旗标
```

字段：`root`、`projectFile`、`canvasId`、`output`（human/json）、`browser`、`timeout`（100–600000ms）。
只读 profile；不读不写项目内配置；坏 JSON / 未知字段 / 类型不符报 `BAD_ARGS`。
`DSHDW_ROOT / PROJECT_FILE / CANVAS_ID / OUTPUT / JSON / BROWSER / TIMEOUT / CONFIG`；导出浏览器探测用 `CHROME_PATH`。

## 退出码

| 码 | 含义 | 来源 |
|---|---|---|
| 0 | 成功 | `ok:true` |
| 1 | 兜底 | 非 `OpError` |
| 2–7 | 六码顺次 | `BAD_ARGS / NOT_FOUND / CONFLICT / FORBIDDEN / LIMIT / INTERNAL` |
| 8 | 环境未就绪 | `doctor` 任一项失败 |

失败信封 `{ok:false,code,reason?,message}`；`--json` 失败仍非零。
成功 `{ok:true,op,data}`。

## 权限与边界

- 写操作只在 `<root>/.design-work/` 内；越界由 op 围栏拒绝。
- CLI 不写配置文件，`doctor` 只读不建目录。
- 不写插件安装目录；装/升/卸走宿主 `dsh plugin`。
- 不新增 op、错误码、路由。

## 最小示例

```bash
dshdw project ensure --title "首屏改版"
dshdw canvas create --title "长文档"
dshdw artifact add artifacts/index.html --primary
dshdw version snapshot --label "改稿前"
dshdw export run --format html --stamp final

dshdw project inspect --json
dshdw op project.inspect --args '{"root":"./ws"}' --json
printf '{"root":"./ws"}' | dshdw op project.ensure --stdin --json
```
