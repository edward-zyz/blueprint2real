# Quality Gates · 脚本驱动的硬阻断节点清单

> 何时读本文：你在主线 thread 想跳过某个验证步骤、或对"为什么 sub-agent 完成不算数"感到疑惑时。

## 核心原则

**Sub-agent 自报"通过"不算数；脚本说通过才算通过。**

这不是不信任 sub-agent——是不变量的物理实现需要可重放、可审计、可在 git history 里看到的证据。Sub-agent 跑过的命令在它的临时 thread 里消失了，主线必须**亲自再跑一遍**记录在主线的对话历史里。

## 节点清单

| Stage | 时机 | 命令 | 通过判据 | 失败时做什么 |
|---|---|---|---|---|
| 1 | roadmap-planner 返回后 | `cd {{devRoot}} && npm run validate:state` | 0 error | sub-agent 显然没写好 queue.md，回报用户决定是否打回重做 |
| 1 | roadmap-planner 返回后 | `cd {{devRoot}} && npm run deps:graph` | 退出码 0（无环）+ 文本输出依赖关系合理 | 依赖循环或孤儿节点 → 打回 planner 调整 |
| 2 | promote.mjs 后 | promote.mjs 内嵌跑了 validate:state；主线再跑一次冷确认 | 0 error | promote 应该不会留 broken state，但万一发生，回报 |
| 1.5 | UI anchor（可选） | 主线读 `1.5-ui-anchor.json` + 校验 `state/ui-anchor.md` 存在 | `reviewer_verdict=PASS`，且 `ref_grep_hits` 非空或 `synthesized_design_system=true` 且 `synthesis_evidence` 非空；项目事实源未被通用 designSkill 覆盖 | `NEEDS_FIX`、需要发现时未主动发现、或合成证据为空 → retry-once；仍失败进 Manager Override |
| 2.0 | UI delta（可选） | 主线读 `2.0-ui-design.json` + 校验 `mockups[].path` 存在 | `reviewer_verdict=PASS` 且 `mockups[]` 非空；`ui_novel=false`；mockup 对齐 anchor | `NEEDS_FIX` 或 `ui_novel=true` → surface / Manager Override；PASS 后 spec-drafter 必须引用 mockups |
| 2 | spec-drafter 返回后 | grep `TBD\|待定\|TODO` work/<id>/spec.md | 0 命中（§11 中明示的不算） | 打回 spec-drafter 补全 |
| 2 | spec-plan-reviewer 返回后 | reviewer 报告"总判定" | `READY TO IMPLEMENT` | `NEEDS REVISION` → 打回 spec-drafter / plan-drafter |
| 3 | implementor 启动前 | `cd {{devRoot}} && cat state/active.md \| head -10` | Status: In Progress + ID 是当前 work-id | 没翻好 → 提醒 implementor 重新跑 Stage 3 启动动作 |
| 3 | 红 gate（核 receipt） | 主线核 `3-impl.json` 的 `failing_test_first=="pass"` + Step 1 红色输出证据非空 | **证据非空即过** | 证据缺失/为空 → 红 gate 未过，回 implementor 重做（整包派工下红→绿在 implementor 内部，主线核 receipt 自证，不在内部两步间亲跑） |
| 3 | implementor Step 2 完成后 | 跑 plan §1 Step 1 的测试 | **必须绿** | 红了说明实现没到位，回 implementor 继续 |
| 3 | implementor 每切片完成后 | 本切片 targeted（plan §1 Step1 + spec §7） | 测试绿 | 红 → 回 implementor 改实现 |
| 3 | **末切片完成后**（收敛 regression，主线亲跑一次） | `config.regressionCommands` 每一条 | 全部退出码 0 | 任一非 0 → **按切片二分定位**（各切片 targeted + 报告耦合线索），定位切片回 implementor；不裸面对全量红海。多切片工单全量 regression 从 N× 降到 1× |
| 3 | implementation commit 后 | `git show --stat <hash>` + `git diff --name-only <hash>^ <hash>` | 文件列表 ⊆ spec §4 范围；无 state/* / BOARD.html | 超范围 → 把 commit reset 后回 implementor |
| 4 | arch-security-reviewer 返回前 | `cd {{devRoot}} && npm run lint:redlines` | 0 命中 | 命中 → 把命中清单作为输入打回 implementor |
| 4 | arch-security-reviewer 返回后 | reviewer 报告"总判定" | `READY TO HANDOFF` | `NEEDS FIX` → 按建议处理（fixup / 新 slice / 重做） |
| 5 | handoff-committer 第 5 步 | `cd {{devRoot}} && npm run validate:state` | 0 error | committer 翻档时漏了字段，回 committer 修 |
| 5 | handoff-committer 第 6 步 | `cd {{devRoot}} && npm run render:board` | 0 退出码 | 渲染异常通常是 state schema 错位，回 validate:state 看 |
| 5 | handoff-committer 第 8 步 commit 后 | `git show --stat <hash>` | 仅 state/* + BOARD.html | 超范围 → 把 handoff commit reset，重新做 |
| 5 | handoff-committer 第 10 步 | `cd {{devRoot}} && npm run verify:handoff <id>` | 7 项 check 全 ✓（L0 跳 Check 4，6/6） | 任一 ✗ → 按 check 输出修正后**主线**再跑一次（不让 committer 自报） |
| 0 | roadmap-planner Triage 段 | 主线读 `<devRoot>/work/<id>/receipts/0-triage.json` | `level ∈ {L0,L1,L2,L3}`；`reasons[]` 非空 | level 缺或为空 → 打回 planner 重打标 |
| M | Stage 5 handoff 后 | `cd {{devRoot}} && npm run milestone:status <milestone> -- --json` | `boundary_reached=true` 才进入 E2E；`next_action=skip_e2e_disabled` 时跳过 E2E 不报错 | 脚本未到边界 → 回 per-ticket pipeline；脚本异常 → 先修 state/config |
| M | E2E acceptance（可选） | 主线读 `<reportsDir>/e2e-<milestone>.json` + 跑 `e2e.e2eCommands` | `overall_verdict=PASS` + `e2e_regression_green=true` + 人类可读报告存在 | FAIL → 按 `(milestone, journey_id)` 去重生成/复用 Planned 修复工单；`e2e_rerun_count > maxRerun` → Manager Override |
| × | 任意 sub-agent 自报 `blocked: true` | 主线读 receipt `blocked_evidence` 字段 | 非空 + 具体引用（路径 / grep 结果 / 测试输出） | 空 evidence → 视为偷懒早退，原 stage 重派一次（不计入 attempt） |
| × | 任意 Agent 返回后（**先于 gate 判定**） | 主线解析末条消息能否成本 stage 的 receipt envelope | 可解析（stage_id/level/attempt 齐） | 不可解析（散文/报错/空/截断）= **交付失败**（不变量 10）→ fresh 重派 1 次 → 仍不可用主线内联接手（标 `dispatch_recovery`）→ 才 Manager Override；**不计入 gate attempt**，不在前两步惊动用户。真 hang 不在范围（依赖 harness 超时回收） |
| 5 | handoff-committer 第 11 步 | `cat <devRoot>/work/<id>/receipts/pipeline-status.json` | `status: "done"` + `escalation_pack: null` | 仍 escalation → 不允许 handoff，回 Manager Override 再处理 |

## Manager Override · 5 个 action 详解（v5.1）

任一 Gate fail 后 `attempt > pipeline.maxRetry + 1`（默认 attempt > 2）**或** sub-agent 自报阻塞 **或** Gate 8 fail，主线进入 Manager Override 流程：

1. **即时渲染卷宗** escalation-pack（**不**持久化为 .md）：历次 receipt diff + 历次 feedback + sub-agent self-report
2. **主线起草决策建议**：基于卷宗匹配 5 选 1
3. 主线用 `AskUserQuestion` 呈现建议 + 4 个可选 action
4. 用户拍板后主线落盘 `<devRoot>/work/<id>/receipts/manager-decision-<timestamp>.json`
5. 追加 `<devRoot>/state/retro.md` 一段
6. 按 action 调度

### Action 表

| Action | 适用场景 | 回流点 | 调度细节 |
|---|---|---|---|
| `accept-override` | reviewer 给的是过严的"理论问题"但实际可接受 | 下一 stage（接受当前 receipt verdict 强行 READY） | 后续 receipt 全部带 `manager_override: { gate, decision_path, action }` |
| `downgrade` | 发现工单实际复杂度低于初判 | **Gate 4 重判 level branch**（不直跳 S3） | 改 `0-triage.json.level`（如 L3→L2）；customer-visible 记录降档 |
| `shrink-scope` | 工单边界没收住，应剥离卡住部分 | S2a（spec retry，加 §3 不做项） | 自动建新 Planned 工单接住剥离部分 |
| `split-slice` | spec §4 范围过大，部分能做部分卡住 | **S2b（plan retry，声明 sub-slice）** | plan §3 增 Sub-slice 列表；implementor 按 slice 重启 |
| `drop` | 工单本身错了，前置假设不成立 | Done（queue 翻 Superseded） | active 翻 Idle；customer-visible 写"暂停 + 原因" |

**Gate 8 (handoff verify) fail 后**：Manager 仅允许 `accept-override` 或 `drop`（downgrade / shrink-scope / split-slice 在 handoff 阶段语义不成立）。

### attempt 语义

- `attempt` 从 **1** 起算（1 = 首次，2 = 已重试 1 次）
- 升级触发：`attempt > pipeline.maxRetry + 1`（默认 maxRetry=1，attempt > 2 升级）
- attempt 计数 **stage 级独立**：spec retry 不消耗 impl 余额
- pipeline-status 统一用 `current_attempt`，不用 `retry_count`

### Retro surface 触发

每里程碑结束 **或** 累计 ≥ `pipeline.retroSurfaceThreshold`（默认 3）条新 retro 条目，下一次 Stage 1 派工前主线主动展示 retro.md。

## 为什么这套节点这么"硬"

历史上的退化模式有几个：

1. **"先做了再说，测试有空再补"**：跳过 Step 1 失败测试 → Step 2 实现进去，测试变成证明实现已写好的"摆设"，遇到 bug 时测试不报错。**反制**：硬要求 Step 1 测试必须红。
2. **"顺便把这块也清理一下"**：implementer 在 Step 2 顺手 refactor 邻近代码 → impl commit 超范围 → revert 时连累无关代码。**反制**：硬要求 commit 文件清单 ⊆ spec §4。
3. **"sub-agent 说通过了应该没问题"**：主线直接相信 sub-agent 自报 → state/* 翻档错位 → BOARD 显示与现实不符。**反制**：每个 sub-agent 完成后主线必须**亲自**跑脚本验证。
4. **"批量 promote 一波然后慢慢做"**：promote 多条 Planned 进 Ready → 前置工单实际产出与 spec 假设不符 → 实现时发现 spec 错。**反制**：promote 必须串行（前置 Done 后才能 promote 下一条）。
5. **"handoff commit 顺便也加点代码"**：commit 时把代码 + state/* 一起 commit → revert 困难。**反制**：双 commit 物理分离。

## 主线 thread 自己的检查节奏

任何时候不确定要不要继续，跑这两条命令快速体检：

```bash
cd {{devRoot}} && npm run validate:state
cd {{devRoot}} && cat state/active.md | head -15
```

- validate:state 0 error + active.md 状态字段清晰 → 可以继续
- 否则停下，先把状态修干净
