# 例外批准记录

这里的 JSON 是“人可以批准例外”的机器可读凭据。脚本会校验：`approvedBy` 不能等于当前作者/PR 作者，过期记录不生效。

## 字段

```json
{
  "id": "2026-11-21-example",
  "kinds": ["rules-change"],
  "author": "agent",
  "approvedBy": "user",
  "approvedAt": "2026-11-21",
  "expires": "2026-12-31",
  "paths": ["scripts/ci/check-docs.mjs"],
  "limits": { "maxFiles": 30, "maxLines": 800 },
  "reason": "为什么必须放宽"
}
```

## kinds

| kind | 用途 | 对应 PR 标签 |
|---|---|---|
| `rules-change` | 改 `ci/**`、`scripts/ci/**`、`.github/**`、`.githooks/**`、`docs/testing.md`、`AGENTS.md` | `ci-rules-approved` |
| `test-change` | 改/删受保护测试 | `tests-approved` |
| `diff-budget` | 超文件数/行数预算，`limits` 给本次额度 | 无（记录本身） |
| `policy-relax` | 放宽阈值 | `ci-rules-approved` |
| `baseline-relax` | 改写已存在基线 | `ci-rules-approved` |

`2026-11-21-bootstrap-ci.json` 只用于首次引入 CI 的提交；到期后失效，后续任何放宽都要单独记录。

`bootstrap: true` 的记录只在 **base 里还没有 `ci/policy.json`** 的引入提交生效；`check-scope` 还会拒绝带 `lib/` 改动的 bootstrap 额度。之后的提交必须用新记录。

批准与开发分离由 CODEOWNERS + 分支保护兜底；这里的记录只证明“有人按流程同意”，不替代 review。
