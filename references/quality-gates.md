# Quality Gates · 脚本驱动的硬阻断节点清单

> **单源声明**：Gate 判定规则以本文件为唯一权威；`pipeline-flow.md` 只是流程图示，两者冲突时以本文件为准（Gate 编号对齐 pipeline-flow 图中节点名，如 G6=level branch）。

> 何时读本文：你在主线 thread 想跳过某个验证步骤、或对"为什么 sub-agent 完成不算数"感到疑惑时。

## 核心原则

**Sub-agent 自报"通过"不算数；脚本说通过才算通过。**

这不是不信任 sub-agent——是不变量的物理实现需要可重放、可审计、可在 git history 里看到的证据。Sub-agent 跑过的命令在它的临时 thread 里消失了，主线必须**亲自再跑一遍**记录在主线的对话历史里。

## 节点清单

| Stage | 时机 | 命令 | 通过判据 | 失败时做什么 |
|---|---|---|---|---|
| 1 | roadmap-planner 返回后 | `cd {{devRoot}} && npm run validate:state` | 0 error | sub-agent 显然没写好 queue.md，回报用户决定是否打回重做 |
| 1 | roadmap-planner 返回后 | `cd {{devRoot}} && npm run deps:graph` | 退出码 0（无环）+ 文本输出依赖关系合理 | 依赖循环或孤儿节点 → 打回 planner 调整 |
| 2 | promote 写盘 / dry-run 输出前（可选） | `config.prePromoteCommands`，由 `promote.mjs` 在 `projectRoot` 顺序执行 | 全部退出码 0；环境含工单 ID/标题/dry-run/force | 任一非 0、信号或启动失败 → 立即停止，queue/spec/plan/context/BOARD 零改动；`--force` 不豁免 |
| 2 | promote.mjs 后 | promote.mjs 内嵌跑了 validate:state；主线再跑一次冷确认 | 0 error | promote 应该不会留 broken state，但万一发生，回报 |
| 1.5 | UI anchor（可选） | 主线读 `1.5-ui-anchor.json` + 校验 `state/ui-anchor.md` 存在 | `reviewer_verdict=PASS`，且 `ref_grep_hits` 非空或 `synthesized_design_system=true` 且 `synthesis_evidence` 非空；项目事实源未被通用 designSkill 覆盖 | `NEEDS_FIX`、需要发现时未主动发现、或合成证据为空 → retry-once；仍失败进 Manager Override |
| 2.0 | UI delta（可选） | 主线读 `2.0-ui-design.json` + 校验 `mockups[].path` 存在 | `reviewer_verdict=PASS` 且 `mockups[]` 非空；`ui_novel=false`；mockup 对齐 anchor | `NEEDS_FIX` 或 `ui_novel=true` → surface / Manager Override；PASS 后 spec-drafter 必须引用 mockups |
| 2 | spec-drafter 返回后 | grep `TBD\|待定\|TODO` `<devRoot>/<specsDir>/<slugDir>.md` | 0 命中（§11 中明示的不算） | 打回 spec-drafter 补全 |
| 2 | spec-plan-reviewer 返回后 | reviewer 报告"总判定" | `READY TO IMPLEMENT` | `NEEDS REVISION` → 打回 spec-drafter / plan-drafter |
| 3 | implementor 启动前 | `cd {{devRoot}} && cat state/active.md \| head -10` | Status: In Progress + ID 是当前 work-id | 没翻好 → 提醒 implementor 重新跑 Stage 3 启动动作 |
| 3 | 红门（核 receipt · 按切片分型） | 主线核 `3-impl.json` 的 `red_gate_mode` + 对应证据 | `behavior-change` 切片：`failing_test_output` 必须是**断言级**红（期望 vs 实得）；`new-module` 切片：写明 tests+impl 同批 + 断言覆盖 spec §7 哪几条且跑绿；`no-new-behavior` 切片（**仅限 `inline: true`**）：写明 diff 无行为变更 + 覆盖它的既有测试 / 上游切片 targeted 绿输出**具体引用**——**显式放行**，不按缺证据打回 | 证据缺失 / 为空 / 只是 `ERR_MODULE_NOT_FOUND`\|`Cannot find module`（只证明文件不存在，不算红门证据）/ `no-new-behavior` 出现在 `inline: false` 切片或只有空口声称 → 红门未过，回 implementor 重做（整包派工下红→绿在 implementor 内部，主线核 receipt 自证，不在内部两步间亲跑） |
| 3 | implementor Step 2 完成后 | 跑 plan §1 Step 1 的测试 | **必须绿** | 红了说明实现没到位，回 implementor 继续 |
| 3 | implementor 每切片完成后 | 本切片 targeted（plan §1 Step1 + spec §7） | 测试绿 | 红 → 回 implementor 改实现 |
| 3 | **末切片完成后**（收敛 regression，主线亲跑一次） | `config.regressionCommands` 每一条 | 全部退出码 0 | 任一非 0 → **按切片二分定位**（各切片 targeted + 报告耦合线索），定位切片回 implementor；不裸面对全量红海。多切片工单全量 regression 从 N× 降到 1× |
| 3 | implementation commit 后 | `git show --stat <hash>` + `git diff --name-only <hash>^ <hash>` | 文件列表 ⊆ spec §4 范围；无 state/* / BOARD.html | 超范围 → 把 commit reset 后回 implementor |
| 3.5 | UI fidelity（可选 · 仅 ui=true 且有 mockup 目录） | 主线起应用+browser-harness 截深/浅图落盘 → 派 `design-reviewer(mode=fidelity)` → 读 `3.5-ui-fidelity.json` | `reviewer_verdict=PASS`（所有 `本轮做` 元件 match） | `NEEDS_FIX`（元件 missing/mismatch）→ retry 回 implementor → Manager Override；截图取不到 → `env-blocked` surface 环境前置缺口；无 mockup 目录 = 非 UI 工单跳过 |
| 4 | Stage 4 开场（**默认主线内联**） | `cd {{devRoot}} && npm run lint:redlines`（含 `config.redlineCommands` 项目真 arch/layer/security lint，主线亲跑；占位态输出 WARN 而非假绿）+ 主线核 scope 一致性 / spec §11 对齐 / diff 面 | 0 命中且内联核查无疑点 | 命中 → **先阻断**：把命中清单作为输入打回 implementor 修，修到 0 命中才继续（不变量 6）。"曾命中"这一事实同时点亮下一行的条件 (a)，修完仍要派独立 reviewer 复核 |
| 4 | 是否派独立 reviewer（条件触发） | 主线判三条件：(a) 本工单期间 lint:redlines / redlineCommands **曾命中**（即使已修复，事实不消失）；(b) diff 触碰认证 / 授权 / 加密 / 密钥 / 权限 / schema migration / 计费；(c) 内联核查发现疑点 | 任一命中才派 `arch-security-reviewer`（仅 L3）；否则不派。(a) 场景下 reviewer 复核的是**修完的 diff**（判修法本身有无留后门 / 绕过）——阻断修复与派独立 review 是先后两步，不是二选一 | 未派 → `4-arch.json` 写 `independent_review_dispatched:false` + `dispatch_reason`（未派依据） |
| 4 | 拼装 4-arch receipt（主线，无论是否派工） | reviewer 若派出只产 **findings**（不自产 receipt）；主线据 findings + lint:redlines 确定性拼装并 `Write` `4-arch.json`（含 `independent_review_dispatched` / `dispatch_reason`） | `verdict` / `verdict_suggestion=READY_TO_HANDOFF` | `NEEDS_FIX` → 按建议处理（fixup / 新 slice / 重做）。receipt 始终由主线写，杜绝散文吞 receipt |
| 5 | 翻档后（**默认主线亲做**；派 committer 时对应其第 5 步） | `cd {{devRoot}} && npm run validate:state` | 0 error | 翻档漏字段 → 补齐重跑 |
| 5 | 翻档后（对应 committer 第 6 步） | `cd {{devRoot}} && npm run render:board` | 0 退出码 | 渲染异常通常是 state schema 错位，回 validate:state 看 |
| 5 | handoff commit 后（对应 committer 第 8 步） | `git show --stat <hash>`（白名单 `git add`，禁 `git add -A`） | 仅 state/* + BOARD.html，且在所有 impl commit 之后 | 超范围 → 把 handoff commit reset，重新做 |
| 5 | 收尾（**在 pipeline-status 置 done 之后**，Stage 5 最后一道） | `cd {{devRoot}} && npm run verify:handoff <id>`（**主线亲跑**） | 8 项 check 全 ✓（L0 跳 Check 4，且非 UI 自动跳 Check 8） | 任一 ✗ → 按 check 输出修正后**主线**再跑一次（派了 committer 也不采信其自报） |
| 5 | Check 8 · UI fidelity 硬闸（v5.5） | verify:handoff 内含：有 `work/<id>/ui/` mockup 目录的工单读 `3.5-ui-fidelity.json` | `verdict=PASS`，或显式 `deferred_to_backlog`+`backlog_ref`，或 `reason_category=env-blocked`+证据 | 缺 receipt / 非 PASS 且无顺延证据 → handoff fail；render-diff 与测试绿并列必要，杜绝「测试绿但屏幕上不像」翻 Done |
| 0 | roadmap-planner Triage 段 | 主线读 `<devRoot>/work/<slugDir>/<receiptsDir>/0-triage.json` | `level ∈ {L0,L1,L2,L3}`；`reasons[]` 非空 | level 缺或为空 → 打回 planner 重打标 |
| M | Stage 5 handoff 后 | `cd {{devRoot}} && npm run milestone:status <milestone> -- --json` | `boundary_reached=true` 才进入 E2E；`next_action=skip_e2e_disabled` 时跳过 E2E 不报错 | 脚本未到边界 → 回 per-ticket pipeline；脚本异常 → 先修 state/config |
| M | E2E acceptance（可选） | 主线读 `<reportsDir>/e2e-<milestone>.json` + 跑 `e2e.e2eCommands` | `overall_verdict=PASS` + `e2e_regression_green=true` + 人类可读报告存在 | FAIL → 按 `(milestone, journey_id)` 去重生成/复用 Planned 修复工单；`e2e_rerun_count > maxRerun` → Manager Override |
| × | 任意 sub-agent 自报 `blocked: true` | 主线读 receipt `blocked_evidence` 字段 | 非空 + 具体引用（路径 / grep 结果 / 测试输出） | 空 evidence → 视为偷懒早退，原 stage 重派一次（不计入 attempt） |
| × | 任意 Agent 返回后（**先于 gate 判定**） | 主线解析末条消息能否成本 stage 的 receipt envelope | 可解析（stage_id/level/attempt 齐） | 不可解析（散文/报错/空/截断）= **交付失败**（不变量 10）→ fresh 重派 1 次 → 仍不可用主线内联接手（标 `dispatch_recovery`）→ 才 Manager Override；**不计入 gate attempt**，不在前两步惊动用户。真 hang 不在范围（依赖 harness 超时回收） |
| 5 | **跑 verify:handoff 之前**（主线写 pipeline-status，不变量 8） | `cat <devRoot>/work/<slugDir>/<receiptsDir>/pipeline-status.json` | `status: "done"` + `escalation_pack: null` | 仍 escalation → 不允许 handoff，回 Manager Override 再处理。漏写 done 会让 verify Check 7 必挂 |

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
| `downgrade` | 发现工单实际复杂度低于初判 | **Gate 6（level branch 重判）**（不直跳 S3） | 改 `0-triage.json.level`（如 L3→L2）；customer-visible 记录降档 |
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

1. **"先做了再说，测试有空再补"**：跳过 Step 1 失败测试 → Step 2 实现进去，测试变成证明实现已写好的"摆设"，遇到 bug 时测试不报错。**反制**：`behavior-change` 切片硬要求 Step 1 测试先红且红在断言上；`new-module` 切片允许同批落地但断言必须覆盖 spec §7 并跑绿——两型都不接受"只证明文件不存在"的 `ERR_MODULE_NOT_FOUND` 式红。
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
