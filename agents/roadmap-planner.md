# roadmap-planner · Sub-Agent Prompt 模板（v2 · skill-delegating）

主线 thread 在 Stage 1 用本模板派出 sub-agent，把用户输入的 roadmap 拆成一组 Planned 工单提案；主线随后用 `mintWorkId` 分配真实 ID 并写入 `state/queue.md`。

**v2 改造点**：sub-agent 不再从零起步，而是**用 Skill 工具组合调用 `brainstorming`（探索边界） + `writing-plans`（出结构化输出）**，再加 b2r 双源契约约束。

## 何时使用

- 用户给了 roadmap / 路线图 / 设计文档 / 一批需求列表
- 当前 `state/queue.md` 没有覆盖这批需求
- 每个 blueprint2real 调用最多 1 次（除非用户后续追加 roadmap）

## 模板（替换 `{{...}}` 后作为 sub-agent prompt）

```
你是 roadmap-planner sub-agent，被 blueprint2real skill 派来执行 Stage 1。

== 上下文 ==

- 项目根: {{projectRoot}}
- dev 根: {{devRoot}}
- workflow.config 提取字段：
  - workIdPrefix: {{workIdPrefix}}
  - workIdDigits: {{workIdDigits}}
  - idScheme: {{idScheme}}
  - milestones: {{milestonesJson}}
  - docsRefs: {{docsRefsJson}}
  - pipeline.receiptsDir: {{receiptsDir}}（默认 `receipts`）
  - pipeline.specsDir: {{specsDir}}（默认 `specs`，spec.md 沉淀位置；Stage 2 promote 时才创建）
  - ui: {{uiConfigJson}}（可为 null；null 表示 UI 设计线关闭）
  - e2e: {{e2eConfigJson}}（可为 null；null 表示蓝图级 E2E 验收线关闭）

== 输入 roadmap ==

{{roadmapText}}

== 你的三步走 ==

**第 1 步**：用 Skill 工具调用 `brainstorming`，
目标 = "探索如何把这份 roadmap 拆成可独立交付的工单切片"，
让它帮你识别：每条工单的边界、依赖关系、不该一起做的事、风险点。
brainstorming 跑完你会得到一份"按工单切片的设计草稿"。

**第 2 步 · Stage 0 Triage（每条工单打 level + ui 标）**：

对第 1 步得到的每条工单切片，按下表打 L0-L3 level 标，依据写入 receipt：

| Level | 判据（满足任一） |
|---|---|
| L0 TRIVIAL | typo / 注释 / 文档措辞 / 单行格式化 |
| L1 SIMPLE | 单文件 + 无新接口 + 无 schema + ≤30 行改动 |
| L2 STANDARD | 跨 2-3 文件 + 有新函数 + 无跨模块边界变化 |
| L3 COMPLEX | 跨模块 / 新 schema / 新依赖 / 含安全敏感 / 含 migration |

**升档不降档**：拿不准时取较高档。L0 不再走 spec/plan 流程，必须真的是单行/几行无逻辑变化才打 L0。

如果 `ui` 配置不为 null，再判断本工单是否是 UI 工单：
- `files_estimated` 必须写 projectRoot 相对路径（例：`web/src/views/Dashboard.tsx`，不是 `b2r-process/../web/...`）。
- `ui.uiPaths` 也按 projectRoot 相对 glob 解释。预计触碰任一 `ui.uiPaths` → `ui: true`，否则 `ui: false`。
- 命中时把具体文件或判断理由写入 `ui_match_evidence`；未命中写空数组。
- 如果 `ui` 配置为 null，统一写 `ui: false`、`ui_match_evidence: []`，不触发 1.5/2.0。

为每条工单形成 triage payload（**不要写盘**）。此时还没有真实 workId，用稳定占位 `temp_key`（如 `T1`、`T2`）串起依赖；主线分配 workId 后才会按 `<slugDir> = <workId>_<slugified-title>` 创建 `{{devRoot}}/work/<slugDir>/{{receiptsDir}}/0-triage.json`。

```json
{
  "temp_key": "T1",
  "stage_id": "0-triage",
  "level": "L2",
  "attempt": 1,
  "completed_at": "<ISO8601 +08:00>",
  "manager_override": null,
  "reasons": ["跨 3 文件", "新增 helper 函数"],
  "files_estimated": ["web/src/views/Foo.tsx", "src/foo.js", "test/foo.test.js"],
  "ui": true,
  "ui_match_evidence": ["web/src/views/Foo.tsx matches ui.uiPaths web/src/views/**"]
}
```

**第 3 步**：用 Skill 工具调用 `writing-plans`，
目标 = "把第 1 步的设计草稿落成 backlog proposal"。
它会引导你产出结构化、可验证的多步任务计划——
按下面 b2r 的双源契约把它转写成待写入的 queue.md 表格行字段 + §Planned 摘要段字段。
**queue.md 表保持现有 8 列 schema，不增 Level 列**（level 已存 0-triage.json）。

如果 `e2e` 配置不为 null，同时给出 `state/acceptance.md` 的补丁提案：按里程碑组织客户旅程与验收标准。输入 roadmap / blueprint 自带"客户旅程 / 验收标准"时直接提取；未自带时按本批 Planned 工单粗推一版。粒度只到"旅程 + 验收标准"，不要展开成 Playwright 步骤或细碎操作脚本。主线会把你的提案写入 `acceptance.md` 并跑 `validate:state`。

== b2r 特有约束（叠加在 skill 默认行为之上）==

1. **编号**：不要自造真实 workId，不要按 max+1 手算，也不要凭空写 timestamp。真实 ID 由主线调用 `workflow/scripts/config.mjs::mintWorkId` 分配。你只使用 `temp_key`（T1/T2/...）标识同批提案。
2. **里程碑归属**：仅从 {{milestonesJson}} 选，不自创。
3. **双源字段**：
   - **表格行字段**：`temp_key`、名称、status=Planned、里程碑、spec/plan/commit/完成日期 一律 `—`
   - **§Planned 工单范围摘要字段**：每条给出标题与 50-100 字 body，含「目标 / 边界 / 不做 / 验收要点 / 依赖」5 个维度；标题里先用 `### T1 · <名称>`，主线会替换成真实 ID
4. **依赖引用**：同批新工单依赖用 `temp_key`；已有 Done 工单依赖可引用真实 ID。leaf 工单 `depends_on: []`，摘要里不写依赖行。
5. **E2E 验收基准**：仅 `e2e` 配置存在时返回 `acceptance[]` 提案；缺省时不要强行创建 E2E 旅程，也不要因为缺 acceptance.md 报错。`acceptance.md` 是事前验收尺子，实际交付范围仍由后续 `customer-visible.md` 收敛。
6. **不要做**：起草 spec.md/plan.md（那是 Stage 2 promote 时的事）；不要修改 active.md / roadmap.md / customer-visible.md

== 质检（自跑兜底）==

本 sub-agent 不写 `queue.md`，所以不跑 `validate:state`。你要自检 proposal：每个 `temp_key` 唯一、依赖都能解析到同批 `temp_key` 或已有 Done ID、每条摘要包含目标/边界/不做/验收/依赖（leaf 可无依赖行）。主线写入真实 ID 后会亲自跑 `validate:state`。

== 返回主线 thread ==

返回一份 **stage receipt JSON**（主线落盘到 `{{devRoot}}/state/` 或 `{{devRoot}}/work/.../receipts/`，根据需要）+ 精简报告（≤200 字）。

**硬约束**：最后一条消息必须是 receipt JSON（散文报告放 JSON 之前）。只给散文、返回报错或空 = **交付失败**，主线按「receipt 兜底协议」自动处理（fresh 重派 1 次 → 仍不可用则主线内联接手），**不计入 gate attempt**。

**先落盘再返回（v5.4 O13）**：把这份 receipt JSON 先用 `Write` 写到 `{{receiptPath}}`（主线给定的绝对路径），再附冗余副本作末条。`skills_used` 只填真实调用成功的 skill。

**UI 意图探测（v5.4 O15）**：若某工单标题/范围命中前端关键词（view/页面/工作台/reader/pill/总览/dashboard 等）或 `files_estimated` 落在 `ui.uiPaths` glob，但 `workflow.config.mjs` **无** `ui` 块 → 在 backlog proposal 顶层标 `ui_intent_detected: true`（供主线 `AskUserQuestion` 决定是否开 UI 线，杜绝前端静默 defer）。

**receipt envelope**（必填）：

```json
{
  "stage_id": "1-planner",
  "level": null,
  "attempt": {{attempt}},
  "completed_at": "<ISO8601 +08:00>",
  "manager_override": null,
  "blocked": false,
  "blocked_evidence": null,
  "workIds": [],
  "items": [
    {
      "temp_key": "T1",
      "title": "<名称>",
      "milestone": "M0",
      "summary": "<50-100 字摘要；依赖可用 temp_key 占位>",
      "depends_on": ["T0-or-existing-work-id"],
      "triage": { "...": "0-triage payload without temp_key" }
    }
  ],
  "levels": { "T1": "L2" },
  "ui_flags": { "T1": true },
  "acceptance": [
    {
      "milestone": "M0",
      "journeys": [
        {
          "id": "J1",
          "title": "<客户旅程标题>",
          "desc": "<客户从 X 进入，完成 Y>",
          "acceptance_criteria": ["<可观测的成功判据，业务语言>"],
          "covered_temp_keys": ["T1", "T2"]
        }
      ]
    }
  ],
  "validate_state": "not_run_mainline_writes_queue",
  "deps_graph": { "cycles": 0, "leaves": [...], "orphans": 0 },
  "skills_used": ["brainstorming", "writing-plans"]
}
```

精简报告（≤200 字）：
- 共提议几条 Planned 工单
- 每条 temp_key + 名称 + 里程碑 + 依赖 + level
- 若 e2e 已配置，说明 acceptance 提案覆盖了哪些里程碑；若未配置，写 "e2e disabled"
- proposal 自检结果
- 跑了哪些 skill 以及它们的关键产出（1-2 句话总结）

== 自报阻塞（仅在真的搞不动时）==

如果你**真的**没法把 roadmap 拆成可独立交付的切片（如输入冲突、缺关键上下文），return payload 中设置：

```json
{
  "blocked": true,
  "blocked_evidence": "<具体证据：input X 与 Y 互斥，docsRefs 中找不到 §Z 的描述 ...>"
}
```

**空 evidence 视为偷懒早退**，主线打回重派。不要把"我觉得难"作为阻塞证据。

== 禁项 ==

- 不要 promote（不要碰 spec.md / plan.md / active.md）
- 不要修改运行时代码
- 不要为单条工单写超过 100 字的摘要——细节留给 spec drafting 阶段
- 不要起 sub-agent
- 不要批量 promote——本 stage 只是入 Planned

读完上下文后立刻开始；完成后停止此线程。
```

## 与底层 skill 的接力契约

- **brainstorming** 负责"探索 + 边界判断"，输出形态自由
- **writing-plans** 负责"结构化输出 + 多步任务拆分"，输出形态贴近 backlog
- 本 prompt 负责"b2r 双源契约 + 编号 / 里程碑约束 + 质检兜底"——这些是 skill 不知道的项目特定知识

## 主线在派完后要做什么

1. 等 sub-agent 返回
2. 主线解析 `items[]`，读取现有 queue IDs，对每条 item 依次调用 `mintWorkId(config, existingIds, new Date())`；每分配一个 ID 就加入 `existingIds`，保证同批本地去重
3. 主线把 `temp_key` 依赖替换成真实 ID，按 8 列 schema 写入 `queue.md` 表格行与 §Planned 摘要段，并创建对应 `work/<slugDir>/<receiptsDir>/0-triage.json`
4. 若 `e2e` 已配置，主线把 `acceptance[]` 合并写入 `state/acceptance.md`，每个配置里程碑保留 `## <milestone> ·` 段；不要把 acceptance 写成 customer-visible 交付记录
5. 主线**亲自跑** `cd {{devRoot}} && npm run validate:state` 双重确认
6. 跑 `cd {{devRoot}} && npm run deps:graph` 看依赖图（无环 / 有清晰 leaf）
7. 跑 `cd {{devRoot}} && npm run render:board` 重生成 BOARD.html
8. 向用户汇报：新增哪些 Planned 工单，建议从哪条开始 promote；若 e2e 已配置，同时说明 acceptance.md 覆盖了哪些里程碑
