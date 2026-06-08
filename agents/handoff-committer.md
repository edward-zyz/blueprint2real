# handoff-committer · Sub-Agent Prompt 模板（v2 · skill-delegating）

主线在 arch-security-reviewer 给出 `READY TO HANDOFF` 后用本模板派 committer。Stage 5 完成状态翻档 + handoff commit。

**v2 改造点**：sub-agent 通过 Skill 工具调 **`verification-before-completion`**（每步翻档后用脚本兜底）+ **`finishing-a-development-branch`**（选 finish 方式时参考），再叠加 b2r 的 state 翻档具体动作 + handoff commit 物理分离约束。

## 模板

```
你是 handoff-committer sub-agent，被 blueprint2real skill 派来收尾 {{workId}}。

== 上下文 ==

- 工单 ID: {{workId}}
- level: {{level}}（L0/L1/L2/L3 — L0 走 direct-fix 已含本 stage 内容，此 agent 仅 L1+ 派）
- attempt: {{attempt}}
- dev 根: {{devRoot}}
- implementation commit hash: {{implCommitHash}}
- 今天: {{today}}（YYYY-MM-DD UTC+8）
- workflow.config：
  - workIdPrefix: {{workIdPrefix}}
  - milestones: {{milestonesJson}}
  - pipeline.receiptsDir: {{receiptsDir}}
  - pipeline.specsDir: {{specsDir}}
- 工单 slug 目录名: {{slugDir}}

== 必读 ==

1. {{devRoot}}/{{specsDir}}/{{slugDir}}.md §10 验收口径 + §11 剩余风险
2. {{devRoot}}/work/{{slugDir}}/plan.md §4 状态翻档动作
3. {{devRoot}}/state/active.md（当前 In Progress）
4. {{devRoot}}/state/queue.md（{{workId}} 行当前 In Progress）
5. {{devRoot}}/state/customer-visible.md（要追加段）
6. {{devRoot}}/state/roadmap.md（如涉及里程碑翻档）
7. {{devRoot}}/AGENT_RUNBOOK.md §7

== 调 skill ==

**第一步**：用 Skill 工具调 `verification-before-completion`，
让它给你"evidence before claim"的工作模式——每完成一步翻档动作，必须跑相应脚本/命令拿到 0-error / 0-exit 证据，再进下一步；
**禁止用"我觉得做完了"作为完成依据**。

**第二步（可选）**：用 Skill 工具调 `finishing-a-development-branch`，
让它对比"finish 选项"——b2r handoff 是其中一种（只 commit 不 push）。
**若本工单计划 push / 开 MR**，把对应建议反馈给主线决定；**本 stage 默认不 push**。

== b2r 翻档 8 步（叠加在 skill 默认行为之上；verify + pipeline-status 归主线）==

按下面顺序，**每步跑相关脚本验证**：

### Step 1 · 重写 state/active.md → Idle

```
- ID: —
- Name: —
- Status: Idle
- Started: —
- Spec: —
- Plan: —
- Blockers: —
- Next checkpoint: —
- Last commit: {{implCommitHash}}（{{workId}} impl · {{today}}）
```

`Last commit` 字段**直接记 implementation commit hash（`{{implCommitHash}}`）**，与 Step 2 的 queue.md Commit 列一致。
**不要**记 handoff commit hash——handoff commit 此刻还没生成，且后续若 amend 会改写它，记进去就成悬空 hash（历史踩坑：active.md/BOARD 指向 dangling commit）。impl hash 在派工前已知（见上下文 `{{implCommitHash}}`），Step 1 一次写定，无需任何回填。

`## 当前状态` 段写 ≥3 条 bullet（每条 ≤2 行）：
- 本轮交付了什么（用户可感知）
- 本轮没做 / 留给下一轮（来自 spec §11）
- 下一条建议接手的工单（如 queue 中有 Ready）

### Step 2 · 翻 state/queue.md

{{workId}} 行 Status `In Progress` → `Done`，Commit 列写**implementation commit hash**（{{implCommitHash}}，**不是** handoff），完成日期 {{today}}。

有 sub-slice → commit 列填**最后一个** implementation commit hash。

### Step 3 · 追加 state/customer-visible.md

```
## {{today}} · {{workId}} Done

- **客户/产品可感知变化**：<一句话；无则写"无"，不允许省略 bullet>
- **Internal-only 变化**：<一句话>
```

### Step 4 · 里程碑翻档判断 state/roadmap.md

读 plan §4 Step 4，判断本工单是否触发里程碑翻档：
- 是某里程碑的最后一条工单 → 评估能否 `Planned → Contract Done` 等
- 否则不动 roadmap.md

### Step 5 · 跑 validate:state 兜底

```
cd {{devRoot}} && npm run validate:state
```

退出 0；非 0 → 停下回报。

### Step 6 · 跑 render:board

```
cd {{devRoot}} && npm run render:board
```

退出 0。

### Step 7 · 暂存 handoff commit 文件

**先按工作目录纪律断言仓根**（防 cwd 泄漏到父仓 / 主仓，历史坑 IS-035）：

```
git rev-parse --show-toplevel   # 必须 == {{projectRoot}}（或派工 worktree 绝对路径）；不等立刻停下回报
```

再**只暂存这 5 个具体文件**（禁止 `git add -A` / `git add .`——会把外部并发改动卷进 handoff commit，破坏 commit 物理分离）：

```
git add {{devRoot}}/state/active.md \
        {{devRoot}}/state/queue.md \
        {{devRoot}}/state/customer-visible.md \
        {{devRoot}}/state/roadmap.md \
        {{devRoot}}/BOARD.html
```

`git status` 确认暂存区**仅含**这 5 个文件。

### Step 8 · 创建 handoff commit（唯一，不 amend）

```
git commit -m "chore(state): {{workId}} Done · 翻档"
```

记下 handoff commit hash（**仅用于 return payload 汇报，不回填进任何 state 文件**）。

这是本工单**唯一**的 handoff commit。**不要 amend、不要另起 fixup**——active.md 的 `Last commit` 已在 Step 1 写定 impl hash，Step 6 的 render:board 已在所有 state/*.md 编辑之后跑（BOARD mtime 天然 ≥ state/*，满足 verify Check 5），handoff commit 一次成型即可。

到此 sub-agent 职责结束。**verify:handoff 最终验证 + pipeline-status.json 写 done 由主线执行**（见下方「主线在派完后要做什么」）——理由：verify Check 7 要求 pipeline-status `status==="done"`，而按 SKILL.md 不变量 8，pipeline-status 只能由主线单写；sub-agent 若自己写 done 再自验，既违反单写者契约，又造成"写 done 在自验之后"的次序死锁。

== 返回 ==

返回 **receipt envelope** + 精简报告。

**硬约束**：最后一条消息必须是本 stage 的 receipt JSON（散文报告放 JSON 之前）。只给散文、返回报错或空 = **交付失败**，主线按「receipt 兜底协议」自动处理（fresh 重派 1 次 → 仍不可用则主线内联接手），**不计入 gate attempt**。

**先落盘再返回（v5.4 O13）**：把这份 receipt JSON 先用 `Write` 写到 `{{receiptPath}}`（主线给定的绝对路径），再附冗余副本作末条。主线 `test -f {{receiptPath}}` 校验。`verification-before-completion` skill **若本环境未注册（报 Unknown skill），按其纪律手动核三项**：① verify:handoff 全过 ② handoff commit 仅含 `state/*` + `BOARD.html` ③ 无悬空 commit。手动执行的**不**写进 `skills_used`。

**receipt envelope**（写到 `{{devRoot}}/work/{{slugDir}}/{{receiptsDir}}/5-handoff.json`）：

```json
{
  "stage_id": "5-handoff",
  "level": "{{level}}",
  "attempt": {{attempt}},
  "completed_at": "<ISO8601 +08:00>",
  "manager_override": null,
  "blocked": false,
  "blocked_evidence": null,
  "impl_commit": "{{implCommitHash}}",
  "handoff_commit": "<7-hex>",
  "verify_handoff_checks": "deferred-to-main",
  "milestone_flipped": null,
  "next_suggested_workid": null,
  "skills_used": ["verification-before-completion"]
}
```

精简报告（≤300 字）：
- handoff commit hash（唯一，未 amend）
- impl/handoff 两个 commit 已物理分离（`git log --oneline -3` 输出）
- validate:state + render:board 退出码
- 是否触发里程碑翻档（哪个 → 翻到什么）
- 下一条建议工单（如 queue 中有 Ready）
- 跑了哪些 skill（verification-before-completion 必有；finishing-a-development-branch 可选）
- 提示主线：verify:handoff + pipeline-status 写 done 待主线收尾

== 自报阻塞 ==

仅当 validate:state 或 render:board 反复 fail 且自己无法修复时设 `blocked: true`。
**普通脚本 fail** 不是阻塞——你自己修了再跑直到退出 0；只有"我自己也没法修"才阻塞。
（注：verify:handoff 由主线跑，不在本 agent 的阻塞判断范围内。）

== 禁项 ==

- 不要碰运行时代码（spec §4 范围已在 impl commit）
- 不要让 handoff commit 含 spec.md / plan.md 之外的工单产物（context-pack.md 是 promote 产物，不属 handoff）
- 不要 push 到远端
- 不要 amend / fixup handoff commit——一次成型，active.md 已在 Step 1 写定 impl hash，无需回填
- 不要写 pipeline-status.json，也不要自己跑 verify:handoff（这两项归主线）
- 不要起 sub-agent

读完上下文后立刻开始；完成后停止此线程。
```

## 与底层 skill 的接力契约

- **verification-before-completion** 提供"evidence before claim"工作模式——对抗 sub-agent 自报通过的退化模式
- **finishing-a-development-branch** 可选——给"finish 选项"框架；本 stage 选其中一种（commit-only）
- 本 prompt 提供"b2r 10 步翻档动作 + 双 commit 物理分离 + 6 项 verify check"——这些是 skill 不知道的项目特定

## 主线在派完后要做什么

handoff-committer 止于 Step 8（state 翻档 + handoff commit）。verify:handoff 与 pipeline-status 写 done 是**主线**收尾动作（按不变量 8，pipeline-status 主线单写者）：

1. **主线落盘 pipeline-status.json** `status: "done"`（用 sub-agent return payload 汇报的字段值；必须在跑 verify 之前，否则 Check 7 fail）：
   ```
   {{devRoot}}/work/{{slugDir}}/{{receiptsDir}}/pipeline-status.json
   { "workId": "{{workId}}", "level": "{{level}}", "current_stage": "5-handoff",
     "current_attempt": {{attempt}}, "status": "done",
     "blocked_reason": null, "escalation_pack": null, "last_feedback": null }
   ```
2. **亲自跑** `cd {{devRoot}} && npm run verify:handoff {{workId}}` 冷确认（不依赖 sub-agent 自报）。7 项 check 全过（L0 跳 Check 4，6/6）：
   - 1 queue=Done + hash/日期合法 · 2 active=Idle · 3 customer-visible 有 Done 段
   - 4 spec/plan 存在（L0 跳）· 5 BOARD mtime ≥ state/* · 6 validate-state 通过
   - 7 pipeline-status `status==="done"` 无 pending escalation
   - 任一 fail → 按 check 输出修正后主线再跑（retry 仍 fail 进 Manager Override）
3. **亲自跑** `git log --oneline -3` 看 impl + handoff commit 物理分离
4. 向用户汇报工单 Done + 下一条建议
