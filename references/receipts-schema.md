# Receipts Schema · v5.1 · stage 间硬证据

> 何时读本文：派 sub-agent 时把 receipt 路径作为 prompt 字段传入；接到 sub-agent return 后把 envelope 落盘。

## 概念

**Receipt** 是 sub-agent 完成 stage 后必须返回的结构化产物，作为下一 stage 的输入证据。主线 thread **不**信任 sub-agent 的自然语言报告——以 receipt JSON 中的字段值为准。

存储位置：`<devRoot>/work/<slugDir>/<receiptsDir>/<stage_id>.json`

例外：UI 锚点本体是项目级事实源，写入 `<devRoot>/state/ui-anchor.md`；触发它的审计 receipt 仍落在首个触发 UI 工单的 `work/<slugDir>/<receiptsDir>/1.5-ui-anchor.json`。

例外：里程碑 E2E receipt 不属于单工单 slug，写入 `<devRoot>/<reportsDir>/e2e-<milestone>.json`；同目录的人类可读报告为 `<milestone>-acceptance.md`。

`receiptsDir` 默认 `receipts`，可通过 `workflow.config.pipeline.receiptsDir` 配置。

## 通用 envelope（所有 receipt 必含）

```json
{
  "stage_id": "<0-triage | 1-planner | 1.5-ui-anchor | 2.0-ui-design | 2a-spec | 2b-plan | 2c-review | 3-impl | 4-arch | 5-handoff | e2e-acceptance>",
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
  "files_estimated": ["<相对项目根>"],
  "ui": <boolean>,
  "ui_match_evidence": ["<命中 uiPaths 的文件或判定理由>"]
}
```

`files_estimated` 与 `ui_match_evidence` 均使用 projectRoot 相对路径。`workflow.config.ui.uiPaths` 也按 projectRoot 相对 glob 解释，避免和 `b2r-process/` devRoot 混淆。

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

### 1.5-ui-anchor.json（仅配置 ui 且首个 UI 工单触发）

```json
{
  ...envelope (stage_id: "1.5-ui-anchor"),
  "anchor_path": "state/ui-anchor.md",
  "archetype_screens": ["<screen name>"],
  "extracted_from": "existing | greenfield",
  "design_ref_source": "configured | discovered | mixed | synthesized",
  "design_refs_used": ["<configured-or-discovered-path>"],
  "discovered_design_refs": ["<path>"],
  "synthesized_design_system": false,
  "synthesis_evidence": ["<context/spec/docs evidence; synthesized 时必须非空>"],
  "ref_grep_hits": ["<designRefs 或 discovered refs 中命中的 token/组件证据>"],
  "reviewer_verdict": "PASS | NEEDS_FIX",
  "fail_items": [],
  "reviewer_expectation": null,
  "escalated_to_human": false
}
```

锚点 `PASS` 后主线继续 2.0；`NEEDS_FIX`、未主动发现、或合成证据为空走 retry-once，再失败进 Manager Override。若使用 `ui-ux-pro-max` 等通用 designSkill，`ref_grep_hits` 仍必须来自项目 `designRefs` 或主动发现的项目文件，不能用 skill 文档本身替代项目事实源。只有 `design_ref_source="synthesized"` 时允许 `ref_grep_hits` 为空，但必须设置 `synthesized_design_system=true` 且 `synthesis_evidence` 非空。

### 2.0-ui-design.json（仅 `0-triage.ui=true`）

```json
{
  ...envelope (stage_id: "2.0-ui-design"),
  "mockups": [
    { "screen": "<screen name>", "path": "work/<slugDir>/ui/<screen>.<ext>", "kind": "mockup|screenshot" }
  ],
  "inherits_anchor": true,
  "ui_novel": false,
  "design_ref_source": "configured | discovered | mixed | synthesized",
  "design_refs_used": ["<configured-or-discovered-path>"],
  "discovered_design_refs": ["<path>"],
  "synthesized_design_system": false,
  "synthesis_evidence": ["<context/spec/docs evidence; synthesized 时必须非空>"],
  "ref_grep_hits": ["<designRefs 或 discovered refs 中命中的 token/组件证据>"],
  "reviewer_verdict": "PASS | NEEDS_FIX",
  "fail_items": [],
  "reviewer_expectation": null,
  "escalated_to_human": false
}
```

`mockups` 是数组，后续 spec-drafter 必须把这些路径写入 spec §4，implementor 必须把它们当 UI 实现目标。

### 2a-spec.json

```json
{
  ...envelope (stage_id: "2a-spec"),
  "spec_path": "<specsDir>/<slugDir>.md",
  "sections_filled": "11/11",
  "tbd_grep": 0,
  "file_whitelist_ls": "pass",
  "ui_mockups_referenced": true,
  "level_check": "matches_triage | upgrade_to_L?"
}
```

非 UI 工单可填 `ui_mockups_referenced: null`；UI 工单必须为 `true`。

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
  "in_spec_scope": true,
  "ui_mockups_checked": true
}
```

非 UI 工单可填 `ui_mockups_checked: null`；UI 工单必须为 `true`。

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

### e2e-<milestone>.json（里程碑级，非工单目录）

存储位置：`<devRoot>/<reportsDir>/e2e-<milestone>.json`。同目录必须有 `<milestone>-acceptance.md` 人类可读报告。

```json
{
  ...envelope (stage_id: "e2e-acceptance", level: null),
  "milestone": "M1",
  "e2e_rerun_count": 0,
  "journeys": [
    {
      "id": "J1",
      "desc": "<业务语言旅程描述>",
      "verdict": "PASS | FAIL",
      "evidence": ["<relative evidence path>"],
      "mockup_refs": ["work/<slugDir>/ui/<screen>.<ext>"],
      "mockup_match": true
    }
  ],
  "overall_verdict": "PASS | FAIL",
  "captured_test_paths": ["<project e2e test path>"],
  "e2e_regression_green": true,
  "e2e_command_results": [{ "cmd": "npm run test:e2e", "exit": 0 }],
  "report_path": "e2e/M1-acceptance.md",
  "fix_ticket_proposals": [
    {
      "source": "e2e-fail",
      "milestone": "M1",
      "journey_id": "J3",
      "title": "<修复工单标题>",
      "summary": "<目标 / 边界 / 不做 / 验收要点 / 依赖>",
      "evidence": ["e2e/M1-acceptance.md#发现的问题"]
    }
  ],
  "escalated_to_human": false
}
```

语义：

- `journeys[]` 来自 `state/acceptance.md` 的里程碑段，并由 `customer-visible.md` 收敛到实际交付范围
- `overall_verdict=PASS` 还不够；必须同时 `e2e_regression_green=true` 才能作为 `Contract Done → Demo Ready` 翻档证据
- `fix_ticket_proposals[]` 只是提案；主线查重 `(milestone, journey_id)` 后才写 `queue.md`
- `e2e_rerun_count > workflow.config.e2e.maxRerun` 时，主线强制 Manager Override

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
