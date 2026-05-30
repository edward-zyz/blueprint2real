---
name: blueprint2real
description: Multi-agent 工作流编排器。把路线图 / roadmap / 设计文档变成一条真正 Done 的工单流水线——通过 sub-agent 分别承担 spec drafter / planner / TDD implementor / reviewer / committer 等角色，由内建质检节点（validate-state / failing-test / regression / verify-handoff）把关每一步，保证产出可回滚、可审计。当用户说「开始 IS-XXX」「promote IS-XXX」「handoff IS-XXX」「跑工单流水线」「从 roadmap 拆工单」「让 agent 团跑完这条线」或在含 b2r-process/state/、b2r-process/workflow.config.mjs（或 legacy 路径 dev/state/、dev/workflow.config.mjs）的仓库里要求"按工单走一遍"时，必须用此 skill，即使用户没有显式说 "blueprint2real"。
---

# blueprint2real · 路线图变 Done 工单的多 Agent 编排器

## 这个 skill 在解决什么

很多项目都有"想法很多，落地很慢"的问题——roadmap 写了一堆，spec 起草要拖好几天，开发又跟 spec 漂移，QA 永远在追赶，最后大家不知道这周到底交付了什么。

`b2r-process/workflow/` 提供了**事实源 + 渲染 + 状态机 + 质检脚本**这套底盘（旧项目仍可能用 `dev/`），但谁来按这套底盘把工作真的跑完？这个 skill 就是那个**调度者**：它把人类的 roadmap / blueprint 输入接进来，按 RUNBOOK §3 固定执行链路调度一批专门的 sub-agent，每一步用脚本兜底，最后给你一个状态翻档完整、commit 切片干净、`verify-handoff` 通过的 Done 工单。

## 不变量（违反就停下）

这些是从 RUNBOOK 沉淀下来的硬约束。任何 sub-agent 在任何阶段命中其中一条，必须**当场停下并向用户报告**，不允许"先记下，等下一轮再处理"：

1. **exactly one active item**：`state/active.md` 同时只能持有一条 In Progress / Blocked。新工单启动前 active 必须 Idle。
2. **事实源单一**：`state/*.md` 是唯一权威；`BOARD.html` 只能由 `npm run render:board` 生成。冲突时以 state/* 为准，先停下修正状态。
3. **TDD 强制顺序**：failing test 必须先出现并跑红，才能写最小实现。"先写实现再补测试"是退化模式，禁止。
4. **commit 物理分离**：implementation commit 不含 `state/*` / `BOARD.html`；handoff commit 唯一，且仅含 `state/*` + `BOARD.html`，位于所有 impl commit 之后。
5. **前置 Done 后才能 promote**：Planned → Ready 的前提是依赖工单全部 Done，否则 spec/plan 基于"规划想象"，必失真。
6. **架构红线触发即停**：`workflow/scripts/lint-redlines.mjs::RULES` 数组中任一规则命中，当前轮不带病往下走。
7. **sub-agent 自报阻塞必须带证据**：sub-agent 在 prompt 中被允许"自报搞不动了"短路直进 Manager Override，但 return payload 必须含非空 `blocked_evidence`（具体 grep / 测试输出 / 引用条款）。空证据的自报视为偷懒早退，主线打回原 stage 重试。
8. **pipeline-status.json 主线单写者**：`b2r-process/work/<id>/receipts/pipeline-status.json` 仅由主线 thread 写入；sub-agent 把状态更新通过 return payload 上报，主线落盘。避免 sub-agent 与主线并发写文件。
9. **skill 不直接 Write 底盘脚本**：主线 / 任何 sub-agent 都**不**得直接 Write 或 Edit `workflow/scripts/`、`workflow/templates/`、`workflow/package.json`、`<target>/package.json` 等底盘文件。底盘只能通过 `init.mjs --bootstrap` 一次性 bootstrap，源是本 skill 的 `bootstrap/workflow/` 自带资产。看到底盘缺失时**停下**报告 + 引导用户跑 bootstrap 命令，不允许"贴心创造"。理由：底盘是 skill 的共享物理实现，从单一权威源分发；让 LLM 每次贴心重造会导致版本漂移、与 skill 期望的契约脱节。
10. **交付失败 ≠ 质量失败**：sub-agent **返回了**但产物不可用（529/overloaded 错误串、空、截断、末条非合法 receipt JSON）时，主线按「receipt 兜底协议」**自动恢复**——fresh 重派 1 次 → 仍不可用则主线内联接手 → 主线也做不动才进 Manager Override；这整条**不计入 gate attempt**，也**不**在前两步惊动用户。边界：**进程级真 hang**（主线同步阻塞、无从检测）不在本条范围，依赖 harness 的 Agent 超时回收。与不变量 7 区分——那是 sub-agent 主动报 `blocked:true`+证据（质量/能力分歧 → 直进 Manager）；本条是 sub-agent 根本没给出可用 receipt（交付层 → 先自愈）。

为什么这些必须硬阻断：每一条都对应过历史踩过的坑。`exactly-one` 治"假装在做多个"的 LLM 幻觉；`物理分离` 让任一切片可独立 revert；`前置 Done 后 promote` 防止把"想象的接口"当成真接口去 spec。略过任一条，会让本工作流退化成普通的"看心情写代码"。

## 启动协议

skill 被调用时，第一件事永远是**定位工作目录与读 workflow.config**。默认目录名 `b2r-process/`（v5.1 起），旧项目可能仍叫 `dev/`，两者都支持：

```
按以下顺序查 workflow.config.mjs（先 b2r-process/，再 dev/ 作 fallback）：
  1. <cwd>/b2r-process/workflow.config.mjs           ← 默认（新项目）
  2. <cwd>/dev/workflow.config.mjs                   ← legacy 兼容
  3. <cwd>/workflow.config.mjs                       （cwd 就是工作目录自身）
  4. <cwd>/../b2r-process/workflow.config.mjs
  5. <cwd>/../dev/workflow.config.mjs
找到第一份即为锚点。后续 prompt 中所有 {{devRoot}} 占位填入这个实际目录。
```

**都找不到 → 这是新项目首次使用 skill**：

按不变量 9，**禁止主线 / sub-agent 直接 Write 任何底盘文件**。正确动作是：

1. 向用户报告"未找到 b2r-process/workflow.config.mjs（也未找到 legacy 路径 dev/），这是新项目首次使用 blueprint2real"
2. 引导用户跑 bootstrap 命令（主线**亲自**跑，不派 sub-agent）：
   ```
   node <SKILL_ROOT>/bootstrap/workflow/scripts/init.mjs \
     --bootstrap \
     --prefix <项目工单前缀，2-4 大写字母如 IS/FOO/WORK> \
     --milestones <逗号分隔，如 M0,M1,M2；不用里程碑则 ''> \
     --project <项目名小写> \
     --target ./b2r-process
   ```
3. `init.mjs --bootstrap` 一次性生成 33 个文件：完整 `workflow/` 子树 + `workflow.config.mjs` + `AGENT_RUNBOOK.md` + `state/*.md` + `package.json`（含 npm script 别名）
4. 跑完后引导用户 `cd ./b2r-process/workflow && npm install`，然后 `npm run validate:state` 验证
5. 验证 OK 后才返回主流程，按"找到工作目录"路径继续

**重要**：不要让 sub-agent 自己 `Write` `workflow/scripts/*.mjs` 或类似底盘文件——那是退化模式，每次贴心重造导致版本漂移。bootstrap 命令是唯一权威分发途径。

读到 config 后，提取以下字段作为后续所有 sub-agent 的上下文（外加为每条工单按 `workItemSlug({ workId, title })` 算出的 `slugDir`，用于派工时填 prompt 中 `{{slugDir}}` 占位）：

- `workIdPrefix` + `workIdDigits` — 编号格式（如 `IS-\d{3}`）
- `milestones` — 里程碑数组
- `projectName` / `boardTitle` — 品牌
- `docsRefs` — 项目上游文档路径（spec 必须从这些位置引用具体章节）
- `regressionCommands` — regression 阶段必须跑的命令
- `pipeline.maxRetry`（默认 `1`） — Gate fail 后 retry 上限
- `pipeline.retroSurfaceThreshold`（默认 `3`） — 累计 N 条 retro override 主动 surface 给用户
- `pipeline.receiptsDir`（默认 `receipts`） — `work/<slugDir>/` 下 receipt 子目录名
- `pipeline.specsDir`（默认 `specs`） — 工单 spec.md 沉淀位置（路径：`<devRoot>/<specsDir>/<slugDir>.md`）

**不要把 config 里的值硬编码到 prompt 里**——work-id 前缀、里程碑名、项目名、文档路径都来自 `workflow.config.mjs`，每次派 sub-agent 时按当前 config 派生填充占位。Skill 描述里保留具体示例（如 `IS-XXX`）只是为了帮助用户在自然语言中触发；执行时一律读 config。

## 4 档复杂度路由（Stage 0 Triage 内嵌）

每条工单在 Stage 0 由 `roadmap-planner` 打标 `level`，决定后续走"完整 / 中等 / 简化 / 单 stage"哪条路径。打标依据写入 `0-triage.json` receipt，**不允许后期降档**（只能升档）：

| Level | 判据（满足任一） | 路径 | 跳过 |
|---|---|---|---|
| **L0** TRIVIAL | typo / 注释 / 文档措辞 / 单行格式化 | `direct-fix` 单 agent: edit + state-flip + commit | 跳过 spec/plan/review/arch |
| **L1** SIMPLE | 单文件 + 无新接口 + 无 schema + ≤30 行改动 | Stage 1 → 2-merged (spec+plan+self-review) → 3 → 5 | 省独立 reviewer + arch-reviewer 阶段 |
| **L2** STANDARD | 跨 2-3 文件 + 有新函数 + 无跨模块边界变化 | Stage 1 → 2a → 2b → 2c → 3 → 4-light → 5 | reviewer 走轻量清单，不调 skill |
| **L3** COMPLEX | 跨模块 / 新 schema / 新依赖 / 含安全敏感 / 含 migration | Stage 1 → 2a → 2b → 2c → 3 → 4 → 5（完整 7 stage） | — |

Stage 0 之外的所有 stage 在派 sub-agent 前都要读 `0-triage.json.level` 决定走哪条路径。Level 一致性由 Gate 校验（实际改动文件数 / 是否含 schema 变更等指标 vs 初判 level，超出则升档）。

## 6 阶段编排

```
[roadmap input]
   │
   │  pre-flight：读 state/active.md + queue.md + roadmap.md
   ▼
┌─ Stage 0 · Triage（内嵌于 Stage 1 roadmap-planner）────────┐
│  目标：每条工单打 L0-L3 level 标签                          │
│  执行者：roadmap-planner 中段                               │
│  产物：b2r-process/work/<id>/receipts/0-triage.json        │
│  门槛：level 字段存在 + 判据原文非空                        │
└────────────────────────────────────────────────────────────┘
   │
   ▼
┌─ Stage 1 · Roadmap → Backlog ───────────────────────────────┐
│  目标：把 roadmap 拆成 Planned 工单序列（含依赖关系）          │
│  执行者：roadmap-planner sub-agent                            │
│  产物：queue.md 表 + §Planned 摘要段 + receipt-1.json         │
│  门槛：npm run validate:state · 0 error                       │
└────────────────────────────────────────────────────────────┘
   │
   │  L0 工单：直接派 direct-fix（跳到 Stage 5）
   │  L1/L2/L3：循环每一条工单
   ▼
┌─ Stage 2 · Promote ─────────────────────────────────────────┐
│  目标：把 1 条 Planned 翻 Ready，生成 spec / plan / context-pack │
│  执行者：promote.mjs（脚本）→ spec-drafter / plan-drafter      │
│            L1：spec + plan 合并 + self-review 内嵌            │
│            L2/L3：独立 2a / 2b / 2c 三步                      │
│  产物：b2r-process/work/<id>/{spec,plan,context-pack}.md + receipt-2*.json │
│  门槛：spec/plan reviewer 通过 + npm run validate:state OK    │
└────────────────────────────────────────────────────────────┘

> **「plan 已存在」捷径（合法化主线裁量）**：当用户输入或 `docsRefs` 已含逐 step 实施计划（如现成的 `*_计划_*.md`）时，spec-drafter / plan-drafter **可降级或跳过**——主线直接把现成 plan 映射落盘为 `work/<id>/{spec,plan}.md`（省 fresh-context drafting 的 token；历史 retro 显示可显著减少重复起草）。
> **但 `spec-plan-reviewer` 在 L2/L3 不可省**——它是独立质检 gate（reviewer 不见 drafter 内部推理），主线自写 spec/plan 时**更**需要这道独立眼睛兜范围裁剪 / spec §3 不做项 / §4 文件清单。捷径只省"起草"，不省"独立 review"。L1 的 reviewer 仍内嵌于 plan-drafter，照旧。

> **单切片合并 2a+2b（提速旁路）**：当 triage / spec scope 可预判 **sub-slice 数为 1** 且未走上面"plan 已存在"捷径时，主线可把 2a-spec 与 2b-plan **合并为一次 drafter 调用**——派 `spec-drafter` 时在上下文标注 `merge_2b: true`，让它在产出 spec.md 后**同 context 续写 plan.md**（按 plan-drafter §1-§7 约束），一次返回两份 receipt（`2a-spec.json` + `2b-plan.json`）。省一次 dispatch 往返。**`spec-plan-reviewer` 照常跑、不可省**（L2/L3 铁律不变）。多切片或拿不准切片数 → 不合并，老路 2a→2b 分派。

   │
   ▼
┌─ Stage 3 · Implement ───────────────────────────────────────┐
│  目标：active 翻 In Progress，TDD 红 → 绿                     │
│  执行者：implementor sub-agent（先写 failing test，再 minimal）│
│  产物：receipt-3.json                                          │
│  门槛：targeted 测试通过 + regressionCommands 全过            │
└────────────────────────────────────────────────────────────┘
   │
   ▼
┌─ Stage 4 · Review ──────────────────────────────────────────┐
│  目标：架构 + 安全 review，命中红线即停                       │
│  执行者：L3 → arch-security-reviewer / L2 → 轻量内嵌 / L1 → 跳过 │
│  产物：receipt-4.json                                          │
│  门槛：npm run lint:redlines · 0 命中                         │
└────────────────────────────────────────────────────────────┘
   │
   ▼
┌─ Stage 5 · Commit & Handoff ────────────────────────────────┐
│  目标：impl commit + 状态翻档 + handoff commit                │
│  执行者：handoff-committer sub-agent（L0 路径直接到此）       │
│  产物：receipt-5.json                                          │
│  门槛：npm run verify:handoff <id> · 全过                     │
└────────────────────────────────────────────────────────────┘
   │
   │  active 翻回 Idle → 回 Stage 2 拿下一条 Ready
   ▼
```

## 失败处理：交付失败兜底 → 质量失败 retry-once → Manager Override

先区分**两类失败**（不变量 10）：

- **交付失败（returned-but-unusable）**：sub-agent 返回了，但末条不是合法 receipt JSON（散文 / 报错串 / 空 / 截断）。这是基础设施层问题，**不该惊动用户**，自动恢复。
- **质量失败（gate fail）**：receipt 合法，但没过 gate（verdict=NEEDS_FIX / 脚本非 0 / 范围越界）。质量分歧**该让人拍板**，走下面的 retry-once → Manager Override。

### L0 交付失败兜底（自动，先于 gate 判定）

每次拿到 `Agent` 返回，主线**先判产物是否可用**，再进 gate：

1. 解析末条消息：能解析成本 stage 的 receipt envelope（`stage_id`/`level`/`attempt` 字段齐）→ **可用**，进既有 gate 判定（下面 L1/L2）。
2. 否则 = 交付失败，**不惊动用户**：
   - **第 1 步**：fresh 重派同一 stage 一次（prompt 末尾附"上次未返回合法 receipt，请确保最后一条消息是 receipt JSON"）。**不计入 gate attempt**（与 `maxRetry` 两套独立计数）。
   - **第 2 步**：仍不可用 → 主线**内联接手**该 stage（自己跑该 stage 的脚本/编辑/审查，落 receipt，标 `dispatch_recovery`，**不复用 `manager_override` 字段**——后者语义是"经人介入流程"，内联接手没有人，复用会污染 retro/BOARD 审计统计）。内联代跑 implementor 时**照样受不变量 3（TDD 红→绿）/ 4（commit 物理分离）约束**，红 gate 证据照常落 `3-impl.json`，不因主线接手而豁免。
   - **第 3 步**：主线内联也做不动（真·能力边界）→ 才进 Manager Override（人）。
3. **边界**：进程级真 hang（主线同步阻塞、无 watchdog）本协议**测不了**，依赖 harness 超时回收——不要在文档/prompt 里假装能"检测超时"。

> 区别于"质量失败"：交付失败是"没拿到可用产出"，自愈；质量失败是"产出不达标"，升级到人。

### L1 Auto-Retry（自动 × 1）

`pipeline.maxRetry`（默认 **1**）次自动重试：

1. 主线把 fail items + reviewer expectation 打包到 `pipeline-status.last_feedback` 字段（**不**再单独写 feedback-receipt.json，并入 pipeline-status 的内嵌 schema）
2. 派 **fresh sub-agent** 到上游 stage，prompt 中明示"上一轮哪些条不通过 + 期望"+ 引用 `previous_receipt`
3. Sub-agent 看 feedback + 自己上轮 receipt，针对性修正而非重写
4. 新一轮 receipt 再过 Gate

### L2 Manager Override（人介入）

触发条件**任一即可**：
- retry 1 次后仍 fail（`attempt > maxRetry + 1`，默认 attempt > 2 即升级）
- sub-agent 自报阻塞（return payload 带 `blocked: true` + 非空 `blocked_evidence`）
- Gate 8 (handoff verify) fail

主线**自动**做：
1. 即时渲染卷宗视图 escalation-pack（**不**持久化为 .md，仅渲染给用户和写入 manager-decision 引用）：历次 receipt diff + 历次 feedback + sub-agent self-report
2. **起草决策建议**：基于卷宗匹配 5 选 1
3. 用 `AskUserQuestion` 呈现「我建议：&lt;option&gt; · 理由 · 影响」+ 4 个可选行动
4. 用户拍板后写 `b2r-process/work/<id>/receipts/manager-decision-<timestamp>.json`
5. 追加 `b2r-process/state/retro.md` 一段（失败链 + 决策 + 1 行经验）
6. 按 action 字段调度（5 选 1，详见 `references/quality-gates.md`）

### Manager 5 个 action 与回流点

| action | 回流点 | 备注 |
|---|---|---|
| `accept-override` | 下一 stage | 后续 receipt 全部带 `manager_override` 标记 |
| `downgrade` | **Gate 4**（重判 level branch） | 改 0-triage.json.level；不直跳 S3 |
| `shrink-scope` | S2a（spec retry，必加 §3 不做项） | 卡住部分自动建新 Planned 工单 |
| `split-slice` | **S2b**（plan retry，声明 sub-slice） | 与"派 plan-drafter"一致 |
| `drop` | Done（queue 翻 Superseded） | active 翻 Idle |

**Gate 8 (handoff) fail 后 Manager 仅允许 `accept-override` 或 `drop`**——downgrade / shrink-scope / split-slice 在 handoff 阶段语义不成立。

### attempt 语义统一

- `attempt` 从 **1** 起算（1 = 首次尝试，2 = 已重试 1 次，3 = 第 2 次重试）
- 升级触发：`attempt > pipeline.maxRetry + 1`（默认 maxRetry=1 时，attempt > 2 才升）
- `pipeline-status.current_attempt` 用同一语义（**不**用 retry_count = attempt-1 的语义，避免混淆）
- attempt 计数 **stage 级独立**：spec retry 不消耗 impl 的 attempt 余额

## Receipt 契约

每个 stage sub-agent 完成后**必须**返回 receipt JSON，主线落盘到 `<devRoot>/work/<slugDir>/<receiptsDir>/<stage_id>.json`（`<slugDir> = <workId>_<slugified-title>`，例如 `ABC-001_RUNBOOK-加-Manager-Override-接手段`；`<devRoot>` 是启动协议找到的工作目录，默认 `b2r-process/`；spec.md 单独沉淀到 `<devRoot>/<specsDir>/<slugDir>.md`，默认 `specs/`）。详细 schema 见 `references/receipts-schema.md`。所有 receipt 通用 envelope：

```json
{
  "stage_id": "2a-spec",
  "level": "L3",
  "attempt": 1,
  "completed_at": "2026-05-16T14:23:00+08:00",
  "manager_override": null,
  "...stage-specific payload..."
}
```

下个 stage 派 sub-agent 时，主线把上一份 receipt 路径作为 prompt 字段传入。**receipt / plan / context-pack 落到 `<devRoot>/work/<slugDir>/`；spec 落到 `<devRoot>/<specsDir>/<slugDir>.md`**。

## Retro 复盘机制

每次 Manager Override 落定后主线自动追加 `<devRoot>/state/retro.md` 一段：

```markdown
## YYYY-MM-DD · <workId> · <stage> override
- 失败链: <gate fail 历次 + sub-agent 自报阻塞文本>
- Manager 决策: <action>
- 1 行经验: <将来如何避免>
- template_patch: <若经验指向某 agent 模板该改，列 agents/xxx.md[, ...]；否则 none>
```

`template_patch` 字段是**回灌债的显式登记**——经验若指向某个 `agents/*.md`（如"某 prompt 的返回段该补硬约束"），就列出该文件；纯流程经验不指向模板则填 `none`。

**Surface 触发**：每里程碑结束 **或** 累计 ≥ `pipeline.retroSurfaceThreshold`（默认 3）条新条目，下一次 Stage 1 派工前主线主动展示 retro.md 给用户做体系反思——**并把所有 `template_patch != none` 的条目汇总成「待回灌清单」**呈现，提示哪些经验还没回灌进模板（实际改模板仍是人监督下的 `/skill-review` 动作，本机制只保证债务可见、不自动改模板）。

> 注（诚实边界）：本字段 + 待回灌清单**只服务有人值守的定期复盘**；无人值守模式下没人看清单，故它不属于"无人值守能力"，只是回灌债的追踪辅助。

## 何时派 sub-agent vs 何时自己做

派 sub-agent 的判断标准：

| 派 sub-agent | 自己做 |
|---|---|
| 阶段切换需要 fresh context（spec drafting / TDD implementation） | 用户对话、状态确认、解释 |
| 角色独立判断比串行思考更可靠（reviewer 不应见 drafter 的内部推理） | 跑脚本（`npm run promote/validate/render`） |
| 任务跨多文件 + 多步骤 + 需要工具组合（implementor 写代码 + 测试） | 读 state/active.md / queue.md 决定下一步 |
| Sub-slice 之间独立验证 | 起草 Manager Override 决策建议 + 落盘 retro |

派出 sub-agent 时使用 `Agent` 工具，按 `agents/<role>.md` 中的模板装填上下文。每份 prompt 模板都明确：sub-agent 只读自己需要的文件（spec / plan / context-pack），不读整个仓库；完成职责即返回 receipt JSON，不与主线对话。

## 质检节点（脚本驱动，不靠汇报）

每个 sub-agent 完成后，主线必须**亲自跑这些脚本**确认通过，再进下一阶段。Sub-agent 自报"通过"不算数——`agents/` 下的 prompt 都明确要求让脚本说话：

| 阶段 | 质检命令 | 通过判据 |
|---|---|---|
| Stage 0 Triage | （主线读 receipt） | level ∈ {L0,L1,L2,L3}，判据非空 |
| Stage 1 Backlog 落地 | `cd {{devRoot}} && npm run validate:state` | 0 error（warn 允许） |
| Stage 2 Promote 后 | `cd {{devRoot}} && npm run validate:state` + `cd {{devRoot}} && npm run deps:graph` | 0 error，依赖图无环、无孤儿 |
| Stage 3 红 gate | 主线核 `3-impl.json`：`failing_test_first=="pass"` + Step 1 红色输出证据非空 | 证据缺失/为空 = 红 gate 未过，打回 implementor（整包派工模式下红→绿在 implementor 内部，主线核 receipt 自证，不亲跑） |
| Stage 3 Impl 后 targeted（**每切片**） | spec §7 中本工单特有命令 + 本切片 plan §1 Step1 test | 0 error / 测试绿 |
| Stage 3 收敛 Regression（**末切片后跑一次**，主线亲跑） | config.regressionCommands 每一条 | 全部退出码 0；红了**按切片二分定位**（每切片留 targeted + 增量集成 checkpoint），不裸跑全量面对红海 |
| Stage 4 Review | `cd {{devRoot}} && npm run lint:redlines` | 0 命中 |
| Stage 5 Handoff | `cd {{devRoot}} && npm run verify:handoff <id>` | 全过（L3: 7 项 / L0: 跳过 spec/plan 相关 check） |
| 任意 Gate fail 后 retry | 重新跑同一脚本 | retry attempt 仍 fail → Manager Override |

任何质检失败 → 进 retry-once → 仍 fail 进 Manager Override（不再"打回用户决定"——主线起草决策，用户拍板）。

## 调用 sub-agent 的 prompt 模板位置

| 角色 | 模板文件 | 何时派 |
|---|---|---|
| roadmap-planner | `agents/roadmap-planner.md` | Stage 1，每个 skill 调用最多 1 次（除非用户后续追加 roadmap） |
| direct-fix | `agents/direct-fix.md` | L0 路径，工单单 stage 跑完 |
| spec-drafter | `agents/spec-drafter.md` | Stage 2，L1+ 每个工单 1 次 |
| plan-drafter | `agents/plan-drafter.md` | Stage 2，L1+ 每个工单 1 次 |
| spec-plan-reviewer | `agents/spec-plan-reviewer.md` | Stage 2 末，L2/L3 每个工单 1 次（L1 内嵌于 plan-drafter） |
| implementor | `agents/implementor.md` | Stage 3，每个 sub-slice 1 次 |
| arch-security-reviewer | `agents/arch-security-reviewer.md` | Stage 4，L3 每个工单 1 次（L2 轻量内嵌；L1 跳过） |
| handoff-committer | `agents/handoff-committer.md` | Stage 5，每个工单 1 次 |

读取这些模板时**替换 `{{...}}` 占位**为本工单的具体值（workId、level、config 字段、依赖列表等），然后作为 `Agent` 的 prompt 参数。

## 参考文档

- `references/workflow-contract.md` — `state/*.md` schema 摘要 + 校验脚本契约
- `references/quality-gates.md` — 每个阶段的脚本驱动质检节点完整清单 + Manager Override 5 个 action 详解
- `references/receipts-schema.md` — receipt envelope + 每个 stage 的 receipt 字段 + pipeline-status.json schema
- `references/pipeline-flow.md` — v5.1 简化主流程图源（mermaid）
- `bootstrap/` — 新项目 bootstrap 资产（`workflow/` 子树 + `dev-package.json.tmpl`）+ README 说明何时使用

## 不要做的事

- **不要绕过质检脚本**——脚本是不变量的物理实现，绕过=不变量失效。
- **不要让 sub-agent 自己起 sub-agent**——单层调度避免责任链断裂。
- **不要在 sub-agent 完成后直接信任其结论**——总是用脚本验证。
- **不要批量 promote 多条 Planned**——前置 Done 后才能 promote 这条铁律。
- **不要修改 BOARD.html**——它是渲染产物，手改会被下次 `render:board` 覆盖。
- **不要在 SKILL 触发后立即操作代码**——先确认 `state/active.md` 的当前状态、用户的明确意图（哪条工单、是 promote 还是 handoff），再行动。
- **不要让 retry 静默循环**——retry 失败必进 Manager Override，让用户看到失败链；不要让 sub-agent "再试一次又一次"假装搞定。
- **不要在 Manager Override 时手编 manager-decision.json**——主线起草建议 + 用户 `AskUserQuestion` 确认 + 主线落盘，避免 schema 错填。
- **不要在新项目首次启动时"贴心生成"底盘脚本**——按不变量 9，新项目首次启动只能跑 `init.mjs --bootstrap` 命令（源是 skill 自带的 `bootstrap/workflow/`）。`Write` 任何 `workflow/scripts/*.mjs` 内容都是错误行为。
