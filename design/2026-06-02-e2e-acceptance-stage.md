# blueprint2real · 蓝图级 E2E 验收阶段设计

- 状态：设计已与用户确认，待评审
- 日期：2026-06-02
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
6. FAIL 闭环：集成 bug → 生成修复工单回流 → 重跑 → 整体 PASS 才收尾里程碑。

### 非目标
- 不做工单级 E2E（工单级已有 `verify` / targeted / regression）。
- 不实现 UI 设计（#1）与编号（#3）。
- 不在 skill 内置具体 E2E 框架/驱动知识（委派 `verifySkill`）。
- 不要求细碎测试步骤——旅程粗粒度，verifier 在运行时展开。

## 3. 决策记录（用户已确认）

| 决策点 | 结论 | 理由 |
|---|---|---|
| E2E 形态 | Agent 真跑验证 + 把稳定场景固化成回归测试 | 探索抓意料外 bug + 回归长期兜底，双收 |
| 层级 | **蓝图/里程碑级**，非工单级 | 工单级已有 verify；集成 bug 只在整体串联时暴露 |
| 验证单元/触发 | `config.milestones` 里程碑边界自动 + 可手动触发 | 复用已有里程碑机制 |
| 旅程来源 | **专用 `state/acceptance.md`，Stage 1 确立**（蓝图自带则提取，否则粗推），E2E 消费 | 验收基准稳定、可审、与开发同源 |
| 旅程粒度 | 粗粒度：清晰客户旅程 + 验收标准，不陷细碎步骤 | verifier 运行时展开为真实驱动流 |
| gate 语义 | 两段式：探索 verdict（软）+ 固化回归测试（硬） | 耐久产物是脚本可跑的测试，贴 skill"让脚本说话"哲学 |
| 收口 | 默认自动（PASS 不打扰）；FAIL 升人 | 与 #1 UI delta 收口对称，保无人值守 |
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
- 确立：roadmap-planner 在 Stage 1 拆单时一并产出——
  - **蓝图输入自带**"客户旅程/验收标准"段 → 直接提取落盘；
  - **未自带** → roadmap-planner 按 roadmap 需求**粗推**一版（不细碎，只到"旅程 + 验收标准"层）。
- 评审：纳入 `validate-state` 一致性校验（每个有 UI/可观测面的里程碑应有对应 acceptance 段）。
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
   │  某里程碑下所有工单 Done 且无剩余 Ready
   ▼
┌─ 里程碑 E2E 验收（新 · 蓝图级 · 循环之外）──────────────┐
│  触发：里程碑边界自动 / 用户手动「对 M1 做 E2E 验收」     │
│  前提：config.e2e.verifySkill 已配；否则整阶段跳过        │
│  执行：e2e-verifier sub-agent（里程碑级派一次）           │
│  收口：默认自动；FAIL 升 Manager Override                 │
└──────────────────────────────────────────────────────────┘
   │
   │  整体 PASS → 里程碑翻 Done（roadmap 状态流转，RUNBOOK §7.4）
   │  整体 FAIL → 生成修复工单回流 per-ticket 循环 → 修完重跑
   ▼
```

- 在 `active` 为 Idle、里程碑之间运行，**不扰** per-ticket 循环与 exactly-one-active 不变量。

### 4.3 e2e-verifier 执行流（两段式 gate）

1. **推导旅程**：读 `state/acceptance.md` 该里程碑段 + 累计 `customer-visible.md` + UI 锚点/各工单 mockup → 把粗粒度旅程展开为可驱动的真实流。
2. **探索段（软 gate）**：委派 `config.e2e.verifySkill` 真启动**整合后的应用**（`config.e2e.launch` 指定启动方式，或交 dev-server 类 skill），逐条跑旅程，观察 + 截图取证 + （UI 旅程）比对锚点/mockup → 每旅程 verdict + 整体 verdict。
3. **固化段（硬 gate）**：把验过的稳定旅程写成**旅程级 e2e 回归测试**，本轮跑绿（硬 gate），登记进 `config.e2e.e2eCommands` 长期跑。flaky 旅程**不准**进硬 gate（仅留报告记录）。
4. **写报告 + receipt**：见 §5。

### 4.4 收口与 FAIL 闭环

- 整体 **PASS**（verdict=PASS + 固化测试绿）→ 里程碑可翻 Done，不为 PASS 打扰用户。
- 整体 **FAIL** →
  - **attended**：走 Manager Override，把验收报告作 escalation 证据呈现，用户拍板（接受修复工单批次 / drop / override）。
  - **unattended**：自动把每条失败旅程落成 **Planned 修复工单**（带报告证据）+ 记 `retro.md`。
  - 修复工单走正常 per-ticket pipeline 修复；修完**重跑里程碑 E2E**；只有整体 PASS 里程碑才收尾。

## 5. 产物 / 配置 / 角色

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
}
```

- `validate-config.mjs` 增 `e2e` 块校验：存在则 `verifySkill` 非空字符串、`e2eCommands` 字符串数组、`reportsDir` 非空合法。整块可缺省。

### 5.3 receipt `e2e-<milestone>.json`（遵循通用 envelope + 单写者 #8）

```json
{
  "stage_id": "e2e-acceptance",
  "milestone": "M1",
  "journeys": [
    { "id": "J1", "desc": "...", "verdict": "PASS|FAIL", "evidence": ["..."], "mockup_match": true }
  ],
  "overall_verdict": "PASS|FAIL",
  "captured_test_paths": ["..."],
  "e2e_regression_green": true,
  "report_path": "e2e/M1-acceptance.md",
  "fix_tickets_created": [],
  "escalated_to_human": false
}
```

带通用 envelope（`level`/`attempt`/`completed_at`/`manager_override`）。失败处理复用现有"交付失败兜底 → retry-once → Manager Override"链。

### 5.4 新角色：`e2e-verifier`（`agents/e2e-verifier.md`，里程碑级派一次）

读 acceptance + customer-visible + 锚点/mockup → 推导旅程 → 委派 verifySkill 真跑整合应用 → 取证 → 固化旅程测试 → 写报告 → 返回 receipt。自身不含 E2E 框架知识。

## 6. 接缝与不变量

- **消费 #1**：UI 旅程比对锚点/`mockup_path`（"整合后的 UI ≈ 设计愿景"在此落地）。
- **与 #3**：FAIL 生成的修复工单走 IS-NNN 编号——触及 #3 但本 spec 不解决编号并发。
- **不变量保持**：E2E 在 active Idle、里程碑之间跑，不破 exactly-one-active；固化测试作代码独立 commit；报告/receipt 作 proof-of-work；不手写 BOARD.html、receipt 主线单写。
- **不违反委派精神（#9 类比）**：skill 不内置 E2E 框架，委派 `verifySkill`；旅程源自 acceptance.md 而非发明。

## 7. 验收口径

1. **跳过路径**：未配 `e2e.verifySkill` 的项目里程碑照常收尾，无 E2E 阶段、无报错。
2. **acceptance 确立**：Stage 1 后 `state/acceptance.md` 按里程碑含旅程+验收标准；蓝图自带则提取，否则粗推；`validate-state` 校验存在性。
3. **触发**：里程碑全 Done 自动起；用户手动可起指定里程碑。
4. **两段式**：探索 verdict 落 receipt；固化旅程测试本轮跑绿并入 `e2eCommands`；flaky 旅程不进硬 gate。
5. **报告可读**：`<reportsDir>/<milestone>-acceptance.md` 含 §5.1 五部分，自然语言汇报。
6. **收口**：整体 PASS 不打扰、里程碑可 Done；FAIL 升 Manager Override（attended）/ 落 Planned 修复工单（unattended）。
7. **闭环**：FAIL 生成的修复工单 Done 后重跑里程碑 E2E；PASS 才收尾。
8. **config 校验**：非法 `e2e` 块字段级报错；缺省退出码 0。

## 8. 剩余风险（允许带入后续）

- E2E 探索的非确定性：探索段 verdict 软、可能漏报，靠"固化回归测试硬 gate"沉淀确定性部分；漏报风险不涉安全/权限/审计/数据，符合带入下一轮例外。
- `verifySkill` 驱动整合应用的稳定性依赖项目启动隔离；flaky 旅程靠"不准进硬 gate"挡住污染回归套件。
- acceptance.md 粗推质量依赖 roadmap 完整度；粗推偏差由里程碑边界的人审（attended）或下一轮修正兜。
