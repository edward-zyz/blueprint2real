# Receipts Schema · v5.1 · stage 间硬证据

> 何时读本文：派 sub-agent 时把 receipt 路径作为 prompt 字段传入；接到 sub-agent return 后把 envelope 落盘。

## 概念

**Receipt** 是 sub-agent 完成 stage 后必须返回的结构化产物，作为下一 stage 的输入证据。主线 thread **不**信任 sub-agent 的自然语言报告——以 receipt JSON 中的字段值为准。

存储位置：`<devRoot>/work/<slugDir>/<receiptsDir>/<stage_id>.json`

`receiptsDir` 默认 `receipts`，可通过 `workflow.config.pipeline.receiptsDir` 配置。

## 通用 envelope（所有 receipt 必含）

```json
{
  "stage_id": "<0-triage | 1-planner | 2a-spec | 2b-plan | 2c-review | 3-impl | 4-arch | 5-handoff>",
  "level": "<L0 | L1 | L2 | L3 | null>",
  "attempt": <number, 1-based>,
  "completed_at": "<ISO8601 +08:00>",
  "manager_override": <null | { "gate": "<GateN>", "decision_path": "<rel path>", "action": "<action>" }>,
  "blocked": <boolean>,
  "blocked_evidence": <string | null>,
  "skills_used": ["<skill name>", ...]
}
```

所有路径相对 `<devRoot>/work/<slugDir>/`（spec 例外：`<devRoot>/<specsDir>/<slugDir>.md`）。

`<slugDir> = <workId>_<slug-of-title>`，由 `workItemSlug({ workId, title })`（见 `bootstrap/workflow/scripts/config.mjs`）确定。例：`IS-001_RUNBOOK-加-Manager-Override-接手段`。

## 每 stage 的 payload 字段

### 0-triage.json

```json
{
  ...envelope (stage_id: "0-triage"),
  "reasons": ["<判据原文>"],
  "files_estimated": ["<相对项目根>"]
}
```

### 1-planner.json

```json
{
  ...envelope (stage_id: "1-planner", level: null),
  "workIds": ["<workId>"],
  "levels": { "<workId>": "<level>" },
  "validate_state": "pass",
  "deps_graph": { "cycles": 0, "leaves": [...], "orphans": 0 }
}
```

### 2a-spec.json

```json
{
  ...envelope (stage_id: "2a-spec"),
  "spec_path": "<specsDir>/<slugDir>.md",
  "sections_filled": "11/11",
  "tbd_grep": 0,
  "file_whitelist_ls": "pass",
  "level_check": "matches_triage | upgrade_to_L?"
}
```

### 2b-plan.json

```json
{
  ...envelope (stage_id: "2b-plan"),
  "plan_path": "work/<slugDir>/plan.md",
  "file_range_eq_spec": true,
  "tdd_step1_described": true,
  "regression_cmds_unchanged": true,
  "sub_slice_count": <1 or N>,
  "l1_self_review_verdict": "<READY_TO_IMPLEMENT | NEEDS_REVISION | null>"
}
```

L1 路径填 `l1_self_review_verdict`；L2/L3 为 null（独立 reviewer 出 2c-review）。

### 2c-review.json（仅 L2/L3）

```json
{
  ...envelope (stage_id: "2c-review"),
  "verdict": "<READY_TO_IMPLEMENT | NEEDS_REVISION>",
  "fail_items": ["<具体哪条不通过>"],
  "concerns": ["<可接受的警告>"],
  "lint_redlines_hits": 0,
  "redline_human_audit": "<pass | hit>",
  "target_stage_if_revision": "<2a-spec | 2b-plan | null>",
  "reviewer_expectation": "<一句话告诉 retry agent 期望>"
}
```

`target_stage_if_revision` 路由 retry 回哪个 stage。同时涉及 spec 和 plan 时优先回 2a-spec。

### 3-impl.json

```json
{
  ...envelope (stage_id: "3-impl"),
  "sub_slice": "<label or '整工单单切片'>",
  "impl_commit": "<7-hex>",
  "failing_test_first": "pass",
  "targeted_test": "pass",
  "regression_results": [{ "cmd": "<...>", "exit": 0 }],
  "files_changed": ["<...>"],
  "in_spec_scope": true
}
```

### 4-arch.json（L3 完整 / L2 轻量；L1 不出）

```json
{
  ...envelope (stage_id: "4-arch"),
  "verdict": "<READY_TO_HANDOFF | NEEDS_FIX>",
  "fail_items": [],
  "concerns": [],
  "scope_consistency": "pass",
  "lint_redlines_hits": 0,
  "redline_human_audit": "pass",
  "implementation_quality": "pass",
  "section11_alignment": "pass",
  "reviewer_expectation": null
}
```

L2 轻量路径 `skills_used` 仅含 `security-review`，不含 `architecture`。

### 5-handoff.json

```json
{
  ...envelope (stage_id: "5-handoff"),
  "impl_commit": "<7-hex>",
  "handoff_commit": "<7-hex>",
  "amend_used": true,
  "verify_handoff_checks": "<X/Y pass>",
  "milestone_flipped": "<milestone or null>",
  "next_suggested_workid": "<workId or null>"
}
```

L0 路径 `verify_handoff_checks` 写 `6/6 pass (skip Check 4 spec/plan)`。

## pipeline-status.json（工单维度状态）

存储位置：`<devRoot>/work/<slugDir>/<receiptsDir>/pipeline-status.json`
**主线 thread 单写者**（sub-agent 通过 return payload 上报字段值，主线落盘）。

```json
{
  "workId": "<workId>",
  "level": "<L0 | L1 | L2 | L3>",
  "started_at": "<ISO8601 +08:00>",
  "current_stage": "<stage_id>",
  "current_attempt": <number, 1-based>,
  "max_retry": <number, from config>,
  "status": "<in_progress | blocked | done>",
  "blocked_reason": "<string or null>",
  "escalation_pack": <null | { "rendered_at": "<ISO>", "triggers": ["..."] }>,
  "manager_override_count": <number>,
  "last_feedback": <null | {
    "from_gate": "<GateN>",
    "fail_items": ["..."],
    "reviewer_expectation": "..."
  }>
}
```

**字段语义**：

- `current_attempt`：当前 stage 的尝试次数，1 = 首次，2 = 已重试 1 次
- `status`：单工单粗粒度状态（in_progress 含正常推进 + retry 进行中；blocked 含 retry 用尽待 manager / sub-agent 自报阻塞）
- `escalation_pack`：在 Manager Override 流程进行时非 null；manager-decision 落盘后清回 null
- `last_feedback`：retry 时主线写入；fresh sub-agent 读这个字段做针对性修正——**不**再写独立 feedback-receipt.json 文件
- `manager_override_count`：本工单历次 override 次数累计

## manager-decision-<timestamp>.json

存储位置：`<devRoot>/work/<slugDir>/<receiptsDir>/manager-decision-<timestamp>.json`

```json
{
  "decision_id": "<workId>-<timestamp>",
  "escalation_triggers": ["<retry exhausted | self-blocked | gate-8-fail>"],
  "decided_at": "<ISO8601 +08:00>",
  "decided_by": "<user identifier>",
  "action": "<accept-override | downgrade | shrink-scope | split-slice | drop>",
  "reasoning": "<用户给的理由 (用户拒答时填 'auto-defer')>",
  "action_params": {
    "override_gate": "<GateN>",
    "force_verdict": "<READY_TO_IMPLEMENT or ...>",
    "new_level": "<for downgrade>",
    "shrink_to_new_workId": "<for shrink-scope>",
    "sub_slices": ["..."]
  },
  "followup_required": ["<customer-visible.md 必须明示 manager-override>", ...]
}
```

`decided_by` 通常从主线已知的用户身份填（如 `userEmail` 派生）；不强制人工录入。

## 主线落盘契约

1. **派 sub-agent 时**：把上一份 receipt 路径作为 prompt 占位字段（`{{lastReceipt}}` / `{{lastFeedback}}`）传入
2. **接到 sub-agent return 时**：
   - 校验 envelope 必填字段
   - 校验 `blocked === true` 时 `blocked_evidence` 非空（空 = 偷懒，原 stage 重派不计入 attempt）
   - 把 receipt JSON 写到 `<devRoot>/work/<slugDir>/<receiptsDir>/<stage_id>.json`
   - 更新 `pipeline-status.json`（current_stage / current_attempt / status / last_feedback）
3. **Gate 校验时**：读 receipt + payload，跑对应脚本（参考 `quality-gates.md` 节点清单）
4. **进入 Manager Override 时**：渲染 escalation-pack 给用户（即时，不持久化为 .md），用户拍板后落盘 `manager-decision-<ts>.json` + 追加 `state/retro.md`

## 与 state/* 的边界

`state/*.md` 是工单**生命周期**事实源（active / queue / customer-visible / roadmap / retro）。

`receipts/*.json` 是工单**执行过程**审计追溯（每 stage 的 verdict / attempt / blocked / skills_used）。

两者**不相互覆盖**：
- 同一信息（如 commit hash）在两处都出现是 OK 的（state 给人读，receipt 给 gate 校验）
- 但**单一事实源**仍是 state/*——冲突时以 state/* 为准
