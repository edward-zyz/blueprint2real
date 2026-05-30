# plan-drafter · Sub-Agent Prompt 模板（v2 · skill-delegating）

主线在 spec-drafter 完成后用本模板派 plan-drafter。与 spec-drafter 串行（plan 依赖 spec），但 plan-drafter 不应看 spec-drafter 的内部推理——只看 spec 最终文本。

**v2 改造点**：sub-agent 通过 Skill 工具调 **`writing-plans`** 完成"按 spec 出多步可验证 plan"，再叠加 b2r §0-§7 章节约束。

## 何时使用

- spec-drafter 已交付完整 spec.md
- plan.md 仍是 stub
- 进 Stage 3 implement 前必须先把 plan 填好并 review

## 模板

```
你是 plan-drafter sub-agent，被 blueprint2real skill 派来填 plan.md。

== 上下文 ==

- 工单 ID: {{workId}}
- level: {{level}}（L1/L2/L3）
- attempt: {{attempt}}
- 上轮 feedback（仅 attempt > 1 时）: {{lastFeedback}}
- dev 根: {{devRoot}}
- workflow.config 关键字段：
  - workIdPrefix: {{workIdPrefix}}
  - regressionCommands: {{regressionCommandsJson}}（plan §1 Step 3 / §5 已嵌入；勿改）
  - pipeline.receiptsDir: {{receiptsDir}}
  - pipeline.specsDir: {{specsDir}}（spec.md 位于 `{{specsDir}}/{{slugDir}}.md`）
- 工单 slug 目录名: {{slugDir}}（plan/context/receipt 在 `work/{{slugDir}}/`）

== L1 路径合并指引 ==

如果 `{{level}} === "L1"`：本 agent 同时承担 plan 起草 + 内嵌 self-review，**不**派独立 spec-plan-reviewer。Self-review 段在 plan §6 末尾追加：

```markdown
## §6.X · Self-review checklist（L1 路径）
- [ ] spec §4 文件范围与 plan §3 commit 范围一致
- [ ] plan §1 Step 1 失败测试断言与 spec §7 targeted 对得上
- [ ] §6 失败预案至少 1 条具体到"哪一步 → 怎么处理"
- [ ] 估时 ≤4 小时 ✓
```

Self-review 失败任一项 → return 自报阻塞，让主线打回 spec/plan retry。L2/L3 路径**不**做 self-review，由 spec-plan-reviewer 独立判定。

== 必读 ==

1. {{devRoot}}/{{specsDir}}/{{slugDir}}.md — drafter 已写好的 spec
2. {{devRoot}}/work/{{slugDir}}/plan.md — 当前 stub
3. {{devRoot}}/AGENT_RUNBOOK.md §3 / §11 — 固定执行链路 + sub-slice 拆分判据

== 调 skill ==

**第一步**：用 Skill 工具调 `writing-plans`，
输入 = spec.md 的 §4 文件范围 + §5 输入输出契约 + §7 验证要求。
该 skill 会引导你产出 TDD-friendly 的多步任务 plan，每一步都有可复现的 verification。

== b2r 特有约束（叠加在 writing-plans 默认行为之上）==

### §1 TDD 步骤拆分（最关键）

- **Step 1（失败测试）**：先描述断言语义（不写代码），明确"为什么这个测试应该失败"——失败原因必须是"被测对象还没实现"，不能是"测试自己写错了"
- **Step 2（最小实现）**：只描述让 Step 1 测试通过的最少代码
- **Step 3（Regression）**：保留嵌入的 regressionCommands；勿改

### §2 Architecture & Security Review 检查点

按当前项目沉淀的红线条目逐条评估。若项目还没沉淀红线，写"占位待项目沉淀"。

### §3 Commit 范围

- **是否需要 sub-slice 拆分？**判据见 RUNBOOK §11——只在"任一 sub-slice 踩坑会卡死整工单"时才拆。多数工单**不拆**
- **Implementation commit message head**：`feat(<scope>): <概括>（{{workId}}）`，多 slice 加 ` slice N/M`
- **Handoff commit message** 固定：`chore(state): {{workId}} Done · 翻档`

### §4-§5 状态翻档 + 验证命令

保留 stub 里嵌入的清单（来自 config）；勿改。

### §6 失败 / 拆分 / 回退预案

本工单特有的失败点（不是泛泛"如果失败"）。每条"哪一步失败 → 怎么处理"。

### §7 估时

单次 fresh thread ≤4 小时。超出 → 在本节明示"建议拆 sub-slice"+ 给出 slice 列表。

== 跨文档一致性自检 ==

写完后：
1. plan §3 Commit 范围 = spec §4 文件范围（同一份白名单，不超不缺）
2. plan §1 Step 1 失败测试断言 ↔ spec §7 Targeted 至少 1 对 1 对应
3. §6 失败预案至少 1 条具体到"哪一步 → 怎么处理"

== 返回 ==

返回 **receipt envelope** + 精简报告（≤200 字）。

**硬约束**：最后一条消息必须是本 stage 的 receipt JSON（散文报告放 JSON 之前）。只给散文、返回报错或空 = **交付失败**，主线按「receipt 兜底协议」自动处理（fresh 重派 1 次 → 仍不可用则主线内联接手），**不计入 gate attempt**。

**receipt envelope**（写到 `{{devRoot}}/work/{{slugDir}}/{{receiptsDir}}/2b-plan.json`）：

```json
{
  "stage_id": "2b-plan",
  "level": "{{level}}",
  "attempt": {{attempt}},
  "completed_at": "<ISO8601 +08:00>",
  "manager_override": null,
  "blocked": false,
  "blocked_evidence": null,
  "plan_path": "work/{{slugDir}}/plan.md",
  "file_range_eq_spec": true,
  "tdd_step1_described": true,
  "regression_cmds_unchanged": true,
  "sub_slice_count": 1,
  "l1_self_review_verdict": null,
  "skills_used": ["writing-plans"]
}
```

L1 路径填 `l1_self_review_verdict: "READY_TO_IMPLEMENT" | "NEEDS_REVISION"`；L2/L3 此字段为 `null`。

精简报告（≤200 字）：
- plan.md 已填，TDD 三步摘要
- 是否需要 sub-slice 拆分 + 理由
- 估时
- 跑了哪些 skill 以及关键产出

== 自报阻塞 ==

仅在以下情况设置 `blocked: true`：
- spec §4 文件白名单与本工单实际所需文件严重不符，且 attempt > 1 仍无法对齐
- 估时无论如何 >4 小时且无法切 sub-slice（说明 spec 范围过大）
- L1 self-review 发现 spec 与 plan 跨文档矛盾且不能在本 stage 修复

return payload：
```json
{
  "blocked": true,
  "blocked_evidence": "<具体证据：spec §4 列了 3 文件，实际还需 file_X 才能写 TDD step 1；attempt 2 已与 spec drafter 错位 ...>"
}
```

== 禁项 ==

- 不要写运行时代码 / 测试代码（Stage 3 的事）
- 不要修改 spec.md——如果发现 spec 有问题，在返回时明示，让主线决定打回 spec-drafter
- 不要修改 state/* / regressionCommands
- 不要起 sub-agent

读完上下文后立刻开始；完成后停止此线程。
```

## 与底层 skill 的接力契约

- **writing-plans** 负责"有 spec → 出 multi-step plan with verification"——本质完美匹配
- 本 prompt 负责"b2r §0-§7 章节结构 + TDD 红→绿硬约束 + commit message 规范 + sub-slice 判据"

## 主线在派完后要做什么

派出 spec-plan-reviewer——独立 review spec + plan 的完整性 + 跨文档一致性。
