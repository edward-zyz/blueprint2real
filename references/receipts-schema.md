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
  "stage_id": "<0-triage | 1-planner | 1.5-ui-anchor | 2.0-ui-design | 2a-spec | 2b-plan | 2c-review | 3-impl | 3.5-ui-fidelity | 4-arch | 5-handoff | e2e-acceptance>",
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
  "reasons": ["分支4: 3 文件(与 files_estimated 一致) · 新增 helper 函数 · 无跨模块边界变化"],
  "files_estimated": ["<相对项目根>"],
  "ui": <boolean>,
  "ui_match_evidence": ["<命中 uiPaths 的文件或判定理由>"]
}
```

`reasons[]` 每条必须引用 triage 决策树的分支号 + 工单事实；主线机械核 level vs `files_estimated.length` 自洽（L1 ⇒ 恰 1 文件，L0/L2 ⇒ ≤3 文件），矛盾即打回重判。`files_estimated` 与 `ui_match_evidence` 均使用 projectRoot 相对路径。`workflow.config.ui.uiPaths` 也按 projectRoot 相对 glob 解释，避免和 `b2r-process/` devRoot 混淆。

### 1-planner.json

```json
{
  ...envelope (stage_id: "1-planner", level: null),
  "workIds": ["<workId>"],
  "levels": { "<workId>": "<level>" },
  "ui_intent_detected": false,
  "ui_paths_stale_suspected": false,
  "ui_paths_stale_evidence": {
    "uiPaths_current": ["web/src/views/foo/**"],
    "intent_temp_keys": ["T1", "T2"],
    "intent_files": ["web/src/views/agent/Workbench.tsx", "web/src/views/agent/Mobile.tsx"]
  },
  "validate_state": "pass",
  "deps_graph": { "cycles": 0, "leaves": [...], "orphans": 0 }
}
```

UI 路由两路探测（顶层布尔，互斥）：

- `ui_intent_detected`（O15）— 本批有前端意图工单、但 config **无** `ui` 块。主线据此 `AskUserQuestion` 是否开 UI 线。
- `ui_paths_stale_suspected`（O27）— config **有** `ui` 块、但本批有前端意图的工单**无一命中** `ui.uiPaths`（疑似 uiPaths 陈旧）。为 `true` 时 `ui_paths_stale_evidence` 必须非空（携 `uiPaths_current` / `intent_temp_keys` / `intent_files`）；为 `false` 时 evidence 为 `null`。触发条件是「有前端意图 AND 该批 0 命中」的合取，纯后端批次不报。

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
  "mockup_elements": [
    { "screen": "<screen>", "key": "toolbar.search", "desc": "搜索框", "kind": "control|icon|stat|state|nav|layout", "selector_hint": ".sv-search" }
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

`mockups` 是数组，后续 spec-drafter 必须把这些路径写入 spec §4，implementor 必须把它们当 UI 实现目标。`mockup_elements`（v5.5）把每张图的可见元件逐条结构化——它是 spec §4 元件 checklist 的草稿源（spec-drafter 只做 本轮做/顺延/不做 三态标注，不手抄）与 Stage 3.5 render-diff 的比对基准。mode=delta 时必须非空。

### 2a-spec.json

```json
{
  ...envelope (stage_id: "2a-spec"),
  "spec_path": "<specsDir>/<slugDir>.md",
  "sections_filled": "11/11",
  "tbd_grep": 0,
  "file_whitelist_ls": "pass",
  "ui_mockups_referenced": true,
  "ui_elements_total": 0,
  "ui_elements_this_round": 0,
  "ui_elements_deferred": 0,
  "level_check": "matches_triage | upgrade_to_L?"
}
```

非 UI 工单 `ui_mockups_referenced` 与三个 `ui_elements_*` 都填 `null`；UI 工单 `ui_mockups_referenced` 必须为 `true`，且 `ui_elements_total == 2.0-ui-design.json.mockup_elements[].length`（§4 逐 key 对账过），`this_round + deferred == total`（每个元件都有三态归属，没有漏标——漏标=静默丢失）。

### 2b-plan.json

```json
{
  ...envelope (stage_id: "2b-plan"),
  "plan_path": "work/<slugDir>/plan.md",
  "file_range_eq_spec": true,
  "tdd_step1_described": true,
  "regression_cmds_unchanged": true,
  "sub_slice_count": <1 or N>,
  "slices": [
    { "label": "<slice 标签 or '整工单单切片'>", "inline_ok": false, "inline_ok_reason": "<标 true 时的具体依据，否则 null>" }
  ],
  "l1_self_review_verdict": "<READY_TO_IMPLEMENT | NEEDS_REVISION | null>"
}
```

L1 路径填 `l1_self_review_verdict`；L2/L3 为 null（独立 reviewer 出 2c-review）。

`slices[].inline_ok`（微切片内联通道）：plan-drafter 判定该切片「改动 ≤2 文件 且 无新增行为断言需求」（典型：只差提交、纯配置/文案、上游已验证只需落盘）时标 `true`，主线可内联完成、不派 implementor，对应 `3-impl.json` 记 `inline: true`。**拿不准就不标**，整轮 implementor 是默认。

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
  "red_gate_mode": "behavior-change | new-module",
  "inline": false,
  "failing_test_first": "pass",
  "failing_test_output": "<按 red_gate_mode 分型，见下>",
  "targeted_test": "pass",
  "regression_results": [{ "cmd": "<...>", "exit": 0 }],
  "files_changed": ["<...>"],
  "in_spec_scope": true,
  "ui_mockups_checked": true,
  "ui_element_assertions": 0
}
```

多切片工单按切片各出一份 3-impl receipt（`sub_slice` 区分）；若主线把切片汇总成 `slices[]` 数组，每个条目同样携带 `red_gate_mode` / `inline` / `failing_test_output` 三个字段，语义一致。

非 UI 工单 `ui_mockups_checked` / `ui_element_assertions` 都填 `null`；UI 工单 `ui_mockups_checked` 必须为 `true`，`ui_element_assertions` 填本轮失败测试里元件存在性断言条数（应 == spec §4 标 `本轮做` 的元件数）。

> **红门证据按切片分型（`red_gate_mode` 必填）**：
> - `"behavior-change"`（改既有行为的切片）：`failing_test_output` 必须是**断言级**红色输出关键行或 artifact 路径——期望值 vs 实际值的差异（如"期望 200 实得 404"）。`ERR_MODULE_NOT_FOUND` / `Cannot find module` 式的红**不算证据**（只证明文件不存在，是仪式不是验证），主线见到即判红门未过、打回。主线核时**grep 失败结构关键字**——非 0 退出码记录，或 `FAIL` / `Error` / `AssertionError` / `✗` 等测试框架失败关键行；"非空即过"不成立，任意散文都能骗过它。
> - `"new-module"`（从零新建模块/文件的切片）：允许 tests 与最小实现同批落地，`failing_test_output` 写明"tests+impl 同批，断言覆盖 spec §7 Tx/Ty"并附跑绿输出关键行。
>
> 两型都**不凭** `failing_test_first:"pass"` 布尔判门（布尔可被自报伪造，证据不能）。

> **`inline`（微切片内联通道）**：该切片由主线内联完成、未派 implementor 时填 `true`。前提是 plan `2b-plan.json.slices[].inline_ok == true`（改动 ≤2 文件 + 无新增行为断言需求）。内联切片同样受不变量 3 / 4 约束，红门证据字段照常填。

> **Receipt 落盘者（v5.4 O13）**：stage receipt 文件由该 stage 的 **sub-agent 自己 `Write`**（路径主线以 `{{receiptPath}}` 钉死），主线派工返回后 `test -f {{receiptPath}}` 校验存在性，不存在即判交付失败。例外见下：4-arch 由主线确定性拼装。

### 3.5-ui-fidelity.json（v5.5 · 仅 ui=true 且有 mockup 目录）

```json
{
  ...envelope (stage_id: "3.5-ui-fidelity"),
  "element_diffs": [
    { "key": "toolbar.search", "expected": "搜索框 .sv-search", "actual": "缺失", "status": "match|missing|mismatch|extra", "severity": "blocker|minor" }
  ],
  "screenshots_checked": ["work/<slugDir>/ui/impl-shots/<screen>-dark.png", "work/<slugDir>/ui/impl-shots/<screen>-light.png"],
  "reviewer_verdict": "PASS | NEEDS_FIX",
  "reason_category": "ok | env-blocked",
  "deferred_to_backlog": false,
  "backlog_ref": null,
  "fail_items": [],
  "reviewer_expectation": null,
  "escalated_to_human": false
}
```

Stage 3.5 render-diff 闸 receipt：`design-reviewer(mode=fidelity)` 把实现页截图 ↔ mockup 逐元件比对后产出，主线落盘。`verify-handoff` 的 Check 8 据此判 handoff：`reviewer_verdict=PASS`，或 `deferred_to_backlog=true`+非空 `backlog_ref`（差异显式顺延），或 `reason_category=env-blocked`+非空 `blocked_evidence`（截图取不到，已 surface 环境前置缺口）——三者之一才放行，否则不许 Done。`element_diffs` 只核 spec §4 标 `本轮做` 的元件；`顺延/不做` 的不算缺失。

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
  "independent_review_dispatched": false,
  "dispatch_reason": "<未派时写明依据；派了时写命中的条件 (a)/(b)/(c)>",
  "reviewer_expectation": null
}
```

L2 轻量路径 `skills_used` 仅含 `security-review`，不含 `architecture`；未派独立 reviewer 时 `skills_used` 可为空数组。

> **4-arch 始终由主线拼装**：即使派了 arch-security-reviewer，它也**不自产此 receipt**，只返回结构化 findings（`red_line_hits` / `security_findings` / `verdict_suggestion` / `scope_check`）。主线亲跑 `lint:redlines` + 读 findings 后**确定性拼装并 `Write` 4-arch.json**——根治 security-review skill 散文收尾挤掉 receipt 的复发坑。

> **`independent_review_dispatched` / `dispatch_reason`**：L3 的 Stage 4 默认由主线内联完成（亲跑 `lint:redlines` + 核 scope 一致性 / spec §11 对齐 / diff 面），此时填 `false` + 未派依据（如"lint:redlines 0 命中，diff 不触碰认证/授权/加密/密钥/权限/migration/计费，内联核查无疑点"）。仅命中 (a) 红线 lint 或 redlineCommands 命中 / (b) diff 触碰安全敏感面 / (c) 主线内联核查发现疑点 之一时才派独立 reviewer，填 `true` + 命中条件。L2 轻量内嵌、L1 不出本 receipt。

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

> **落盘者**：Stage 5 默认由主线亲做（白名单 `git add` → 断言双 commit 分离 → 亲跑 `verify:handoff` → 翻档），`5-handoff.json` 由**主线**落盘。仅在主线上下文吃紧或并行多单收尾时才派 handoff-committer，此时由它落盘，但主线仍须亲跑一次 `verify:handoff` 与 `git show --stat` 复核。

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
  "e2e_regression_reason_category": "green | env-blocked | quality-fail | coverage-gap",
  "acceptance_legible_status": "ACCEPTED | ACCEPTED_WITH_ENV_BLOCKED | FAILED",
  "env_blocked_reason": "<null 或环境受阻原因，如 'playwright webServer 需 MySQL+Infisical，本机 ECONNREFUSED'>",
  "e2e_command_results": [{ "cmd": "npm run test:e2e", "exit": 0 }],
  "report_path": "e2e/M1-acceptance.md",
  "evidence_dir": "e2e/evidence/M1",
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
- `e2e_regression_reason_category`：`green` ⇔ `e2e_regression_green=true`；其余三类（`env-blocked` 环境性 / `quality-fail` 质量性 / `coverage-gap` 命令未覆盖）都为 false。主线据此分流——`env-blocked` 不当质量 FAIL（surface 环境前置，见项目 runbook），`quality-fail` 才走 FAIL 闭环发修复工单
- `evidence_dir`：本验收单元结构化 evidence 子目录（每单元强制至少一份，与 milestone/group id 对齐，避免误读上一组残留）
- `fix_ticket_proposals[]` 只是提案；主线查重 `(milestone, journey_id)` 后才写 `queue.md`
- `e2e_rerun_count > workflow.config.e2e.maxRerun` 时，主线强制 Manager Override
- `acceptance_legible_status`（v5.4 O20）：面向下游静态读者（人 / CI）的单一可信结论字段——`ACCEPTED`（真绿）/ `ACCEPTED_WITH_ENV_BLOCKED`（业务旅程过、回归因环境受阻未全绿，配 `env_blocked_reason`）/ `FAILED`。让不懂 b2r 内部协议者无需理解 `PASS`+`green:false` 共存语义即可判非绕过门禁

### 单旅程 receipt（v5.4 O12 两段式段二，`mode=journey`）

存储位置：`<devRoot>/<reportsDir>/evidence/<scopeId>/<journey_id>.json`。e2e-verifier 验完单条旅程即落盘；主线汇总各旅程 receipt 拼上面的组级 receipt。

```json
{
  "journey_id": "J1",
  "verdict": "PASS | FAIL",
  "evidence_paths": ["evidence/<scopeId>/J1/<screen>.png", "..."],
  "regression_result": { "cmd": "<...>", "exit": 0 },
  "reason_category": "green | env-blocked",
  "escalated_to_human": false
}
```

> 截图**落盘即弃 base64**：图存 `evidence/<scopeId>/<journey_id>/`，receipt 与 thread 只留路径，绝不把图内容留在上下文（防 AUP 硬阻断）。verifier 被 policy/transport 硬杀时，主线据已落 evidence 内联补 `reason_category="env-blocked"` 或 `escalated_to_human=true` 的旅程 receipt，让组有尾。

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
