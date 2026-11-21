# dsh-design-workspace

DeepSeek Harness 的设计工作台。**一个会话 = 一个交付物 = 一块画布**。

- 对话、工具、技能、审批、交付全部用宿主的，插件不自造会话。
- 画布只挂一个会话右栏页签（`sidebar.right.pane.tab`），不是全页 iframe 壳。
- 存储就一个目录：`<会话工作区>/.design-work/`，没有项目库、没有作品索引、没有页模型。

## 安装

```bash
dsh plugin --profile desktop add D:\dsh\plugins\dsh-design-workspace
```

装完硬刷新（Ctrl+Shift+R）。要求 DSH 0.2.2-rc.2+。

本地开发时也可以直接把这个目录当包挂进 profile（见 `docs/02-INTEGRATION.md`，该文件不进版本库）。

## 目录

```
lib/
  index.js     Host 半片：工具注册 + /design-workspace/api/state
  store.js     交付物读写与路径围栏（<root>/.design-work/work.json）
  tools.js     模型工具：design_work_start / design_work_state
  client.js    浏览器半片：__ModuleLoader__ 包装 + 右栏页签
tests/
  store.test.mjs
cordis.patch.yml   bundle 挂载声明
```

## 工具

| 工具 | 作用 |
|---|---|
| `design_work_start` | 在会话工作区开交付物，返回 `work.json` 绝对路径 |
| `design_work_state` | 读交付物状态：标题、产物数、最新产物 |

产物内容由模型用技能 + 文件工具写；画布只读结果。

## 测试

```bash
node --test tests/*.test.mjs
```

## 文档

设计决策、接入细节、旧项目迁移清单放在 `docs/`，**按约定不追踪**（见 `.gitignore`）。本机在工作目录里能看到。
