# blueprint2real · 蓝图级 E2E 验收阶段设计

- 状态：设计已与用户确认 + 经 sub-agent 评审修订，待二次评审
- 范围：仅蓝图级 E2E 验收能力。UI 设计（#1）见 `2026-06-02-ui-design-stage.md`；多机并行编号（#3）为后续独立 spec。本文消费 #1 的 UI 锚点/mockup，与 #3 无耦合。

## 1. 问题

blueprint2real 现有验证模型全在**工单级**：Stage 3 的 failing test → 最小实现 → targeted → 末切片收敛 regression。工单级 `verify` 只看自己那一刀，**看不到一系列需求整合后端到端串起来的问题**。

后果：一个产品蓝图的系列工单各自 Done 了，但整体跑下来才暴露的集成 bug 无人兜（今天的 `insight-cli-e2e-buglist.md` 即此类现场——手动跑 E2E 才抓出一堆问题）。pipeline 缺一层"完工后验整体"的蓝图级验收。

## 2. 目标与非目标

### 目标
1. 在 per-ticket 6 阶段循环**之外**，增加一个**里程碑/蓝图级 E2E 验收阶段**，验整合后的整体。
2. 验证基准（客户旅程 + 验收标准）是**粗粒度、与开发同源、可审、稳定**的蓝图级产物，而非每次临场猜。
3. agent 真跑验证（启动整合应用、驱动真实旅程、取证）+ 把稳定旅程固化成回归测试。
4. 产出**人类可读验收报告**：讲清测了哪些旅程、结果如何。
5. 配置驱动、可被无可跑应用的项目（纯库）完全跳过；保持无人值守。
6. FAIL 闭环：集成 bug → 生成修复工单回流 → 重跑 → 整体 PASS 才推进里程碑翻档。

### 非目标
- 不做工单级 E2E（工单级已有 `verify` / targeted / regression）。
- 不实现 UI 设计（#1）与编号（#3）。
- 不在 skill 内置具体 E2E 框架/驱动知识（委派 `verifySkill`）。
- 不要求细碎测试步骤——旅程粗粒度，verifier 在运行时展开。

## 3. 决策记录（用户已确认；★ = 经评审修订）

| 决策点 | 结论 | 理由 |
|---|---|---|
| E2E 形态 | Agent 真跑验证 + 把稳定场景固化成回归测试 | 探索抓意料外 bug + 回归长期兜底，双收 |
| 层级 | **蓝图/里程碑级**，非工单级 | 工单级已有 verify；集成 bug 只在整体串联时暴露 |
| 验证单元/触发 | `config.milestones` 里程碑边界自动 + 可手动触发 | 复用已有里程碑机制 |
| 旅程来源 | **专用 `state/acceptance.md`，Stage 1 确立**（蓝图自带则提取，否则粗推），E2E 消费 | 验收基准稳定、可审、与开发同源 |
| 旅程粒度 | 粗粒度：清晰客户旅程 + 验收标准，不陷细碎步骤 | verifier 运行时展开为真实驱动流 |
| gate 语义 | 两段式：探索 verdict（软）+ 固化回归测试（硬） | 耐久产物是脚本可跑的测试，贴 skill"让脚本说话"哲学 |
| ★ 固化稳定性 | **跑一次绿即固化**（flaky 风险显式记入 §8，不连跑 N 次） | 用户取舍：省 token/时间，接受弱保证 + 后续回归暴露 |
| 收口 | 默认自动（PASS 不打扰）；FAIL 升 Manager Override | 与 #1 收口对称，保无人值守 |
| ★ FAIL 闭环 | 修复工单**带溯源字段去重** + `e2e.maxRerun` 重跑上限逃生阀 | 评审指出原闭环会重复发单 / 无上限静默打转，违反"不让 retry 静默循环" |
| ★ 里程碑翻档 | E2E PASS = `Contract Done → Demo Ready` 翻档**前置证据之一** | 评审指出底盘无"里程碑=Done"态；真实四态为 `Planned\|Contract Done\|Demo Ready\|Production Ready` |
| 报告 | 人类可读汇报性语言，讲清测了什么/结果如何 | 用户明确要求；对标 buglist 形态 |

### 与 #1 的对称
| | 蓝图级产物 | 何时立 | 谁消费 |
|---|---|---|---|
| #1 | UI 锚点（设计语言） | Stage 1.5 | UI delta + 本阶段 E2E |
| #2 | 客户旅程 + 验收标准（粗粒度） | Stage 1 | 里程碑 E2E |

两者都是"蓝图层早立、后期驱动验证"的产物。

## 4. 设计

### 4.1 验收基准产物：`state/acceptance.md`（Stage 1 确立）

- 位置：`<devRoot>/state/acceptance.md`，事实源级，按里程碑组织：每里程碑一组**客户旅程 + 验收标准**（粗粒度，业务语言）。
- 确立：roadmap-planner 在 Stage 1 拆单时一并产出——蓝图输入自带"客户旅程/验收标准"段则直接提取；未自带则按 roadmap 需求**粗推**一版（不细碎，只到"旅程 + 验收标准"层）。
- **与 customer-visible.md 的边界（评审补）**：`acceptance.md` = **验收基准**（该测什么 + 判 PASS/FAIL 的尺子，事前规划）；`customer-visible.md` = **实际交付清单**（各工单 Done 后追加，事后事实）。verifier 推导旅程时**以 customer-visible 的实际交付收敛旅程范围**（防对着没做的功能空验），**以 acceptance 的验收标准判 PASS/FAIL**。
- **校验（评审补，弱化为可执行）**：`validate-state` 仅在 `config.e2e` 块存在时校验"每个里程碑有对应 acceptance 段"的**存在性**（确定性可写）；"有无可观测面"交 roadmap-planner 在 Stage 1 自判，不强求脚本语义判断。
- 形态示例（粗粒度）：
  ```markdown
  ## M1 · <里程碑名>
  ### 旅程 J1：<客户从 X 进入，完成 Y>
  - 验收标准：<可观测的成功判据，业务语言>
  ### 旅程 J2：...
  ```

### 4.2 pipeline 注入点：里程碑收尾阶段（循环之外）

```
per-ticket 6 阶段循环（promote→...→handoff→下一条 Ready）
   │
   │  每次 active 翻 Idle 后，主线亲跑 `npm run milestone:status <M>`（确定性脚本）
   │  判定：该里程碑 done==total 且无 Ready/InProgress → 到达边界
   ▼
┌─ 里程碑 E2E 验收（新 · 蓝图级 · 循环之外）──────────────┐
│  触发：milestone:status 报边界到达 / 用户手动「对 M1 做 E2E 验收」 │
│  前提：config.e2e.verifySkill 已配；否则整阶段跳过        │
│  执行：e2e-verifier sub-agent（里程碑级派一次）           │
│  收口：默认自动；FAIL 升 Manager Override                 │
└──────────────────────────────────────────────────────────┘
   │
   │  整体 PASS → 作为里程碑 `Contract Done → Demo Ready` 翻档的前置证据之一
   │             （翻档动作遵 RUNBOOK §7 第 4 条 + roadmap.md 翻档要求：work item 全 Done + arch review + 本 E2E PASS）
   │  整体 FAIL → 生成/复用修复工单回流 per-ticket 循环 → 修完重跑（见 §4.4）
   ▼
```

- **确定性触发（评审补）**：原"主线 LLM 裁量是否到边界"不可靠（易漏触发/边界漂移）。改为主线在每次 active 翻 Idle 后**亲跑** `milestone:status` 脚本（复用 render-board 已算的 `byMilestone`），让脚本说话，与"不靠 LLM 汇报"哲学一致。
- 在 `active` 为 Idle、里程碑之间运行，**不扰** per-ticket 循环与 exactly-one-active 不变量。

### 4.3 e2e-verifier 执行流（两段式 gate）

1. **推导旅程**：读 `state/acceptance.md` 该里程碑段（验收标准）+ `customer-visible.md`（收敛到实际交付范围）+ UI 锚点 / 各 UI 工单 `2.0-ui-design.json.mockups` → 把粗粒度旅程展开为可驱动的真实流。**旅程↔mockup 对应**：UI 旅程按屏匹配到对应工单 receipt 的 `mockups[].path`。
2. **探索段（软 gate）**：委派 `config.e2e.verifySkill` 真启动**整合后的应用**（`config.e2e.launch` 指定启动方式，或交 dev-server 类 skill），逐条跑旅程，观察 + 截图取证 + （UI 旅程）逐屏比对锚点/mockup → 每旅程 verdict + 整体 verdict。
3. **固化段（硬 gate）**：把验过的旅程写成**旅程级 e2e 回归测试**，本轮**跑一次绿**即固化（硬 gate），登记进 `config.e2e.e2eCommands` 长期跑。
   - flaky 取舍（评审记录）：本 spec 选"跑一次绿即固化"，**不**连跑 N 次确认稳定——省成本、接受弱保证；flaky 风险显式记入 §8，靠后续回归暴露。
4. **写报告 + receipt**：见 §5。报告用**业务语言叙述**，禁止直接转储 receipt JSON 字段（防退化为机器 dump）。

### 4.4 收口与 FAIL 闭环（评审补：去重 + 上限）

- 整体 **PASS**（verdict=PASS + 固化测试绿）→ 作里程碑翻档前置证据，不为 PASS 打扰用户。
- 整体 **FAIL** →
  - 每条失败旅程生成修复工单前，**先查重**：queue 中是否已有同 `(milestone, journey_id)` 未 Done 的修复工单（修复工单带 `source: e2e-fail` / `milestone` / `journey_id` 字段）；有则**不重复发**，复用既有工单。
  - **attended**：走 Manager Override，验收报告作 escalation 证据，用户拍板（接受修复工单批次 / drop / override）。
  - **unattended**：自动把新失败旅程落成 **Planned 修复工单**（带溯源字段 + 报告证据）+ 记 `retro.md`。
  - **时序回拉**：修复工单走正常 per-ticket pipeline；该批修复工单全 Done 后，主线下一次 active 翻 Idle 时 `milestone:status` 仍报该里程碑边界 → **重新进入 E2E 阶段重跑**。
  - **逃生阀**：receipt 记 `e2e_rerun_count`；超过 `config.e2e.maxRerun`（默认 2）仍 FAIL → **强制 Manager Override**（不再自动重跑），对齐"不让 retry 静默循环"。

## 5. 产物 / 配置 / 角色 / 落点

### 5.0 不变量 #9 落点映射（评审补：底盘 vs prompt）

> 改 `bootstrap/workflow/scripts/*`（新增 `milestone:status` 脚本、`validate-state.mjs` 加 acceptance 存在性校验、`config.mjs` 加 `e2e` 块校验）= **skill 自身演进**：改 skill 源的 `bootstrap/workflow/` + 用户重 bootstrap 分发，非运行期就地加（不变量 #9）。`agents/*.md` 与 SKILL.md 编排叙述可正常改。
>
> **与 B2R_HOME（commit 458c03d）的接缝（本 spec 唯一实质触点）**：本设计**新增了 `milestone:status` 这个 npm script alias**，是三份 spec 里唯一要碰 `dev-package.json.tmpl` 的。它**必须沿用 458c03d 的新形态**，不能用已被删除的 `{{skillBundlePath}}`：
> ```
> "milestone:status": "DEV_ROOT=\"$PWD\" node \"${B2R_HOME:-{{skillRoot}}}/bootstrap/workflow/scripts/milestone-status.mjs\""
> ```
> 其余底盘脚本（`config.mjs`/`validate-state.mjs`/`milestone-status.mjs`）运行期均经 `${B2R_HOME:-<skillRoot>}` 解析，随 bootstrap 分发。`config.e2e.launch`（如何启动整合应用）是 **DEV_ROOT（项目）侧**配置、与 B2R_HOME 正交，由项目自行保证可移植。

| 改动 | 类别 | 落点 |
|---|---|---|
| `milestone:status` 确定性脚本 | 底盘（走 bootstrap） | 新增 `bootstrap/workflow/scripts/milestone-status.mjs` + `dev-package.json.tmpl` 加 `${B2R_HOME:-{{skillRoot}}}` 形态 alias |
| `e2e` 块校验 + acceptance 存在性校验 | 底盘 | `config.mjs` / `validate-state.mjs` |
| e2e 阶段编排 / FAIL 闭环 | 编排叙述 | `SKILL.md` 主流程 + 失败处理两节 |
| 新增 e2e-verifier | prompt | `agents/e2e-verifier.md` |
| acceptance.md 确立 | prompt | `agents/roadmap-planner.md`（Stage 1 一并产出） |

### 5.1 三件套产物（里程碑级）

| 产物 | 位置 | 作用 |
|---|---|---|
| **验收报告** | `<devRoot>/<reportsDir>/<milestone>-acceptance.md` | **人类可读汇报**：①测了哪些旅程（业务语言逐条）②逐旅程 ✅/❌ + 一句话结果 ③发现的问题（buglist 形态）④证据（截图引用 + UI mockup 比对结论）⑤本轮固化了哪些回归测试。随 git 追踪作 proof-of-work |
| **机器 receipt** | `<devRoot>/<reportsDir>/e2e-<milestone>.json`（里程碑级，不入 work/<slugDir>/） | 主线判 gate |
| **固化 e2e 测试** | 项目测试目录（由 verifySkill/项目约定决定） | 未来回归硬 gate，加入 `e2eCommands` |

三者分工：报告给人看、receipt 给主线判、固化测试给未来回归兜底。

### 5.2 config（新 `e2e` 块，缺省即关闭整阶段）

```js
// workflow.config.mjs
e2e: {
  verifySkill: 'verify',                  // 委派的实时验证 skill；缺失 → 里程碑 E2E 跳过
  launch: 'bash .claude/skills/dev-server/scripts/dev-server.sh start',  // 如何启动整合应用（可空，交 verifySkill）
  e2eCommands: ['npm run test:e2e'],      // 固化旅程测试加入的硬 gate 套件
  reportsDir: 'e2e',                      // 验收报告目录（相对 devRoot）
  maxRerun: 2,                            // FAIL 闭环重跑上限，超限强制 Manager Override
}
```

- `config.mjs`（壳 `validate-config.mjs`）增 `e2e` 块校验：存在则 `verifySkill` 非空字符串、`e2eCommands` 字符串数组、`reportsDir` 非空合法、`maxRerun` 非负整数。整块可缺省。

### 5.3 receipt `e2e-<milestone>.json`（遵循通用 envelope + 单写者 #8）

```json
{
  "stage_id": "e2e-acceptance",
  "milestone": "M1",
  "e2e_rerun_count": 0,
  "journeys": [
    { "id": "J1", "desc": "...", "verdict": "PASS|FAIL", "evidence": ["..."], "mockup_refs": ["work/<slugDir>/ui/<screen>.<ext>"], "mockup_match": true }
  ],
  "overall_verdict": "PASS|FAIL",
  "captured_test_paths": ["..."],
  "e2e_regression_green": true,
  "report_path": "e2e/M1-acceptance.md",
  "fix_tickets_created": [{ "id": "...", "source": "e2e-fail", "milestone": "M1", "journey_id": "J3" }],
  "escalated_to_human": false
}
```

带通用 envelope（`level`/`attempt`/`completed_at`/`manager_override`）。失败处理复用现有"交付失败兜底 → retry-once → Manager Override"链。

### 5.4 新角色：`e2e-verifier`（`agents/e2e-verifier.md`，里程碑级派一次）

读 acceptance + customer-visible + 锚点/mockup → 推导旅程 → 委派 verifySkill 真跑整合应用 → 取证 → 固化旅程测试 → 写**业务语言**报告（禁转储 receipt JSON）→ 返回 receipt。自身不含 E2E 框架知识。

## 6. 接缝与不变量

- **消费 #1**：UI 旅程逐屏比对 `2.0-ui-design.json.mockups[].path`（"整合后的 UI ≈ 设计愿景"在此落地）；#1 已把 mockups 改为数组以支持逐屏断言。
- **与 #3**：FAIL 生成的修复工单走当前编号方案——触及 #3 但本 spec 不解决编号并发。
- **里程碑翻档**：E2E PASS 是 `Contract Done → Demo Ready` 翻档前置证据之一，不发明新里程碑态。
- **不变量保持**：E2E 在 active Idle、里程碑之间跑，不破 exactly-one-active；固化测试作代码独立 commit；报告/receipt 作 proof-of-work；不手写 BOARD.html、receipt 主线单写；底盘改动经 bootstrap 分发（§5.0）。
- **不违反委派精神（#9 类比）**：skill 不内置 E2E 框架，委派 `verifySkill`；旅程源自 acceptance.md 而非发明。

## 7. 验收口径

1. **跳过路径**：未配 `e2e.verifySkill` 的项目里程碑照常推进，无 E2E 阶段、无报错。
2. **acceptance 确立 + 校验**：Stage 1 后 `state/acceptance.md` 按里程碑含旅程+验收标准；蓝图自带则提取否则粗推；`validate-state` 仅在配 e2e 块时校验存在性。
3. **确定性触发**：`milestone:status` 脚本对"全 Done 且无 Ready/InProgress"返真；主线亲跑而非 LLM 裁量。
4. **两段式**：探索 verdict 落 receipt；固化旅程测试本轮跑绿并入 `e2eCommands`。
5. **报告可读**：`<reportsDir>/<milestone>-acceptance.md` 含 §5.1 五部分、业务语言，非 receipt 转储。
6. **收口**：整体 PASS 不打扰、作翻档前置；FAIL 升 Manager Override（attended）/ 落 Planned 修复工单（unattended）。
7. **FAIL 闭环去重 + 上限**：同 `(milestone, journey_id)` 不重复发单；`e2e_rerun_count > maxRerun` 强制 Manager Override，不静默重跑。
8. **config 校验**：非法 `e2e` 块（含 `maxRerun`）字段级报错；缺省退出码 0。

## 8. 剩余风险（允许带入后续）

- **flaky 固化（评审取舍）**：本 spec 选"跑一次绿即固化"，固化测试可能本轮绿、后续 flaky，污染 `e2eCommands`。接受为已知弱保证，靠后续回归红暴露 + 人工剔除；不涉安全/权限/审计/数据。若 flaky 频发，升级为"固化前连跑 2-3 次全绿"（e2e-verifier 单点改）。
- E2E 探索的非确定性：探索段 verdict 软、可能漏报，靠"固化回归测试硬 gate"沉淀确定性部分。
- `verifySkill` 驱动整合应用的稳定性依赖项目启动隔离。
- acceptance.md 粗推质量依赖 roadmap 完整度；粗推偏差由里程碑边界 surface（FAIL 时）或下一轮修正兜。
