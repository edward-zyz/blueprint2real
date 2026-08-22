---
name: blueprint2real
description: Multi-agent 工作流编排器。把路线图 / roadmap / 设计文档变成一条真正 Done 的工单流水线——通过 sub-agent 分别承担 spec drafter / planner / TDD implementor / reviewer / committer 等角色，由内建质检节点（validate-state / failing-test / regression / verify-handoff）把关每一步，保证产出可回滚、可审计。当用户说「开始 IS-XXX」「promote IS-XXX」「handoff IS-XXX」「跑工单流水线」「从 roadmap 拆工单」「让 agent 团跑完这条线」「这批工单做完没有 / 能不能收官」「接着跑上次中断的批次」「给这个项目 bootstrap 一套工单流水线底盘」，或在含 b2r-process/state/、b2r-process/workflow.config.mjs（或 legacy 路径 dev/state/、dev/workflow.config.mjs）的仓库里要求"按工单走一遍"、以及换机克隆后 b2r-process 里 npm 命令报 Cannot find module 需要修底盘继续跑工单时，必须用此 skill，即使用户没有显式说 "blueprint2real"。跨模块 / 新 schema / 新依赖 / 安全敏感（计费、身份核验、写动作）的 L3 级大改动要先立工单走流水线时同样必须触发——即使用户只说「这个大活先立个工单」「这个改动涉及安全，按流程走」「这块风险高，别直接改，走一遍流程」。
---

# blueprint2real · 路线图变 Done 工单的多 Agent 编排器

`b2r-process/workflow/` 提供**事实源 + 渲染 + 状态机 + 质检脚本**这套底盘（旧项目仍可能用 `dev/`），本 skill 是按这套底盘把工作真的跑完的**调度者**：接进人类的 roadmap / blueprint，按 RUNBOOK §3 固定执行链路调度一批专门 sub-agent，每一步用脚本兜底，最后交出状态翻档完整、commit 切片干净、`verify-handoff` 通过的 Done 工单。

## 不变量（违反就停下）

任何执行者在任何阶段命中其中一条，必须**当场停下并向用户报告**，不允许"先记下，等下一轮再处理"。每条都对应历史踩过的坑，略过任一条就会退化成"看心情写代码"：

1. **exactly one active item**：`state/active.md` 同时只能持有一条 In Progress / Blocked。新工单启动前 active 必须 Idle。
2. **事实源单一**：`state/*.md` 是唯一权威；`BOARD.html` 只能由 `npm run render:board` 生成。冲突时以 state/* 为准，先停下修正状态。
3. **TDD 红门（按切片分型）**：
   - **「修改既有行为」切片**：failing test 必须先出现并跑红，且必须是**断言级红**（如"期望 200 实得 404"），才能写最小实现。照旧强制。
   - **「从零新建模块/文件」切片**：允许测试与最小实现**同批落地**，但 targeted 断言必须覆盖 spec §7 对应条目并跑绿。
   - **「无新增行为」切片**（`red_gate_mode: "no-new-behavior"`，**仅允许用于 plan 标 `inline_ok: true` 的切片**）：diff 本身不引入行为变更（纯配置 / 文案 / 上游已验证产物落盘），无对应新增断言可写。`failing_test_output` 写明「diff 无行为变更 + 改动由既有测试 / 上游切片的 targeted 绿输出覆盖」并**附具体引用**（既有测试文件与用例名，或上游切片的 receipt 路径 + 绿输出关键行）。**空口声称"没有行为变更"不算证据**。
   - `ERR_MODULE_NOT_FOUND` / `Cannot find module` 式的红**不算**红门证据——它只证明文件不存在，是仪式不是验证。
   - 前两型都禁止"实现写完了、测试只是事后补的摆设"：断言必须能捕获行为回归。
4. **commit 物理分离 + 工作目录隔离**：implementation commit 不含 `state/*` / `BOARD.html`；handoff commit 唯一，且仅含 `state/*` + `BOARD.html`，位于所有 impl commit 之后。做 impl / handoff 的执行者（sub-agent 或主线自己）首条动作强制 `cd <仓根绝对路径>`（worktree 派工则为该 worktree 路径），commit 前断言 `git rev-parse --show-toplevel` == 仓根、且 `git add` 只列白名单具体文件（禁 `git add -A`）。**sub-agent 跑长任务期间，不要在同一 working tree 并发跑外部 `git add -A` / commit**，否则会污染该工单的 commit 边界。
5. **前置 Done 后才能 promote**：Planned → Ready 的前提是依赖工单全部 Done，否则 spec/plan 基于"规划想象"，必失真。
6. **架构红线触发即停**：`workflow/scripts/lint-redlines.mjs::RULES` 中任一规则命中，当前轮不带病往下走。
7. **自报阻塞必须带证据**：sub-agent 被允许"自报搞不动了"短路直进 Manager Override，但 return payload 必须含非空 `blocked_evidence`（具体 grep / 测试输出 / 引用条款）。空证据 = 偷懒早退，主线打回原 stage 重试。
8. **pipeline-status.json 主线单写者；stage receipt 由该 stage 执行者落盘**：`work/<id>/receipts/pipeline-status.json` 仅由主线写入。每个 stage 的 `<stage>.json` 由该 stage 执行者 `Write`（派工时路径由主线以 `{{receiptPath}}` 钉死；主线内联做的 stage 由主线自己落盘），末条消息里的 receipt 仅作冗余副本。派工返回后**第一动作是 `test -f {{receiptPath}}`**——不存在即判交付失败（走不变量 10 自愈），不依赖解析末条消息判成功。
9. **skill 不直接 Write 底盘脚本**：主线 / 任何 sub-agent 都**不**得 Write 或 Edit `workflow/scripts/`、`workflow/templates/`、`workflow/package.json`、`<target>/package.json` 等底盘文件。底盘只能通过 `init.mjs --bootstrap` 分发，源是本 skill 的 `bootstrap/workflow/`。底盘缺失时**停下**报告 + 引导用户跑 bootstrap 命令，不允许"贴心创造"——每次重造导致版本漂移、与 skill 契约脱节。
10. **交付失败 ≠ 质量失败**：sub-agent **返回了**但产物不可用（529/overloaded 错误串、空、截断、末条非合法 receipt JSON）时，主线按「receipt 兜底协议」**自动恢复**——fresh 重派 1 次 → 仍不可用则主线内联接手 → 主线也做不动才进 Manager Override；整条**不计入 gate attempt**，前两步**不**惊动用户。边界：**进程级真 hang**不在本条范围，依赖 harness 超时回收。与不变量 7 区分——那是主动报 `blocked:true`+证据（质量分歧 → 直进 Manager）；本条是根本没给出可用 receipt（交付层 → 先自愈）。
11. **项目外部门禁先于 promote 副作用**：配置 `prePromoteCommands` 时，`promote.mjs` 必须在 Planned → Ready 的任何写盘或 dry-run 输出前，于 `projectRoot` 顺序执行全部命令。任一命令非 0、被信号终止或无法启动都 fail-closed；`--force` 只豁免依赖 Done 检查，不能绕过此门禁。

## 自主边界（诚实定位）

本 skill 的定位是**核心循环无人值守 + 边界决策 human-in-the-loop**，不是"全自主"。两类能力界限分明，向用户预期管理时照此表述：

**可无人值守的核心**：L1–L3 后端/CLI 工单循环（triage → spec/plan → TDD 实现 → review → handoff），含交付失败自愈（不变量 10）与批次完整性闸。实战验证过整批工单无人跑通。

**必停问人清单**（设计上外包给人的价值判断，无人值守模式下命中即挂起该工单/该批，不得自作主张）：
1. coalesce 合并候选——工单结构决策由人拍板
2. `ui_intent_detected` / `ui_paths_stale_suspected`——UI 线开关与路由修正
3. Manager Override（attempt>2 / 自报阻塞 / Gate 8 fail）——质量分歧升级
4. 安全敏感工单的验收签字、批次级 E2E 收口方式（补配置 vs Skipped）等文档明示"用户确认"的节点

**高环境门槛的可选枝**（有前置依赖，不是开箱即用；缺前置时如实标 `env-blocked`，不算质量失败）：UI 线需 designSkill + 可启动应用 + 浏览器截图；E2E 线需 verifySkill + 活服务/浏览器/secrets；L0 direct-fix 判据极窄，真实命中率低。

## 启动协议

skill 被调用时，第一件事永远是**定位工作目录与读 workflow.config**。按序查 `workflow.config.mjs`：① `<cwd>/b2r-process/`（默认）② `<cwd>/dev/`（legacy）③ `<cwd>/`（cwd 即工作目录自身）④ `<cwd>/../b2r-process/` ⑤ `<cwd>/../dev/`。找到第一份即为锚点，后续 prompt 中所有 `{{devRoot}}` 占位填入这个实际目录。

**都找不到 → 新项目首次使用**。按不变量 9 禁止直接 Write 底盘文件，正确动作：① 向用户报告"未找到 b2r-process/workflow.config.mjs（legacy 路径 dev/ 也没有）"；② 引导用户跑 bootstrap（主线**亲自**跑，不派 sub-agent）：`node <SKILL_ROOT>/bootstrap/workflow/scripts/init.mjs --bootstrap --prefix <工单前缀，2-4 大写字母如 IS/FOO/WORK> --milestones <逗号分隔如 M0,M1,M2；不用里程碑则 ''> --project <项目名小写> --target ./b2r-process`；③ 该命令一次性生成完整 `workflow/` 子树 + `workflow.config.mjs` + `AGENT_RUNBOOK.md` + `state/*.md` + `package.json`（含 npm script 别名）；④ 引导用户 `cd ./b2r-process/workflow && npm install`，再 `npm run validate:state` 验证；⑤ 验证 OK 后才按"找到工作目录"路径继续。

**底盘契约自检（thin 架构）**：找到 devRoot 后检查三项：① skill 自带 `bootstrap/workflow/VERSION` 与 `<devRoot>/.b2r-version` 是否一致；② 关键 alias（`start` / `regression:diff` / `lint:redlines`）是否在 `<devRoot>/package.json` 缺失；③ **`<devRoot>/.b2r-home` 是否存在、且其内容路径下 `bootstrap/workflow/scripts/` 真实存在**（alias 运行时从 `.b2r-home` 解析 skill 位置——文件缺失或指向他机路径是"仓库换机克隆"的典型症状，每条 npm 命令都会因此报 `Cannot find module`）。任一不满足 → **停下**，引导用户主线亲跑 `node <SKILL_ROOT>/bootstrap/workflow/scripts/init.mjs --upgrade --target <devRoot>`（thin：只补 alias + 迁移旧式烘焙路径 + 重写 `.b2r-home` + 写 `.b2r-version` + 回填 state，**不复制脚本**，脚本永远从 bundle 跑），自动 `validate:state` 后继续。

读到 config 后提取以下字段作为所有 sub-agent 的上下文（外加按 `workItemSlug({ workId, title })` 算出的 `slugDir`，用于填 `{{slugDir}}` 占位）：

- `workIdPrefix` / `workIdDigits` / `idScheme` — 编号格式。`idScheme` 缺省 `sequential`（`<prefix>-\d{3}`）；多 worktree 并行项目可设 `timestamp`，新号形如 `<prefix>-260602-143052-7f`
- `milestones` 里程碑数组 · `projectName` / `boardTitle` 品牌 · `docsRefs` 上游文档路径（spec 必须从这些位置引用具体章节）· `regressionCommands` regression 阶段必跑命令
- `prePromoteCommands`（默认 `[]`）— Planned → Ready 前的项目级外部门禁，按顺序在 `projectRoot` 执行，任一失败即零 promote 副作用停止
- `pipeline.maxRetry`（默认 `1`）Gate fail 后 retry 上限 · `pipeline.retroSurfaceThreshold`（默认 `3`）累计 N 条 retro override 主动 surface · `pipeline.receiptsDir`（默认 `receipts`）· `pipeline.specsDir`（默认 `specs`，spec 路径 `<devRoot>/<specsDir>/<slugDir>.md`）
- `ui`（可缺省）— UI 设计线配置，缺省即关闭；存在时提取 `designSkill`（推荐 `ui-ux-pro-max`）、`designRefs`（可空）、`uiPaths`（projectRoot 相对 glob）、`anchorPath`（devRoot 相对）
- `e2e`（可缺省）— E2E 验收线配置，缺省即关闭；存在时提取 `verifySkill` / `launch` / `e2eCommands` / `reportsDir` / `maxRerun` / `unit`。E2E 只在边界运行，机制见 `references/e2e-acceptance.md`

**不要把 config 里的值硬编码到 prompt 里**——前缀、里程碑名、项目名、文档路径都来自 `workflow.config.mjs`，每次派工按当前 config 派生填充占位。skill 描述里的 `IS-XXX` 只是为了帮用户在自然语言中触发；执行时一律读 config。

## 4 档复杂度路由（Stage 0 Triage 内嵌）

每条工单在 Stage 0 由 `roadmap-planner` 打标 `level`，依据写入 `0-triage.json`，**不允许后期降档**（只能升档）：

**判定是决策树、从上到下短路，不是平行表格匹配**（旧"满足任一"表格语义含混，L1 的判据实为合取，实战曾 3/3 误判并产出"单文件却涉及 3 文件"式自相矛盾 reasons）：先列全 `files_estimated` → ① 命中硬升档信号（跨模块 / 新 schema / 新依赖 / 安全敏感 / migration）→ **L3**；② 零逻辑变化（typo / 注释 / 文档措辞 / 单行格式化）→ **L0**；③ 恰 1 文件 + 无新导出接口 + ≤30 行 → **L1**；④ ≤3 文件 + 无跨模块边界变化 → **L2**；⑤ 其余 → **L3**。

| Level | 路径 | 跳过 |
|---|---|---|
| **L0** TRIVIAL | `direct-fix` 单 agent: edit + state-flip + commit | 跳过 spec/plan/review/arch |
| **L1** SIMPLE | S1 → 2-merged (spec+plan+self-review) → 3 → 5 | 省独立 reviewer + arch-reviewer |
| **L2** STANDARD | S1 → 2a → 2b → 2c → 3 → 4-light → 5 | reviewer 走轻量清单，不调 skill |
| **L3** COMPLEX | S1 → 2a → 2b → 2c → 3 → 4 → 5（完整 7 stage） | — |

**主线收 proposal 后的机械一致性校验（不需要 LLM 判断）**：对每条 triage 逐条核 `level` vs `files_estimated.length`——L1 ⇒ 恰 1 文件；L0/L2 ⇒ ≤3 文件；矛盾即该条 triage 无效，整份打回 roadmap-planner 重判（计入 gate attempt）。`reasons[]` 须引用决策树分支号；引用缺失按同等无效处理。这道校验堵"reasons 自相矛盾但照样放行"的路由失准。

Stage 0 之外所有 stage 在动手前都要读 `0-triage.json.level` 决定路径。Level 一致性由 Gate 校验（实际改动文件数 / 是否含 schema 变更 vs 初判 level，超出则升档）。

**多 slice 工单的 level 护栏**：合并工单（1 工单 ＋ N sub-slice）若把各 slice 改动文件数**整工单累加**去比初判 level，几乎必然撑爆 L2 阈值 → 误判升档 L3 → 把 sub-slice 省下的固定开销全部吐回。所以：(1) `level = max(slice levels)`，不按累加文件数重判；(2)「实际改动文件数 vs 初判 level」一致性校验**按 slice 分摊**评估、不整工单累加；(3) 末切片**仍全量跑一次** regression，保证跨工单 / 跨 slice 回归不漏网。

## 6 阶段编排

```
pre-flight（读 state/active.md + queue.md + roadmap.md）→ S0 Triage → S1 Backlog
  ├ L0 工单 ─────────────────────→ direct-fix（单 stage，直到 S5 收尾）
  └ L1/L2/L3 ─ 逐条工单：S2 Promote → S3 Implement → (S3.5 UI) → S4 Review → S5 Handoff
       └ active 回 Idle → 主线亲跑两条状态脚本（都不许凭记忆跳过）：
            1. batch:status（批次完整性闸）：读本批 done/total 与 open_members——
               `M/N Done · 剩余: [ids]` 是机械读数，不是心算；
               open_members 非空时禁止向用户宣称"本批收官"
            2. milestone:status <milestone>
                 ├ boundary=false → 回 S2 拿下一条 Ready
                 ├ boundary=true 且 e2e 未配置 → 记录跳过，按里程碑翻档要求继续
                 └ boundary=true 且 e2e 已配置 → 进 E2E 验收（循环之外）
```

| Stage | 目标 | 执行者 | 产物 / 门槛 |
|---|---|---|---|
| **0 Triage** | 每条工单打 L0-L3；配置 ui 时附加 `ui=true/false` | 内嵌于 roadmap-planner 中段 | `0-triage.json` · level 字段存在 + 判据原文非空 |
| **1 Backlog** | roadmap 拆成 Planned 工单序列（含依赖） | roadmap-planner 提 proposal；主线 `mintWorkId` 回填 | queue.md + §Planned 摘要 + `1-planner.json` · `validate:state` 0 error |
| **2 Promote** | 1 条 Planned 翻 Ready，出 spec / plan / context-pack | `promote.mjs`（prePromote 门禁 → 写盘）→ 可选 UI 线 → drafting（L1 合并 + self-review；L2/L3 独立 2a/2b/2c） | `specs/<slug>.md` + `work/<slug>/{plan,context-pack}.md` · reviewer 通过 + `validate:state` OK |
| **3 Implement** | active 翻 In Progress，按不变量 3 分型完成 TDD | implementor sub-agent（`inline_ok` 微切片由主线内联） | `3-impl.json` · targeted 绿 + `regressionCommands` 全过 |
| **3.5 UI Fidelity**（可选硬闸） | 实现页截图 ↔ mockup 逐元件比，判「像不像」 | 主线起应用 + browser-harness 截图 → `design-reviewer(fidelity)` | `3.5-ui-fidelity.json` · `reviewer_verdict=PASS` |
| **4 Review** | 架构 + 安全 review，命中红线即停 | L3 **默认主线内联**；命中三条件之一才派 arch-security-reviewer。L2 轻量内嵌 / L1 跳过 | `4-arch.json`（主线拼装）· `lint:redlines` 0 命中 |
| **5 Handoff** | impl commit + 状态翻档 + handoff commit | **主线亲做**（handoff-committer 降级为可选） | `5-handoff.json`（主线落盘）· `verify:handoff <id>` 全过 |

**Promote → Implement 之间的状态翻档用脚本，不手工双改**：`promote.mjs` 只把工单 Planned → Ready（生成 stub）。review 通过、要真正"开始做"时，主线**亲跑 `cd {{devRoot}} && npm run start <id>`**——它原子地把 `active.md` 翻 In Progress 持有该工单 + `queue.md` 对应行 Ready → In Progress + validate-state 兜底 + 重 render BOARD，内建 exactly-one-active 校验与"只有 Ready 能启动"前置。**不要手工分别编辑 active.md 与 queue.md**——漏改一个就触发 validate-state 的 cross-file 脱钩报错。

Stage 1 的真实工单号由主线脚本化分配：`roadmap-planner` 只返回带 `temp_key` 的 proposal（标题、范围、依赖、triage），主线读当前 `queue.md` 的 existing IDs，逐条调 `workflow/scripts/config.mjs::mintWorkId(config, existingIds, new Date())`，把 `temp_key` 替换成真实 workId 写入 `queue.md` / `0-triage.json`。不要让 sub-agent 手算 `max+1` 或凭自然语言生成 timestamp。

**Stage 1 批次账本（无条件）**：这批工单号全部回填后，主线**无论 e2e 配置与否**都调 `config.mjs::mintGroupId(new Date())` 生成批次 id，把这批工单写进 `state/e2e-groups.md` 一行（Status=Open）。账本是"计划 N 条 vs Done M 条"的机械事实源——实战实证过主线心算跟踪必漏（11 条计划做到第 10 条就以为收官）。`e2e.unit∈{group,both}` 时该批次同时承担组级 E2E 验收单位（见 `references/e2e-acceptance.md`）；e2e 未启用时它只作完整性追踪，全 Done 后翻 `Skipped`（Receipt 写 `skip:e2e-disabled`）一行收口。`validate-state` D3 对账本做无条件簿记校验与收口硬卡——账本必须有尾。

### Stage 2 附则

> **Pre-promote guard**：配置 `prePromoteCommands` 时，`promote.mjs` 在确认工单可 promote、但尚未创建 spec/plan/context-pack、修改 queue 或输出 dry-run 摘要之前，依数组顺序运行命令。cwd 为 `projectRoot`（缺省 `devRoot`），注入 `B2R_WORK_ID` / `B2R_WORK_TITLE` / `B2R_DRY_RUN` / `B2R_FORCE`（后二者 `1`/`0`）。失败后短路；`--dry-run` 仍执行，`--force` 不能绕过。

> **合并候选 → AskUserQuestion**：roadmap-planner 在 Stage 1 proposal 返回非空 `coalesce_candidates[]`（同包前缀 ＋ 严格单链 ＋ 每条 ≤L2 ＋ 同里程碑 ＋ 同 ui 标的连续切片）时，主线**必须**在 `mintWorkId` 前对每组 `AskUserQuestion`：「检测到 N 条切片是同包线性链（`<shared_prefix>`），无并行收益。合成 1 工单 ＋ N sub-slice 可省 N-1 遍 spec/plan/review/regression/handoff。(a) 合并 (b) 保持 N 张独立工单」。**由人拍板，主线不自动合并**。选合并 → 该组只 mint 1 个 workId、其余 temp_key 作 sub-slice、§Planned 摘要加「含原 N 切片: …」一行留追溯（不进 receipt schema）；选不合并 → 逐条照常 mint。spec-drafter 据此在 spec §4 写 `### Sub-slice 列表`（RUNBOOK §11）。

> **可选 UI 设计线（Stage 1.5 / 2.0 / 3.5）**：仅当配置 `ui` 块时启用；缺省则整条 UI 线关闭，纯后端 / CLI 项目不产生任何 UI 产物。
> - Stage 0：roadmap-planner 依据 `0-triage.json.files_estimated` 与 `ui.uiPaths` 打 `ui=true/false`（两者都用 projectRoot 相对路径）。
> - **UI 线显式播报（防静默少交付）**，两个正交决策各堵一个对称盲区：
>   - **总开关**：工单有前端意图（命中 view/页面/工作台/reader/pill/总览/dashboard 等关键词，或 `files_estimated` 是前端路径形态）但 config **无** `ui` 块 → proposal 顶层标 `ui_intent_detected:true`；主线**必须 `AskUserQuestion`**：「N 条工单涉及前端但 UI 线未配置——(a) 现在加 ui 块 (b) 确认只做后端、前端 defer」。
>   - **逐单路由**：config **有** `ui` 块、但本批有前端意图的工单**无一命中** `ui.uiPaths` → 标 `ui_paths_stale_suspected:true`（附 `uiPaths_current` / 有前端意图的 temp_key / 它们的 files）；主线**必须 `AskUserQuestion`**：「疑似 uiPaths 陈旧——(a) 修正后重跑 triage (b) 确认这些工单不需要设计线」。判定是「有前端意图 AND 该批 0 命中」的合取，纯后端批次不误报。
>   - Stage 1 落地汇报**固定播报一行**：`UI 线:开/关 · E2E 线:开/关(unit=...)`；`ui` 块存在时**追加** `UI 工单:N/M 命中 uiPaths`（M=本批有前端意图的工单数）——让 `0/M` 这种危险比例一眼可见。
> - `ui-designer` 的设计系统来源顺序：配置的 `designRefs` → 主动发现的项目文件 → 用 `designSkill` 合成的最小设计系统 anchor；前两类项目事实源优先于通用建议。
> - **Stage 1.5**：首个 `ui=true` 工单 `promote.mjs` 后、spec-drafter 前，若 `ui.anchorPath` 不存在，主线派 `ui-designer(mode:anchor)` + `design-reviewer` 生成并审 `state/ui-anchor.md`，receipt 落触发工单的 `1.5-ui-anchor.json`。
> - **Stage 2.0**：每个 `ui=true` 工单在 stub 生成后、spec-drafter 前，主线派 `ui-designer(mode:delta)` + `design-reviewer` 生成 `work/<slugDir>/ui/` mockups，receipt 为 `2.0-ui-design.json`。spec-drafter 必须把 `mockups[]` 写入 spec §4，implementor 必须把它们当 UI 实现目标。Stage 3 才发现原 triage 漏标 UI 时，本轮不补设计，只登记 retro 并 surface。
> - **mockup → code 有损压缩三道防线**（未被转录进 spec 文字或测试断言的视觉信息会静默丢失，而质检闸照样全绿）：① **入口·清单化** `ui-designer` 抽 `mockup_elements[]`；`spec-drafter` 在 spec §4 给每个元件标 `本轮做/顺延/不做`（只标注、不手抄），§7 为每个 `本轮做` 写元件存在性断言；`spec-plan-reviewer` 逐 key 对账。**砍元件可以，但必须显式砍**。② **中段·元件断言** implementor 的失败测试必须含 §7 元件存在性断言，丢一个元件红一个。③ **末端·render-diff 闸（Stage 3.5，硬闸）**：见下。
> - **Stage 3.5 · render-diff 闸**：每个 `ui=true` 且已产 mockup 的工单，在末切片 regression 绿之后、handoff 之前，主线**强制**插一道：① 用 `e2e.verifySkill`（缺省用 `verify` skill / 项目 dev-server）起应用并导航到实现页；② browser-harness 截**深 + 浅双态**图**落盘**到 `work/<slugDir>/ui/impl-shots/`（thread 内只留路径，绝不留 base64）；③ 派 `design-reviewer(mode=fidelity)`，喂 mockup 路径 + spec §4 元件清单 + 截图路径，产 `3.5-ui-fidelity.json`；④ `PASS` 才放行，`NEEDS_FIX` → retry-once 回 implementor → Manager Override，截图取不到 → `reason_category=env-blocked` surface 环境缺口（不静默跳过）。无 mockup 目录则整闸自动跳过。`verify-handoff.mjs` Check 8 对有 mockup 的工单**强制要求** `verdict=PASS` 或显式 `deferred_to_backlog`/`env-blocked` 证据——render-diff 与测试绿并列必要。UI 各闸的质量失败同样走 retry-once → Manager Override。

> **「plan 已存在」捷径**：当用户输入或 `docsRefs` 已含逐 step 实施计划（如现成的 `*_计划_*.md`）时，spec-drafter / plan-drafter **可降级或跳过**——主线直接把现成 plan 映射落盘为 `work/<id>/{spec,plan}.md`。**但 `spec-plan-reviewer` 在 L2/L3 不可省**：它是独立质检 gate（reviewer 不见 drafter 内部推理），主线自写 spec/plan 时更需要这道独立眼睛兜范围裁剪 / spec §3 不做项 / §4 文件清单。捷径只省"起草"，不省"独立 review"。

> **单切片合并 2a+2b（提速旁路）**：可预判 **sub-slice 数为 1** 且未走"plan 已存在"捷径时，主线可把 2a-spec 与 2b-plan **合并为一次 drafter 调用**——派 `spec-drafter` 时标注 `merge_2b: true`，让它产出 spec.md 后同 context 续写 plan.md（按 plan-drafter §1-§7 约束），一次返回 `2a-spec.json` + `2b-plan.json`。`spec-plan-reviewer` 照常跑、不可省。多切片或拿不准切片数 → 不合并，老路 2a→2b 分派。

### Stage 3 附则 · 微切片内联通道

`plan-drafter` 可为切片标 `inline_ok: true`，判据：**改动 ≤2 文件、且无新增行为断言需求**（典型：「只差提交」「纯配置 / 文案」「上游已验证只需落盘」）。主线对 `inline_ok` 切片可**内联完成、不派 implementor**，`3-impl.json` 对应 slice 记 `inline: true`，receipt 由**主线**落盘。内联仍受不变量 3（红门分型）/ 4（commit 物理分离 + 白名单 add）约束，红门证据照常落 receipt。

`inline_ok` 切片的红门分型：diff 确实引入了行为变更就照填 `behavior-change` / `new-module` 并给对应证据；确实**没有**新增行为断言可写时填第三档 `no-new-behavior`（该档**只允许**出现在 `inline_ok: true` 的切片上），`failing_test_output` 写明「diff 无行为变更 + 改动由既有测试 / 上游切片 targeted 绿输出覆盖」并附具体引用。**防滥用护栏：拿不准就不标 `inline_ok`，整轮 implementor 是默认；`no-new-behavior` 更不是"懒得写测试"的出口。**

### Stage 4 附则 · 独立审查的触发条件

L3 的 Stage 4 默认由**主线内联**完成：亲跑 `npm run lint:redlines`（含 `config.redlineCommands`）+ 核对 scope 一致性 / spec §11 对齐 / diff 面。仅在**任一**条件成立时才派独立 `arch-security-reviewer`：(a) 本工单期间 `lint:redlines` 或 `redlineCommands` **曾命中**；(b) diff 触碰安全敏感面（认证 / 授权 / 加密 / 密钥 / 权限 / schema migration / 计费）；(c) 主线内联核查发现疑点。

**红线命中的两段语义分清（别互斥）**：命中当下按不变量 6 **先阻断**——把命中清单打回 implementor 修，修到 `lint:redlines` 0 命中才继续；但"曾命中"这个事实**不会因为修好而消失**，它使条件 (a) 成立，**修复后仍要派独立 `arch-security-reviewer` 复核**（复核对象是修完的 diff，判修法本身有没有留后门 / 绕过）。即：命中 → 阻断修复 → 再派独立 reviewer，两步都做，不是二选一。

`4-arch.json` 照旧由主线确定性拼装，新增 `independent_review_dispatched: bool` 与 `dispatch_reason`（未派时写明依据）。L2 轻量内嵌 / L1 跳过维持原状。

### Stage 5 附则 · 主线亲做

Stage 5 默认由**主线亲自执行**，顺序**唯一且不可调换**（`verify:handoff` 要求 queue=Done / active=Idle / BOARD 已渲染 / pipeline-status=done 全部就位后才可能通过，提前跑必挂）：

1. **翻档**：`state/active.md` → Idle（`Last commit` 记 impl hash）、`state/queue.md` 该行 → Done、`state/customer-visible.md` 追加 Done 段（涉及里程碑则一并动 `state/roadmap.md`）
2. `cd {{devRoot}} && npm run validate:state` — 0 error
3. `cd {{devRoot}} && npm run render:board` — 退出 0（必须在所有 state/*.md 编辑之后，保证 BOARD mtime ≥ state/*）
4. **handoff commit**：白名单 `git add`（仅 `state/*` + `BOARD.html`，**禁 `git add -A`**）→ commit 唯一、不 amend → 断言 impl / handoff commit 物理分离（不变量 4）
5. **写 `pipeline-status.json` `status: "done"`**（主线单写者，不变量 8；必须先于第 6 步，否则 verify Check 7 fail）
6. **亲跑 `cd {{devRoot}} && npm run verify:handoff <id>`** — 全过
7. **落盘 `5-handoff.json`**

不再默认派 `handoff-committer`；该模板降级为**可选**，仅在主线上下文吃紧或并行多单收尾时使用（派出时它止于第 4 步，第 5-7 步仍归主线）。理由：机械活派工反而引入交接损耗（实测 verify 被推迟、残留脏 receipt）。

### E2E 验收线（可选 · 边界触发）

配置了 `e2e` 块时，Stage 5 后 `milestone:status` 报 `boundary_reached=true`（里程碑级）或 `e2e-group:status` 报 `next_action=run_group_e2e`（`unit∈{group,both}` 组级）才进入 E2E 验收。完整机制（建组 / 两段式执行 / 断点续跑 / FAIL 闭环 / 相关质检行）见 **`references/e2e-acceptance.md`**，进入前先读它。缺省 `e2e` 块 = 整条线关闭，不产生任何 E2E 产物、不报错。

## 失败处理：交付失败兜底 → 质量失败 retry-once → Manager Override

先区分**两类失败**（不变量 10）：**交付失败**（returned-but-unusable：末条不是合法 receipt JSON——散文 / 报错串 / 空 / 截断）是基础设施层问题，不该惊动用户、自动恢复；**质量失败**（gate fail：receipt 合法但 verdict=NEEDS_FIX / 脚本非 0 / 范围越界）该让人拍板，走 retry-once → Manager Override。

### L0 交付失败兜底（自动，先于 gate 判定）

每次拿到 `Agent` 返回，主线**先判产物是否可用**，再进 gate：

1. 能把末条消息解析成本 stage 的 receipt envelope（`stage_id`/`level`/`attempt` 齐）→ **可用**，进 gate 判定。
2. 否则 = 交付失败，**不惊动用户**：① fresh 重派同一 stage 一次（prompt 末尾附"上次未返回合法 receipt，请确保最后一条消息是 receipt JSON"），**不计入 gate attempt**；② 仍不可用 → 主线**内联接手**该 stage（自己跑脚本 / 编辑 / 审查，落 receipt，标 `dispatch_recovery`，**不复用 `manager_override` 字段**——后者语义是"经人介入"，复用会污染 retro/BOARD 审计统计），内联代跑 implementor 时**照样受不变量 3 / 4 约束**，红门证据照常落 `3-impl.json`；③ 主线内联也做不动（真·能力边界）→ 才进 Manager Override。
3. **边界**：进程级真 hang 本协议**测不了**，依赖 harness 超时回收——不要在文档/prompt 里假装能"检测超时"。

> **infra 错误指纹（归入交付失败，当回合自愈）**：返回命中 `403 Request not allowed` / `Please run /login` / `socket connection ... closed` / `use SendMessage with to:` / `overloaded` / `529` / `Usage Policy` / 裸 `API Error` 任一 = 交付失败，**主线当回合即处理（先探盘上半成品 → fresh 重派或内联），禁止把错误原文回显给用户等「继续」**。重派前必查磁盘（spec/plan/commit 是否已部分落盘），避免重跑整段。

### L1 Auto-Retry（自动 × 1）

`pipeline.maxRetry`（默认 **1**）次自动重试：① 主线把 fail items + reviewer expectation 打包进 `pipeline-status.last_feedback`（**不**再单独写 feedback-receipt.json）；② 派 **fresh sub-agent** 回上游 stage，prompt 明示"上一轮哪些条不通过 + 期望"+ 引用 `previous_receipt`；③ sub-agent 看 feedback + 自己上轮 receipt 针对性修正而非重写；④ 新一轮 receipt 再过 Gate。

### L2 Manager Override（人介入）

触发条件**任一即可**：retry 1 次后仍 fail（`attempt > maxRetry + 1`，默认 attempt > 2）／ sub-agent 自报阻塞（`blocked: true` + 非空 `blocked_evidence`）／ Gate 8 (handoff verify) fail。主线**自动**做：① 即时渲染卷宗 escalation-pack（**不**持久化为 .md，仅渲染给用户 + 供 manager-decision 引用）：历次 receipt diff + 历次 feedback + sub-agent self-report；② 基于卷宗起草决策建议（5 选 1）；③ 用 `AskUserQuestion` 呈现「我建议：&lt;option&gt; · 理由 · 影响」+ 4 个可选行动；④ 用户拍板后写 `work/<id>/receipts/manager-decision-<timestamp>.json`；⑤ 追加 `state/retro.md` 一段（失败链 + 决策 + 1 行经验）；⑥ 按 action 调度。

| action | 回流点 | 备注 |
|---|---|---|
| `accept-override` | 下一 stage | 后续 receipt 全部带 `manager_override` 标记 |
| `downgrade` | **Gate 6（level branch 重判）** | 改 `0-triage.json.level`；不直跳 S3。（统一编号：此前 quality-gates 写 Gate 4、pipeline-flow 写 Gate 6，两处冲突；以 pipeline-flow 图中 G6=level branch 为准） |
| `shrink-scope` | S2a（spec retry，必加 §3 不做项） | 卡住部分自动建新 Planned 工单 |
| `split-slice` | **S2b**（plan retry，声明 sub-slice） | 与"派 plan-drafter"一致 |
| `drop` | Done（queue 翻 Superseded） | active 翻 Idle |

**Gate 8 (handoff) fail 后仅允许 `accept-override` 或 `drop`**——其余三个在 handoff 阶段语义不成立。各 action 调度细节见 `references/quality-gates.md`。

**attempt 语义统一**：`attempt` 从 **1** 起算（1=首次，2=已重试 1 次）；升级触发 `attempt > pipeline.maxRetry + 1`；`pipeline-status.current_attempt` 用同一语义（**不**用 `retry_count = attempt-1`）；计数 **stage 级独立**——spec retry 不消耗 impl 的余额。

## Receipt 契约

每个 stage 完成后**必须把 receipt JSON `Write` 到 `<devRoot>/work/<slugDir>/<receiptsDir>/<stage_id>.json`**（落盘文件是权威载体；派工时路径由主线以 `{{receiptPath}}` 钉死，sub-agent 不自己猜；`<slugDir> = <workId>_<slugified-title>`，如 `ABC-001_RUNBOOK-加-Manager-Override-接手段`；`<devRoot>` 默认 `b2r-process/`；spec.md 单独沉淀到 `<devRoot>/<specsDir>/<slugDir>.md`，默认 `specs/`），派工模式下同时在末条消息附冗余副本。主线**派工返回后第一动作 `test -f {{receiptPath}}`**：不存在 = 交付失败（不变量 10 自愈）。需要从消息读 receipt 做冗余校验时取**最后一个合法 JSON 块**（而非严格末条）——与 drafter 在 JSON 后追加散文的现实对齐。

通用 envelope 必含：`stage_id` / `level` / `attempt`（1-based）/ `completed_at`（ISO8601 +08:00）/ `manager_override`（默认 null）/ `blocked` / `blocked_evidence` / `skills_used[]`，再加 stage 专属 payload。完整 schema 与每 stage 字段见 `references/receipts-schema.md`。下个 stage 派工时，主线把上一份 receipt 路径作为 prompt 字段传入。**receipt / plan / context-pack 落 `<devRoot>/work/<slugDir>/`；spec 落 `<devRoot>/<specsDir>/<slugDir>.md`**。E2E receipt 是例外，见 `references/e2e-acceptance.md`。

## Retro 复盘机制

每次 Manager Override 落定后主线自动追加 `<devRoot>/state/retro.md` 一段：

```markdown
## YYYY-MM-DD · <workId> · <stage> override
- 失败链: <gate fail 历次 + sub-agent 自报阻塞文本>
- Manager 决策: <action>
- 1 行经验: <将来如何避免>
- template_patch: <若经验指向某 agent 模板该改，列 agents/xxx.md[, ...]；否则 none>
```

`template_patch` 是**回灌债的显式登记**——经验指向某个 `agents/*.md` 就列出该文件，纯流程经验填 `none`。**Surface 触发**：每里程碑结束 **或** 累计 ≥ `pipeline.retroSurfaceThreshold`（默认 3）条新条目，下一次 Stage 1 派工前主线主动展示 retro.md，**并把所有 `template_patch != none` 的条目汇总成「待回灌清单」**呈现（实际改模板仍是人监督下的 `/skill-review` 动作，本机制只保证债务可见）。诚实边界：该清单只服务有人值守的定期复盘。

## 何时派 sub-agent vs 何时自己做

**派 sub-agent**：阶段切换需要 fresh context（spec drafting / TDD implementation）；角色独立判断比串行思考更可靠（reviewer 不应见 drafter 的内部推理）；任务跨多文件 + 多步骤 + 需要工具组合；sub-slice 之间独立验证。
**主线自己做**：用户对话 / 状态确认 / 解释；跑脚本（`promote` / `validate` / `render`）；Stage 4 常规内联审查；Stage 5 收尾；`inline_ok` 微切片；读 state 决定下一步；起草 Manager Override 建议 + 落 retro。

> **Stage 4 为什么能内联（与上面"角色独立更可靠"不冲突）**：Stage 4 的独立性由**机械条件 (a)(b) 兜底**——红线 lint 曾命中、diff 触碰安全敏感面，这两条都是主线读得到的客观事实，命中就必派；(c)「内联核查发现疑点」只会**增派、不会减派**。内联是"无触发条件时的默认"，不是"对独立 review 的替代"。

派 sub-agent 时用 `Agent` 工具，按 `agents/<role>.md` 模板装填上下文。每份模板都明确：sub-agent 只读自己需要的文件（spec / plan / context-pack），不读整个仓库；完成职责即返回 receipt JSON，不与主线对话。

## 质检节点（脚本驱动，不靠汇报）

每个 stage 完成后，主线必须**亲自跑这些脚本**确认通过，再进下一阶段。执行者自报"通过"不算数：

| 阶段 | 质检命令 | 通过判据 |
|---|---|---|
| S0 Triage | （主线读 receipt，机械核） | level ∈ {L0,L1,L2,L3}；`reasons[]` 引用决策树分支号；level vs `files_estimated.length` 自洽（L1 ⇒ 恰 1 文件，L0/L2 ⇒ ≤3 文件），矛盾即打回重判 |
| S1 Backlog 落地 | `cd {{devRoot}} && npm run validate:state` | 0 error（warn 允许） |
| S2 Promote 前（可选） | `config.prePromoteCommands`（由 `promote.mjs` 在 `projectRoot` 顺序执行） | 全部退出码 0；失败时 queue/spec/plan/context/BOARD 零改动；dry-run/force 不豁免 |
| S2 Promote 后 | `cd {{devRoot}} && npm run validate:state` + `npm run deps:graph` | 0 error，依赖图无环、无孤儿 |
| S1.5 / S2.0 UI（可选） | 主线读 `1.5-ui-anchor.json` / `2.0-ui-design.json` + mockup 路径存在性 | 均需 `reviewer_verdict=="PASS"`；anchor 还需 `ref_grep_hits` 非空或 `synthesized_design_system==true` 且 `synthesis_evidence` 非空，**且 `ref_grep_hits` 必须来自项目 `designRefs` / 主动发现的项目文件——项目事实源不得被通用 `designSkill` 的文档替代**；delta 还需 `mockups[]` 非空并对齐 anchor（`ui_novel=true` 或 `NEEDS_FIX` → surface） |
| S2 收 spec/plan 后（主线亲核 tbd） | `cd {{devRoot}} && grep -nE 'TBD\|待定\|待起草\|占位\|待 *fresh' <spec/plan 文件>` | 0 命中（命中 = 谎报 sections_filled，打回；**不信** receipt 的 `tbd_grep` 自报字段） |
| S3 红门 | 主线核 `3-impl.json` 的 `red_gate_mode` + 对应证据 | `behavior-change` 切片必须有**断言级** `failing_test_output`（`ERR_MODULE_NOT_FOUND` 类不算）；`new-module` 切片须写明 tests+impl 同批、断言覆盖 spec §7 哪几条且跑绿；`no-new-behavior` 切片（**仅限 `inline: true`**）须写明 diff 无行为变更 + 覆盖它的既有测试 / 上游切片 targeted 绿输出**具体引用**——显式放行，不按缺证据打回。前两型核时 grep 失败结构关键字（非 0 退出码 / `FAIL` / `Error` / `AssertionError` / `✗`），"非空即过"不成立。证据缺失 / 不合型 / `no-new-behavior` 出现在非 inline 切片 = 红门未过，打回 |
| S3 targeted（**每切片**） | spec §7 本工单特有命令 + 本切片 plan §1 Step1 test | 0 error / 测试绿 |
| S3 收敛 Regression（**末切片后一次**，主线亲跑） | `config.regressionCommands` 每一条 | 全部退出码 0；红了**按切片二分定位**（每切片留 targeted + 增量集成 checkpoint），不裸跑全量面对红海 |
| S3.5 UI Fidelity（可选） | 主线起应用 + browser-harness 截深/浅图落盘 → 派 `design-reviewer(mode=fidelity)` → 读 `3.5-ui-fidelity.json` | `reviewer_verdict=="PASS"`；`NEEDS_FIX` → retry 回 implementor → Manager Override；截图取不到 → `reason_category=env-blocked` surface。无 mockup 目录 = 整闸跳过 |
| S4 Review | `cd {{devRoot}} && npm run lint:redlines`（含 `config.redlineCommands`，主线亲跑）+ 主线核 scope 一致性 / spec §11 对齐 / diff 面 | 0 命中；`4-arch.json` 由主线确定性拼装并写 `independent_review_dispatched` + `dispatch_reason`（派了独立 reviewer 时其 findings 并入，reviewer 不自产 receipt） |
| S5 Handoff | `cd {{devRoot}} && npm run verify:handoff <id>`（主线亲跑） | 全过（L3: 8 项 / L0: 跳过 spec/plan 相关 check）。**Check 8（UI 工单）**：有 `work/<id>/ui/` mockup 目录的工单必须有 `3.5-ui-fidelity.json` 且 `verdict=PASS`，或带显式 `deferred_to_backlog`/`env-blocked` 证据 |
| 批次完整性闸（**每次 handoff 后必跑**） | `cd {{devRoot}} && npm run batch:status -- --json` | 读本批 `done/total` + `open_members`；`open_members` 非空 → 不许宣称批次收官（继续跑剩余工单或显式 surface"剩余 X 条"）；收官汇报固定含 `批次: M/N Done` |
| 里程碑 / 组级边界与 E2E（可选） | 见 `references/e2e-acceptance.md` | 同上 |
| 任意 Gate fail 后 retry | 重新跑同一脚本 | retry attempt 仍 fail → Manager Override |

任何质检失败 → retry-once → 仍 fail 进 Manager Override（不"打回用户决定"——主线起草决策，用户拍板）。

### 收敛 regression 的 flake 放行纪律

仅当 `config.regressionCommands` 含一个**全量套件**、且该项目 retro 已备案它**恒带预存 flake** 时生效；未备案的项目全量红即真红，照常阻断。

- 真 gate ＝ **受影响套件绿 ＋ `validate:state` ＋ `render:board`** 三者全绿；
- 全量套件**全红不阻断**翻档，只触发：`grep '^FAIL'` 摘失败用例 → **隔离重跑** → `git diff` 对照本轮改动范围**二分核查**「这条红是不是我引入的」。范围外的预存 flake 红 → 放行并在 receipt 记一行；范围内的红 → 真回归，回 implementor；
- **不建「受影响包映射表」**（会陈旧的维护债）——「受影响」由主线收敛时按改动文件 → 关联套件当场判定；
- **护栏**：多 slice 工单末切片仍全量跑一次；flake 放行只豁免"与本轮无关的预存红"，绝不豁免"本轮改动引入的新红"。

## 调用 sub-agent 的 prompt 模板位置

| 角色 | 模板文件 | 何时派 |
|---|---|---|
| roadmap-planner | `agents/roadmap-planner.md` | Stage 1，每次 skill 调用最多 1 次（除非用户追加 roadmap） |
| ui-designer | `agents/ui-designer.md` | 可选 UI 线：Stage 1.5 anchor / Stage 2.0 delta |
| design-reviewer | `agents/design-reviewer.md` | 可选 UI 线：审 anchor / delta（1.5/2.0）/ fidelity（3.5），产 PASS/NEEDS_FIX gate |
| direct-fix | `agents/direct-fix.md` | L0 路径，工单单 stage 跑完 |
| spec-drafter | `agents/spec-drafter.md` | Stage 2，L1+ 每个工单 1 次 |
| plan-drafter | `agents/plan-drafter.md` | Stage 2，L1+ 每个工单 1 次 |
| spec-plan-reviewer | `agents/spec-plan-reviewer.md` | Stage 2 末，L2/L3 每个工单 1 次（L1 内嵌于 plan-drafter） |
| implementor | `agents/implementor.md` | Stage 3，每个 sub-slice 1 次（`inline_ok` 微切片由主线内联，不派） |
| arch-security-reviewer | `agents/arch-security-reviewer.md` | Stage 4 **条件触发**：仅 L3 且命中 (a) 红线 lint / (b) 安全敏感 diff 面 / (c) 主线内联发现疑点；否则主线内联，不派 |
| handoff-committer | `agents/handoff-committer.md` | Stage 5 **可选降级模板**：默认主线亲做；仅主线上下文吃紧或并行多单收尾时派 |
| e2e-verifier | `agents/e2e-verifier.md` | 可选 E2E 线：边界到达且 `e2e` 已配置（`mode=milestone\|group\|journey`，见 `references/e2e-acceptance.md`） |

读模板时**替换 `{{...}}` 占位**为本工单的具体值（workId、level、config 字段、依赖列表等），再作为 `Agent` 的 prompt 参数。

## 参考文档

- `references/workflow-contract.md` — `state/*.md` schema 摘要 + 校验脚本契约
- `references/quality-gates.md` — 脚本驱动质检节点完整清单 + Manager Override 5 个 action 详解
- `references/receipts-schema.md` — receipt envelope + 每 stage 字段 + pipeline-status.json schema
- `references/e2e-acceptance.md` — 可选 E2E 验收线（里程碑级 / 批次级 / 两段式执行 / FAIL 闭环）
- `references/pipeline-flow.md` — 简化主流程图源（mermaid）
- `bootstrap/` — 新项目 bootstrap 资产（`workflow/` 子树 + `dev-package.json.tmpl`）+ README

## 不要做的事

- **不要绕过质检脚本**——脚本是不变量的物理实现，绕过=不变量失效。
- **不要让 sub-agent 自己起 sub-agent**——单层调度避免责任链断裂。
- **不要在 sub-agent 完成后直接信任其结论**——总是用脚本验证。
- **不要批量 promote 多条 Planned**——前置 Done 后才能 promote。
- **不要修改 BOARD.html**——渲染产物，手改会被下次 `render:board` 覆盖。
- **不要在 SKILL 触发后立即操作代码**——先确认 `state/active.md` 当前状态与用户明确意图（哪条工单、promote 还是 handoff）。
- **不要让 retry 静默循环**——retry 失败必进 Manager Override，让用户看到失败链。
- **不要凭感觉判断里程碑/组级边界**——Stage 5 后必须跑 `npm run milestone:status <milestone>`（里程碑线）或 `npm run e2e-group:status`（组级线，`unit∈{group,both}`）；脚本未报到达边界（`boundary_reached=true` / `next_action=run_group_e2e`）就不能派 E2E verifier。
- **不要在 Manager Override 时手编 manager-decision.json**——主线起草建议 + 用户 `AskUserQuestion` 确认 + 主线落盘。
- **不要在新项目首次启动时"贴心生成"底盘脚本**——按不变量 9，只能跑 `init.mjs --bootstrap`。
- **不要凭记忆宣称批次收官**——"以为做完了"是主线侧最典型的退化（实战曾 11 条计划做到第 10 条就收官汇报，漏 1 条靠 sub-agent 事后点破）。收官汇报前必跑 `npm run batch:status`：`open_members` 非空就不是收官，汇报里固定带 `批次: M/N Done`。这套 skill 给 sub-agent 设了层层 gate，批次账本是给编排者自己的那道 gate。
