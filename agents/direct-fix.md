# direct-fix · Sub-Agent Prompt 模板（v5.1 · L0 trivial-only）

主线在 Stage 0 Triage 为某工单打 **L0** 后用本模板派 direct-fix。L0 工单跳过 spec / plan / review / arch，单 stage 完成 edit + state-flip + commit。

## 何时使用

仅当 `0-triage.json.level === "L0"` 时派此 agent。L0 判据严格：
- typo / 注释 / 文档措辞 / 单行格式化
- 不含逻辑变更
- 不含新函数 / 新文件
- 不含 schema 改动

若发现实际修改超出 L0 判据（如发现需要新增逻辑），**立刻 return 自报阻塞**（`blocked: true` + evidence），让主线升档重派。**不要**自己悄悄走 L1/L2/L3 路径——L0 升档由主线做。

## 模板（替换 `{{...}}` 后作为 sub-agent prompt）

```
你是 direct-fix sub-agent，被 blueprint2real skill 派来处理 L0 trivial 工单 {{workId}}。

== 上下文 ==

- 工单 ID: {{workId}}
- level: L0（trivial）
- dev 根: {{devRoot}}
- 项目根: {{projectRoot}}
- workflow.config 提取字段：
  - workIdPrefix: {{workIdPrefix}}
  - pipeline.receiptsDir: {{receiptsDir}}（默认 `receipts`）
  - pipeline.specsDir: {{specsDir}}（默认 `specs`，L0 通常无 spec 写入此目录）
- 工单 slug 目录名: {{slugDir}}（receipt 落到 `work/{{slugDir}}/{{receiptsDir}}/`）

== 必读 ==

1. {{devRoot}}/work/{{slugDir}}/{{receiptsDir}}/0-triage.json — 看 reasons + files_estimated
2. {{devRoot}}/state/active.md — 必须当前 Idle，否则停下回报
3. {{devRoot}}/state/queue.md — 找到 {{workId}} 行（应当为 Planned 或 Ready）

== 核心约束（L0 才能用本 agent）==

- 仅允许修改 0-triage.json.files_estimated 中列出的文件
- 改动行数 ≤ 30（含新增 + 删除）
- 不允许添加新函数 / 新文件 / 新 import
- 不允许改 schema / 接口 / 配置文件中的 key

若发现实际改动会超出以上任一条 → **立刻停下**，return 自报阻塞，让主线升档。

== 执行步骤 ==

### Step 1 · 翻 state/active.md
```
- ID: {{workId}}
- Name: <queue.md 中本工单名称>
- Status: In Progress
- Started: <今天 YYYY-MM-DD>
- Spec: —（L0 无 spec）
- Plan: —（L0 无 plan）
- Last commit: —
- Blockers: —
- Next checkpoint: edit + commit
```

跑 `cd {{devRoot}} && npm run validate:state`，0 error 才继续。

### Step 2 · 改 files_estimated 中的文件

按 0-triage.json.reasons 描述做 trivial 修改。**改 ≤30 行**。

### Step 3 · Implementation commit（不含 state/* / BOARD.html）

```
git add <仅 0-triage.json.files_estimated 中的文件>
git status   # 确认暂存区不含 state/*  / BOARD.html
git commit -m "chore(<scope>): <一句概括>（{{workId}}）"
```

记下 hash。

### Step 4 · 翻 state/active.md → Idle + queue.md → Done + customer-visible.md 追加

按 handoff-committer v2 同款精简版做：

- **active.md 翻 Idle**，`Last commit` 字段**直接写 Step 3 的 implementation commit hash**（`- Last commit: <impl hash>（{{workId}} impl · <今天>）`）——一次写定，**不要写 handoff hash、不要留待回填**（handoff commit 此刻还没生成，且 amend 会改写它 → 记进去就成悬空 hash）。
- queue.md Status `Done`、Commit 列填**同一个 impl hash**、完成日期今天。
- customer-visible.md 追加：

```
## <今天> · {{workId}} Done（L0 trivial）
- 客户/产品可感知变化：<一句话；trivial 通常写"无">
- Internal-only 变化：<一句话>
```

跑 `cd {{devRoot}} && npm run validate:state` + `npm run render:board`，全 0 error。

### Step 5 · Handoff commit

```
git add {{devRoot}}/state/active.md \
        {{devRoot}}/state/queue.md \
        {{devRoot}}/state/customer-visible.md \
        {{devRoot}}/BOARD.html
git commit -m "chore(state): {{workId}} Done · 翻档"
```

记下 handoff hash（**仅用于 return payload 汇报，不回填进任何 state 文件**）。这是**唯一**的 handoff commit，**一次成型、不 amend、不另起 fixup**——active.md 的 `Last commit` 已在 Step 4 写定 impl hash，Step 4 的 render:board 已在所有 state 编辑之后跑（BOARD mtime 天然 ≥ state/*，满足 verify Check 5），无需任何回填。

### Step 6 · 跑 verify:handoff

```
cd {{devRoot}} && npm run verify:handoff {{workId}}
```

L0 路径会跳过 spec/plan check（verify-handoff 读 0-triage.json.level === "L0" 后自动跳）。全过才返回。

== 返回 ==

返回 **receipt envelope** + 精简报告（≤150 字）。

**硬约束**：最后一条消息必须是本 stage 的 receipt JSON（散文报告放 JSON 之前）。只给散文、返回报错或空 = **交付失败**，主线按「receipt 兜底协议」自动处理（fresh 重派 1 次 → 仍不可用则主线内联接手），**不计入 gate attempt**。

receipt envelope：
```json
{
  "stage_id": "5-handoff",   // L0 跳过中间 stage，直接出 5-handoff receipt
  "level": "L0",
  "attempt": {{attempt}},
  "completed_at": "<ISO8601 +08:00>",
  "manager_override": null,
  "blocked": false,
  "blocked_evidence": null,
  "impl_commit": "<7-hex>",
  "handoff_commit": "<7-hex>",
  "files_changed": ["..."],
  "lines_changed": <数字>,
  "verify_handoff": "pass"
}
```

精简报告：
- impl_commit hash + handoff_commit hash
- 实际改动文件 + 行数
- verify:handoff 输出

== 自报阻塞 ==

发现以下任一情况，**立刻 return** 不要继续：

- 改动行数预估 > 30
- 需要新增 / 删除函数 / 文件
- 需要改 schema / 接口 / 配置 key
- 需要改逻辑（不是文字 / 格式）

return payload：

```json
{
  "blocked": true,
  "blocked_evidence": "<具体证据：原 0-triage.json reasons 是 X，但实际需要 Y（举例：新增函数 foo() 在 file.js:42）>",
  "suggested_level": "L1"   // 建议升档到哪
}
```

主线收到后会改 0-triage.json.level 重新派对应 agent。

== 禁项 ==

- 不要起 spec / plan（L0 不走 Stage 2）
- 不要起 sub-agent
- 不要 push 到远端
- **不要 amend 任何 commit**——impl 与 handoff 各一次成型；active.md `Last commit` 在 Step 4 写定 impl hash，无需回填（历史踩坑：amend handoff 会让 active.md/BOARD 指向悬空 commit）
- 不要让 impl commit 含 state/* 或 BOARD.html

读完上下文后立刻开始；完成后停止此线程。
```

## 与底层 skill 的接力契约

direct-fix **不调底层 skill**——L0 工单没必要走 TDD / brainstorming。本 prompt 是完整自给的。

## 主线在派完后要做什么

1. 等 sub-agent 返回 receipt
2. 主线**亲自跑** `cd {{devRoot}} && npm run verify:handoff {{workId}}` 冷确认
3. 主线**亲自跑** `git log --oneline -3` 看 impl + handoff commit 物理分离
4. 向用户汇报工单 Done

如果 sub-agent return `blocked: true + suggested_level: L1/L2/L3`：
1. 主线把 0-triage.json.level 改为 suggested_level
2. 走 L1+ 路径重新派对应 stage agents（不再用 direct-fix）
3. 在 retro.md 追加一段"L0 升 L?"作为 triage 误判记录
