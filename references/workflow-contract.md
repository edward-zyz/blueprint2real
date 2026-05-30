# Workflow Contract · state/* schema + 校验脚本契约摘要

> 何时读本文：你在 sub-agent 模板里看到"按 schema 写 state/*"，又拿不准具体字段时。完整契约在 `<devRoot>/workflow/scripts/validate-state.mjs` 本体（默认 `<devRoot>` = `b2r-process/`）。

## state/active.md

必填字段（被 `render-board.mjs::parseActive` 与 `validate-state.mjs` 双重消费）：

- `- ID:` — `—`（Idle）或合法 work id（如 `IS-001`）
- `- Name:` — 工单名（Idle 时 `—`）
- `- Status:` — `Idle | Ready | In Progress | Blocked`（**Done 不在 active.md 停留**）
- `- Started:` — ISO 日期或 `—`
- `- Blockers:` — 自由文本或 `—`
- `- Next checkpoint:` — 自由文本或 `—`
- `- Last commit:` — handoff commit 的 7-hex 摘要，格式建议 `<7hex>（<workId> handoff · YYYY-MM-DD）`

不变量：

- `Status=Idle` ⇔ `ID=—`
- `Status ∈ {In Progress, Blocked}` ⇔ `ID` 匹配 work-id regex（来自 config）

`## 当前状态` 段：bullet 列表，每条 ≤2 行，总 ≥3 条。**禁止长段叙述**——BOARD HERO 区会渲染本段。

## state/queue.md

表头固定 8 列：

```
| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
```

Status 枚举：`Planned | Ready | In Progress | Blocked | Done | Superseded`。

按 Status 的字段约定：

- `Planned`：spec / plan / commit / 完成日期 一律 `—`，且文件末 `## Planned 工单范围摘要` 段下必有 `### <work-id> ·` 小节
- `Ready`：spec / plan 填路径（spec 形如 `\`../specs/IS-001_<slug>.md\``、plan 形如 `\`../work/IS-001_<slug>/plan.md\``，`<slug>` 由 `workItemSlug({ workId, title })` 算出），commit / 完成日期 仍 `—`，§Planned 摘要段对应小节已被 promote 删除
- `In Progress / Blocked`：spec / plan 同 Ready；commit 仍 `—`
- `Done`：commit 填 implementation commit 的 7-40 hex；完成日期填 YYYY-MM-DD
- `Superseded`：编号不还回池，spec/plan 路径保留

**双源约束**：`Status=Planned` ⇔ §Planned 摘要段下有对应小节；promote 后必须从摘要段删除（promote.mjs 自动做）。

## state/roadmap.md

必有里程碑二级标题（按 `workflow.config.milestones` 数组顺序），每个里程碑下必有：

```
- **状态**：<one of: Planned | Contract Done | Demo Ready | Production Ready>
```

状态机：

- Planned → Contract Done：里程碑下契约（spec / 接口 / schema）全冻结
- Contract Done → Demo Ready：核心 work item 全 Done，可演示
- Demo Ready → Production Ready：客户接入 + 稳定运行 + 监控 / 告警 / 回滚

翻档需 work item Done + architecture review 通过；**模块边界闭合不构成翻档证据**。

## state/customer-visible.md

每条工单 Done 追加一段：

```
## YYYY-MM-DD · <work-id> Done

- **客户/产品可感知变化**：……（无则写"无"，禁止省略 bullet）
- **Internal-only 变化**：……
```

校验：

- 段头日期合法 ISO
- 段内 bullet ≥2 条（缺一即 fail）
- 引用的 work-id 必须在 queue.md 中 Status=Done（cross-file 一致性）

物理顺序不强制（追加在末尾即可）；渲染端按 (date desc, work-id desc) 排序。

## Cross-file 不变量（validate-state 强制）

1. `active.md` 持有的 ID 必在 `queue.md` 且其 Status ∈ {In Progress, Blocked}
2. `active.md` 为 Idle ⇒ `queue.md` 无 In Progress 行
3. `customer-visible.md` 引用的 work-id 必在 `queue.md` Status=Done
4. `queue.md` Planned 集合 ⇔ §Planned 摘要段 ID 集合
5. impl commit 不含 state/* / BOARD.html；handoff commit 仅含 state/* + BOARD.html

## 工具脚本一览（`<devRoot>/workflow/scripts/`）

| 脚本 | 用途 | 退出码 |
|---|---|---|
| `validate-state.mjs` | state/* schema + cross-file 校验 | 0=OK / 1=error |
| `render-board.mjs` | 生成 BOARD.html | 0=OK / 1=fail |
| `promote.mjs <id>` | Planned → Ready，生成 spec/plan/context-pack | 0=OK / 1=fail / 2=usage error |
| `verify-handoff.mjs <id>` | 6 项 handoff 完整性检查 | 0=OK / 1=fail / 2=usage error |
| `render-dependencies.mjs` | 依赖图（mermaid / 文本 / json） | 0=OK / 1=有依赖问题 |
| `lint-redlines.mjs` | 红线 lint 兜底 | 0=OK / 1=命中 |
| `init.mjs --prefix X` | 在新项目初始化整套工作流 | 0=OK / 1=冲突 / 2=usage |

config 加载顺序：`process.env.WORKFLOW_CONFIG` → 调用方指定 → `<devRoot>/workflow.config.mjs` → `defaults`（见 `config.mjs`）。
