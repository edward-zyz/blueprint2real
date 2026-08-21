# E2E 验收线 · 里程碑级 / 批次级（可选机制）

> 何时读本文：`workflow.config.mjs` 配了 `e2e` 块，且 Stage 5 handoff 后脚本报到达里程碑边界（`boundary_reached=true`）或组级边界（`next_action=run_group_e2e`）。缺省 `e2e` 块 = 整条 E2E 验收线关闭，纯库 / CLI / 无可启动应用项目不读本文、不报错。
>
> E2E 只在边界运行，**不进入单工单 6 阶段循环**；它的 gate 不占用单工单 stage attempt。

## 可选蓝图级 E2E 验收线（里程碑阶段，循环之外）

仅当 `workflow.config.mjs` 配置 `e2e` 块时启用；缺省表示整条 E2E 验收线关闭，纯库 / CLI / 无可启动应用项目不报错。

- Stage 1：roadmap-planner 在 backlog proposal 中同时给出 `state/acceptance.md` 提案，主线写入 state。若 roadmap/blueprint 自带客户旅程或验收标准，直接提取；否则按里程碑粗推一版。粒度只到"客户旅程 + 验收标准"，不要展开成操作脚本。
- 每次 Stage 5 handoff 让 active 回 Idle 后，主线亲跑 `cd {{devRoot}} && npm run milestone:status <milestone>`。脚本报告 `boundary_reached=true` 才能进入 E2E，主线不得凭自然语言判断边界。
- E2E verifier 读 `state/acceptance.md` 的该里程碑段 + `state/customer-visible.md` 的实际交付范围 + UI 锚点 / `2.0-ui-design.json.mockups[]`，把粗旅程展开成真实验证流。
- 探索段由 `e2e.verifySkill` 启动整合应用并取证；固化段把已验过的稳定旅程写成项目 e2e 回归测试，本轮跑一次绿即加入 `e2e.e2eCommands`。
- 产物是 `<reportsDir>/<milestone>-acceptance.md`（给人看的业务语言报告）、`<reportsDir>/e2e-<milestone>.json`（主线判 gate 的 receipt）和项目测试目录里的固化 e2e 测试。
- PASS 不打扰用户，作为 `Contract Done → Demo Ready` 翻档前置证据之一；FAIL 按 `(milestone, journey_id)` 去重生成/复用 Planned 修复工单，修完后重跑。`e2e_rerun_count > e2e.maxRerun` 时强制 Manager Override，不静默循环。

## 可选批次级 E2E 验收线（per-submission，`e2e.unit∈{group,both}` 时启用）

把"一次 b2r 提交 mint 出的一批工单"作为一个 E2E 验收单位，比粗里程碑更贴合日常交付节奏；与里程碑级线可并存（`unit:'both'`）。

- **mint 时建组**：Stage 1 主线 `mintWorkId` 回填这批 backlog 的真实工单号后，再调 `mintGroupId(new Date())` 生成 group id（`EG-<本地时间戳>`），把这批工单号写进 `state/e2e-groups.md` 一行：`| <group> | <id1>, <id2>, … | Open | — | <YYYY-MM-DD> |`。一次提交一行，缺省 Status=Open。**建组动作本身无条件执行**（不看 `e2e.unit`）——该账本同时是批次完整性闸的事实源，见 SKILL.md「Stage 1 批次账本」；本节其余内容才是 `unit∈{group,both}` 专属的组级 E2E 验收语义。
- **边界检测**：每次 Stage 5 handoff 让 active 回 Idle 后，主线亲跑 `cd {{devRoot}} && npm run e2e-group:status -- --json`。对 `next_action=run_group_e2e`（该组工单全 Done 且 Status 仍 Open）的组进入组级 E2E，不得凭自然语言判断边界。
- **派 verifier**：用 `agents/e2e-verifier.md` 的 `mode=group`、`{{scopeId}}=<group>` 派一次。旅程基准取该组各成员工单 spec 的 §验收标准 + `customer-visible.md` 的成员 Done 段（**不读 acceptance.md**）。
- **收口**：PASS（`overall_verdict=PASS` 且 `e2e_regression_green=true`）→ 主线把该组行翻 `Accepted` 并填 Receipt 路径 `<reportsDir>/e2e-<group>.json`；确认无可观测面（verifier `blocked` 证据为"无可观测面"）→ 翻 `Skipped` 并在该行 Receipt 写 `skip:<原因>`。两者都解除硬卡。
- **硬卡**：`validate-state` 对"成员全 Done 但 Status 仍 Open"的批次报 error（见校验器 D3），**无条件生效**（不看 `e2e.unit`）。即整批做完没固化收口，validate:state 必红、promote/handoff 全堵——杜绝"跑完即弃"。e2e 未启用时收口 = 把该行翻 `Skipped`、Receipt 写 `skip:e2e-disabled`；账本必须有尾。
- **FAIL 闭环**：按 `(group, journey_id)` 去重生成/复用 Planned 修复工单（`source:e2e-fail`），修完后该组仍在边界则重跑；`e2e_rerun_count > e2e.maxRerun` 强制 Manager Override，不静默循环。修复工单可加入同组（追加到该行 WorkIds）或自成新组，由主线按是否同一交付判断。

## E2E 两段式执行（里程碑级与组级共用）

单个长 e2e-verifier 囤几十张 base64 截图会把上下文撑爆、触发 Anthropic Usage Policy 硬阻断（实测连续两会话因此全损）。故把验收拆两段：

- **段一·展开 journeys 清单**：边界到达后，主线**内联**（旅程多/复杂时可派一次轻量工）把验收标准展开成 `<reportsDir>/journeys-<scopeId>.json`（每条 `{journey_id, desc, steps, status:"pending"}`）。
- **段二·逐旅程短 verifier**：主线对每条 `status:"pending"` 旅程派独立 `e2e-verifier(mode=journey, journey_id=Jx)`——**截图落盘即弃**（截图存 `evidence/<scopeId>/<journey_id>/`，thread 内只留路径，绝不把 base64 图留在上下文），单旅程 receipt 落 `evidence/<scopeId>/<journey_id>.json`；主线汇总拼组级 receipt。
- **断点续跑**：段二派工前扫 `evidence/<scopeId>/`，已 PASS 旅程跳过——中断后续跑不重做（连续两会话曾因从零重跑而卡死最后一公里）。
- **第三类失败「policy/transport 硬杀」**：verifier 被 AUP/连接杀死无单旅程 receipt → 主线据该旅程已落 evidence 内联补一个 `reason_category="env-blocked"` 或 `escalated_to_human=true` 的旅程 receipt，让组有尾、不卡 Open（区别于不变量 10 的交付失败：这是不可重试硬墙，直接降级标注）。
- **组级 receipt 可读性**：组级 receipt 顶层增 `acceptance_legible_status`（`ACCEPTED` / `ACCEPTED_WITH_ENV_BLOCKED` / `FAILED`）+ `env_blocked_reason`，让不懂 b2r 协议的下游人/CI 也能一眼判定非绕过门禁（外部 CI 曾因 `PASS`+`green:false` 共存误判「疑似绕过」）。

## 里程碑 E2E FAIL 闭环

E2E acceptance 是蓝图级 gate，不占用单工单 stage attempt；失败时仍要遵守"不静默循环"：

1. e2e-verifier 返回 `overall_verdict="FAIL"` 或固化回归测试未绿时，主线先读 `<reportsDir>/e2e-<milestone>.json` 的 `journeys[]` **与 `e2e_regression_reason_category`**：
   - `env-blocked`（缺浏览器 / dev 种子 / Node 版本错配等环境性失败）→ **不当质量 FAIL**，不自动发修复工单；surface 环境前置缺口给用户（接项目 E2E runbook），按 attended/unattended 决定是否阻断翻档。这避免预存环境 flake 把真回归信号淹没、也不再依赖 Manager 人肉 `git diff` 区分。
   - `quality-fail` / `coverage-gap` → 走下面的 FAIL 闭环（发/复用修复工单 / 补配置）。
2. 对每条失败旅程，先查 `state/queue.md` 是否已有未 Done 修复工单带同一组溯源字段：`source: e2e-fail` / `milestone` / `journey_id`。已有则复用，不重复发单。
3. attended 模式升 Manager Override，由验收报告作 escalation 证据；unattended 模式自动落 Planned 修复工单，并把失败链写入 `state/retro.md`。
4. 修复工单走正常 per-ticket pipeline；全部 Done 后，下一次 `milestone:status` 仍到边界时重跑 E2E。
5. `e2e_rerun_count > e2e.maxRerun` 时强制 Manager Override，不再自动重跑。

## 质检节点（E2E 相关行）

| 阶段 | 质检命令 | 通过判据 |
|---|---|---|
| 里程碑边界 | `cd {{devRoot}} && npm run milestone:status <milestone> -- --json` | `boundary_reached=true` 才能进入 E2E；`next_action=skip_e2e_disabled` 时跳过 E2E 不报错 |
| 里程碑 E2E（可选） | 主线读 `<reportsDir>/e2e-<milestone>.json` + 跑 `e2e.e2eCommands` | `overall_verdict=PASS` 且 `e2e_regression_green=true`，报告存在且是业务语言 |
| 组级边界（`unit∈{group,both}`） | `cd {{devRoot}} && npm run e2e-group:status -- --json` | `next_action=run_group_e2e` 才进组级 E2E；硬卡见 validate-state D3（批次全 Done 仍 Open → error，无条件生效） |
| 组级 E2E（可选） | 主线读 `<reportsDir>/e2e-<group>.json` + 跑 `e2e.e2eCommands`，PASS 后把组翻 `Accepted`+Receipt | `overall_verdict=PASS` 且 `e2e_regression_green=true`，报告存在且是业务语言 |

## Receipt 位置

里程碑 / 组级 E2E receipt 不属于单工单 slug，落在 `<devRoot>/<reportsDir>/e2e-<scopeId>.json`，同目录还有人类可读报告 `<milestone>-acceptance.md`。主线用 receipt 判 gate，用报告向用户解释测了什么。字段详见 `receipts-schema.md` 的 `e2e-<milestone>.json` 与「单旅程 receipt」两节。

派 verifier 用 `agents/e2e-verifier.md`：里程碑边界 `mode=milestone`、组级边界 `mode=group`、两段式段二 `mode=journey`。
