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

翻档需 work item Done + architecture review 通过；若配置了 `e2e`，`Contract Done → Demo Ready` 还需要该里程碑 E2E PASS 作为前置证据。**模块边界闭合不构成翻档证据**。

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

## state/acceptance.md（可选 E2E 线启用时必填）

仅当 `workflow.config.mjs` 配置 `e2e` 块时由 `validate-state` 校验存在性；缺省 `e2e` 的项目不因缺失报错。

职责边界：

- `acceptance.md` = 事前验收基准：每个里程碑要验证哪些客户旅程，以及用什么业务标准判 PASS/FAIL
- `customer-visible.md` = 事后交付事实：每个 Done 工单实际交付了什么

最小结构：

```markdown
## M1 · <里程碑名>

### 旅程 J1：<客户从 X 进入，完成 Y>
- 验收标准：<可观测的成功判据，业务语言>
```

校验：

- 当 `config.e2e` 存在且 `config.milestones` 非空时，每个里程碑都必须有 `## <milestone> ·` 段
- 脚本只校验存在性；旅程质量由 `roadmap-planner` 和 `e2e-verifier` 负责

## state/ui-anchor.md（可选）

仅当 `workflow.config.mjs` 配置 `ui` 块时存在。它是 UI 设计线的项目级事实源，记录设计语言、共享外壳、导航/组件约定和少量原型屏。缺省 `ui` 块的项目不需要此文件，`validate-state` 不因缺失报错。

`ui.anchorPath` 不存在时，`ui-designer(mode:anchor)` 先读配置的 `ui.designRefs`；若未配置、为空或不可读，则主动从项目文档、style/theme/token/component 目录和现有 UI 页面发现设计线索；仍找不到可核验事实源时，允许用 `ui.designSkill`（推荐 `ui-ux-pro-max`）合成最小可执行设计系统，并在 receipt 里标记 `design_ref_source="synthesized"` 与 `synthesis_evidence`。

约束：

- 由 `ui-designer(mode:anchor)` 生成，`design-reviewer` 审过后才作为后续 UI delta 的依据。
- 不写具体未 promote 功能的内部行为；具体屏幕 delta 落在 `work/<slugDir>/ui/`。
- 刷新只在用户显式要求或 delta review 标记锚点漂移时进行，不自动重写。

## Cross-file 不变量（validate-state 强制）

1. `active.md` 持有的 ID 必在 `queue.md` 且其 Status ∈ {In Progress, Blocked}
2. `active.md` 为 Idle ⇒ `queue.md` 无 In Progress 行
3. `customer-visible.md` 引用的 work-id 必在 `queue.md` Status=Done
4. `queue.md` Planned 集合 ⇔ §Planned 摘要段 ID 集合
5. impl commit 不含 state/* / BOARD.html；handoff commit 仅含 state/* + BOARD.html
6. **D4（v5.4 O13）**：`queue.md` Status=Done 的工单，`work/<slug>/<receiptsDir>/` 必有其 level 对应的全套 stage receipt（L0:5-handoff；L1:2a/3/5；L2/L3:全套）。**祖父豁免**：ID 在 `state/receipt-grandfather.json.ids[]` 内则跳过（升级前已 Done 的存量工单不被追溯）
7. **D5（v5.4 O7）**：`work/` 下目录名无法被任一工单 `workItemSlug()` 命中 → warn。能按 workId 前缀模糊匹配但 slug 不一致 → 提示 `git mv`（底盘 slugify 升级遗留）；完全匹配不到 → 孤儿目录 warn

## v5.4 新增 state 文件

| 文件 | 写者 | 用途 |
|---|---|---|
| `state/receipt-grandfather.json` | `init.mjs --upgrade` 首次回填 / 人工 | `{ ids: [] }`——D4 祖父豁免清单，升级时枚举当时 Done 工单，使新规则不追溯存量 |
| `state/flaky-baseline.json` | `regression:diff --add` / 人工 | `{ suites: [{name, reason, recorded_at}] }`——已知预存 flake 清单，收敛回归只看相对基线新增失败 |
| `<devRoot>/.b2r-version` | `init.mjs --upgrade` | 底盘版本漂移标记，启动协议自检比对 bundle `VERSION` |

## 工具脚本一览（`<devRoot>/workflow/scripts/`）

| 脚本 | 用途 | 退出码 |
|---|---|---|
| `validate-state.mjs` | state/* schema + cross-file 校验 | 0=OK / 1=error |
| `render-board.mjs` | 生成 BOARD.html | 0=OK / 1=fail |
| `promote.mjs <id>` | Planned → Ready，生成 spec/plan/context-pack | 0=OK / 1=fail / 2=usage error |
| `verify-handoff.mjs <id>` | 6 项 handoff 完整性检查 | 0=OK / 1=fail / 2=usage error |
| `milestone-status.mjs <milestone>` | 判断里程碑是否到达 E2E 验收边界 | 0=OK；`--quiet` 下 true=0 / false=1 |
| `render-dependencies.mjs` | 依赖图（mermaid / 文本 / json） | 0=OK / 1=有依赖问题 |
| `lint-redlines.mjs` | 红线 lint 兜底 | 0=OK / 1=命中 |
| `init.mjs --prefix X` | 在新项目初始化整套工作流 | 0=OK / 1=冲突 / 2=usage |

config 加载顺序：`process.env.WORKFLOW_CONFIG` → 调用方指定 → `<devRoot>/workflow.config.mjs` → `defaults`（见 `config.mjs`）。
