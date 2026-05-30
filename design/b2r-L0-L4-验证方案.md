# b2r 工单等级 L0-L4 验证方案

> 目标：把 blueprint2real skill 在每个等级下的执行路径系统化地验证一次，沉淀"该等级跑通即代表 production-ready"的硬证据。
>
> 编写日期：2026-05-17
> 当前 b2r 版本：v5.2（specs/<slug>.md + work/<slug>/ 双源路径结构）

---

## 0. 验证目的与范围

| 等级 | 当前状态 | 代表工单 | 关键已验证点 |
|---|---|---|---|
| **L0** TRIVIAL | ✅ 已端到端 | IS-001 | direct-fix 单 stage + Manager Override accept-override |
| **L1** SIMPLE | ⏳ **待跑（本方案重点）** | — | spec+plan 合并 / L1 self-review 内嵌 / 跳过独立 reviewer + arch |
| **L2** STANDARD | ✅ 已端到端 | IS-002 | 完整 7 stage / sub-agent 链 / 轻量 arch-reviewer |
| **L3** COMPLEX | ✅ 已端到端 | IS-003 ~ IS-016（多条） | 主线驱动变体 / 完整 sub-agent 链 / 选择性派工 |
| **L4** ULTRA | 🤔 提议中 | — | 当前 b2r 无此档，文末讨论是否引入 |

**为什么需要每等级跑通一次**：b2r 的复杂度路由是设计的核心抽象（避免 trivial 工单走完整 7 stage 浪费、避免 complex 工单走 trivial 路径丢质量）。如果某个等级从未端到端跑过，该等级的 stage 路径 = 纸面契约，未经实战检验。每等级一条标准工单 = 一次"端到端探针"。

---

## 1. b2r 等级速查表

| Level | 判据（满足任一） | Stage 路径 | 跳过 | sub-agent 调用 |
|---|---|---|---|---|
| **L0** | typo / 注释 / 文档措辞 / 单行格式化 | direct-fix 单 stage (edit + state-flip + commit) | spec / plan / review / arch | 1（direct-fix） |
| **L1** | 单文件 + 无新接口 + 无 schema + ≤30 行 | S1 → S2 合并 → S3 → S5 | 独立 spec-plan-reviewer + arch-security-reviewer | 3（planner + plan-drafter 内嵌 review + handoff） |
| **L2** | 跨 2-3 文件 + 有新函数 + 无跨模块边界变化 | S1 → S2a → S2b → S2c → S3 → S4-light → S5 | 仅 architecture skill（保留 security 人审） | 6-7 |
| **L3** | 跨模块 / 新 schema / 新依赖 / 含安全敏感 / 含 migration | 完整 7 stage | — | 7（可主线驱动节省） |
| **L4**? | 跨服务 / 跨 b2r-process 实例 / 产线 hotfix / 灰度发布 | 未定义 | 未定义 | 未定义 |

**升档不降档**：Stage 0 Triage 拿不准时取较高档；后续 stage gate 实际发现工单复杂度超 0-triage 初判 → manager override 升档。**降档不允许**——避免"半路偷懒"。

---

## 2. L0 TRIVIAL 验证方案 (已通过)

### 2.1 判据

工单**必须**全部满足：
- 改动行数 ≤ 30（含新增 + 删除）
- 不含新函数 / 新文件 / 新 import
- 不含 schema / 接口 / 配置 key 变更
- 不含逻辑变更（typo / 注释 / 文档措辞 / 单行格式化）

### 2.2 Stage 路径

```
0-triage → direct-fix (单 stage) → Done
```

direct-fix sub-agent 内部 6 步：
1. 翻 `state/active.md` → In Progress
2. 改 `files_estimated` 中文件
3. impl commit（不含 state/* / BOARD.html）
4. 翻 state/* → Done
5. handoff commit（含 state/* + BOARD.html + work/<slug>/receipts）
6. amend 回填 active.md `Last commit` + 跑 verify:handoff

### 2.3 验证用例（已跑）

**IS-001**：`RUNBOOK: 加 Manager Override 接手段`
- title: AGENT_RUNBOOK.md 加 §12 "Manager Override 接手段"（文档段，~15 行）
- 实际改动：1 文件 +15 行
- impl_commit: `15dbdd10`（但**混入** P0-7 SDK refactor，触发 Manager Override）
- handoff verify: 6/6 pass (skip Check 4 spec/plan，L0 路径无 spec/plan)

### 2.4 已验证经验

| 经验 | 来源 | 影响 |
|---|---|---|
| 外部并发 commit 把 b2r impl 与无关改动混入同一 commit | IS-001 | 主线在派 sub-agent 前应 `git stash` 或用 worktree 隔离 |
| `validate-state.mjs` 缺 L0 兼容（要求 Done 状态有 spec/plan 路径） | IS-001 | v5.2 已修：读 0-triage.json.level === "L0" 跳过 |
| `customer-visible.md` 段头正则太严（`Done\s*$` 不允许尾随说明） | IS-001 | v5.2 已修：改为 `Done\b.*$` |
| handoff amend 改 state/* mtime，amend 后必须重 render BOARD | IS-001 | 手工补 + 应固化进 handoff-committer.md Step 11 |

### 2.5 复跑 checklist

下次需要复跑 L0 验证（如新装 b2r 版本时），按 IS-001 模板派 direct-fix sub-agent，**输入条件**：
- workflow.config.mjs 已就位
- state/active.md = Idle
- queue.md 含至少 1 条 Planned + 该条已被 0-triage 标 L0
- 改动目标文件存在

**通过判据**：
- [ ] direct-fix sub-agent 6 步全跑完
- [ ] impl commit 不含 state/* / BOARD.html（git show --stat 验证）
- [ ] handoff commit 含 state/* + BOARD.html + work/<slug>/receipts
- [ ] `verify:handoff <id>` 6/6 pass（Check 4 spec/plan 自动跳过）
- [ ] customer-visible.md 含 `## YYYY-MM-DD · <id> Done` 段（≥2 bullets）

---

## 3. L1 SIMPLE 验证方案 (待跑)

### 3.1 判据

工单**必须**全部满足：
- 单文件改动（跨多个文件 → 升 L2）
- 无新接口 / 无 schema 改动
- ≤ 30 行改动
- **但**包含逻辑变更或新函数（非纯文档 → 区别于 L0）

### 3.2 Stage 路径

```
0-triage → 1-planner → 2-promote → 2-merged (spec+plan+self-review) → 3-impl → 5-handoff → Done
```

跳过：独立 spec-plan-reviewer（自审内嵌于 plan-drafter）+ arch-security-reviewer（L1 不派）

sub-agent 调用：
1. **roadmap-planner**（Stage 1）— 同 L2/L3
2. **spec-drafter**（Stage 2a）— 同 L2/L3
3. **plan-drafter**（Stage 2b 合并）— **L1 专属**：附加 §6.X self-review checklist：
   - [ ] spec §4 文件范围与 plan §3 commit 范围一致
   - [ ] plan §1 Step 1 失败测试断言与 spec §7 targeted 对得上
   - [ ] §6 失败预案 ≥1 条具体到"哪一步 → 怎么处理"
   - [ ] 估时 ≤4 小时
   Self-review 任一项 fail → return blocked 让主线打回 spec retry
4. **implementor**（Stage 3）— 同 L2/L3
5. **handoff-committer**（Stage 5）— 同 L2/L3

### 3.3 提议验证用例

**候选工单**：`fix: pipeline-status.json 主线落盘时机`

具体内容：
- 改动目标：`skills/blueprint2real/agents/handoff-committer.md` 模板
- 改动内容：把 Step 11 "由主线写最终版本" 改成 "sub-agent 写预填版本到正确路径 + 主线在 commit 前最后确认 schema"（让 pipeline-status.json 进入 handoff commit，避免 amend）
- 实际行数预估：~25 行 modified（单文件）
- 无新函数（只是改 prompt 措辞）
- 无 schema 改动
- 无新依赖
- **属逻辑澄清**（不是纯文档 typo） → L1，非 L0

### 3.4 验证 checklist

执行：
- [ ] Stage 1: roadmap-planner sub-agent 派工 → 0-triage.json.level === "L1"
- [ ] Stage 2-promote: `npm run promote IS-XXX` → spec/plan/context 落到新结构
- [ ] Stage 2a: spec-drafter sub-agent 填 spec.md
- [ ] Stage 2b: plan-drafter sub-agent 填 plan.md **+ §6.X self-review checklist**（L1 专属）
- [ ] **不派 spec-plan-reviewer**（验证 L1 跳过独立 reviewer）
- [ ] Stage 3: implementor sub-agent TDD 红→绿 + impl commit
- [ ] **不派 arch-security-reviewer**（验证 L1 跳过 arch stage）
- [ ] Stage 5: handoff-committer sub-agent + verify:handoff 11/11 pass

通过判据：
- [ ] sub-agent 实际调用次数 = 4（planner + spec-drafter + plan-drafter + impl + handoff，共 5；不含 reviewer 与 arch）
- [ ] receipts/ 目录含 0-triage / 1-planner / 2-promote / 2a-spec / 2b-plan / 3-impl / 5-handoff = 7 个文件（**无 2c-review / 4-arch**）
- [ ] `2b-plan.json` 的 `l1_self_review_verdict === "READY_TO_IMPLEMENT"`
- [ ] verify:handoff 全过

### 3.5 待验证的设计点

- L1 路径的核心节省：**少派 2 个 sub-agent**（独立 reviewer + arch）。验证后能量化"L1 vs L2 token 消耗比"
- plan-drafter 内嵌 self-review 在 attempt > 1 时是否能像独立 reviewer 一样准确识别 NEEDS_REVISION
- L1 路径下 retry 1 次后升 Manager Override 的触发逻辑（与 L2/L3 一致 vs 简化）

---

## 4. L2 STANDARD 验证方案 (已通过)

### 4.1 判据

工单**必须**满足：
- 跨 2-3 文件
- 含新函数（区别于 L1）
- 无跨模块边界变化（区别于 L3）
- 无 schema / 无新依赖 / 无 migration / 无安全敏感面

### 4.2 Stage 路径

```
0-triage → 1-planner → 2-promote → 2a-spec → 2b-plan → 2c-review → 3-impl → 4-arch (轻量) → 5-handoff → Done
```

sub-agent 调用：7（planner / spec-drafter / plan-drafter / spec-plan-reviewer / implementor / arch-security-reviewer 轻量 / handoff-committer）

L2 与 L3 的关键差异：**4-arch 轻量**——`skills_used` 仅 `["security-review"]`，不调 `architecture` skill（因为 L2 判据"无跨模块边界变化"意味着没有架构决策需评估）。

### 4.3 已通过用例（IS-002）

**`IS-002`: validate-config 脚本与 RUNBOOK §13 checklist**
- 跨 6 文件（2 NEW + 4 MOD；spec drafter 修正 §4 时确认）
- 1 个新函数（`validateConfig({devRoot, configPath})`）
- 无 schema 改动 / 无新依赖
- 触及不变量 9 例外（b2r 元开发场景）

**执行链路**：
| Stage | sub-agent | receipt | 关键产出 |
|---|---|---|---|
| 0 / 1 | roadmap-planner | 0-triage / 1-planner | L2 标签 + queue.md 入 Planned |
| 2-promote | 主线 promote.mjs | 2-promote | spec/plan/context 落新结构 |
| 2a | spec-drafter | 2a-spec | spec 167 行 / 11 sections / 0 TBD |
| 2b | plan-drafter | 2b-plan | plan 151 行 / 5 TDD 断言 |
| 2c | spec-plan-reviewer | 2c-review | READY_TO_IMPLEMENT |
| 3 | implementor | 3-impl | impl `f003b2d3` / 58/58 tests / 4 regression pass |
| 4 | arch-security-reviewer 轻量 | 4-arch | READY_TO_HANDOFF (3 non-blocking concerns) |
| 5 | handoff-committer | 5-handoff + pipeline-status | handoff `c3fddfc7` / verify 11/11 |

### 4.4 已验证经验（IS-002 retro 5 条）

1. **sub-agent 早返回**：roadmap-planner 第一次 dispatch 只做边界分析没写盘，第二次加"全部跑完不要中途停下"才完成。**改进**：所有 agent prompt 模板顶部加显式"重要执行规则"段。
2. **spec drafter 自纠 §4 合规**：drafter 修正 0-triage.files_estimated 中错估的文件路径，是允许的。**改进**：reviewer checklist 应明示"§4 与 0-triage.files_estimated 不一致 ≠ fail"。
3. **handoff commit 实际范围 ⊋ "state/* + BOARD.html"**：L2+ 还含 `work/<slug>/` + `specs/<slug>.md` + receipts。**改进**：把不变量 4 改成"handoff commit = state/* + BOARD.html + 工单元数据（spec/plan/work/receipts）"。
4. **pipeline-status.json 落盘时机**：sub-agent 通过 return payload 上报，主线在 commit 后才写盘 → 触发 amend。**改进**：handoff-committer prompt Step 11 改"先由主线落盘再 commit"。
5. **active.md `Last commit` off-by-one**：amend 改 hash 但 active.md 还指向 amend 前的 hash。**改进**：active.md 改用 `Last handoff date` 字段（commit hash 在 queue.md 已有，去重）。

### 4.5 复跑 checklist

通过判据：
- [ ] receipts/ 目录含 9 个 receipt（0-triage / 1-planner / 2-promote / 2a-spec / 2b-plan / 2c-review / 3-impl / 4-arch / 5-handoff + pipeline-status.json）
- [ ] `4-arch.json.skills_used === ["security-review"]`（不含 "architecture"）
- [ ] verify:handoff 全 pass（含 Check 4 spec/plan 存在）

---

## 5. L3 COMPLEX 验证方案 (已通过)

### 5.1 判据

工单**必须**满足以下任一：
- 跨模块边界（影响 2+ 个独立模块）
- 新 schema（数据库 / 接口 / 配置字段）
- 新依赖（npm / system / service）
- 含安全敏感面（鉴权 / 密钥 / 客户数据 / 审计）
- 含 migration（数据迁移 / breaking change）

### 5.2 Stage 路径（两种变体）

**变体 A：完整 sub-agent 链（默认）**

```
0-triage → 1-planner → 2-promote → 2a-spec → 2b-plan → 2c-review → 3-impl → 4-arch (完整) → 5-handoff → Done
```

sub-agent 调用：7+（implementor 可能多次，每个 sub-slice 一次）

4-arch 完整：`skills_used === ["security-review", "architecture"]`

**变体 B：主线驱动 + 选择性 sub-agent（IS-003 模式）**

适用条件：
- 当前主线 thread 刚完成上游 spec（fresh context 充足）
- 工单纯文档 / 配置 / 工艺 — 无运行时代码
- token 预算敏感

执行：主线**自己**做 spec drafting + plan drafting + implementation，仅在质检关键节点派 sub-agent（或干脆 lint:redlines 0 命中后跳过 Stage 4）。

### 5.3 已通过用例

**完整链**：IS-002 是 L2，但完整链已验证；L3 变体 A 实际可参考。
**主线驱动**：IS-003 ~ IS-016 系列（onboard skill 14 条工单 + secrets 分发 4 条），全部 L3 + 主线驱动模式。retro 显示 token 节省约 70%。

### 5.4 已验证经验（IS-003 retro 4 条）

1. **slug 算法不一致**：roadmap-planner 在 Stage 1 用 node 脚本算 slug 时（删括号 + 删 +）与 promote.mjs 内置 `workItemSlug()` 不一致 → IS-003 出现两个 work 目录。**改进**：SKILL roadmap-planner.md 模板应让 sub-agent 直接调用 `workItemSlug({workId, title})` 而不是自由发挥。
2. **queue.md status 不自动同步 active.md**：主线翻 active.md In Progress 后忘了同步 queue.md（promote 只到 Ready）→ validate:state 报错。**改进**：考虑增 `npm run start <id>` 一条命令同步 active.md + queue.md 翻 In Progress。
3. **slug 含中文括号和 `+` 等字符可工作但路径处理 ugly**：现代工具链都能 handle，但**SKILL roadmap-planner.md 应建议工单标题尽量避免特殊字符**。
4. **主线驱动模式有效**（成功经验）：spec/plan/impl 主线完成，仅 reviewer 派 sub-agent；token 节省 70%。**改进**：SKILL.md 应明确这种简化的**触发条件**（如"当工单纯文档且主线刚完成上游 spec 时"），避免被误读成"任何工单都可绕 sub-agent"。

### 5.5 复跑 checklist

**变体 A（完整链）**通过判据：
- [ ] receipts/ 目录含 9 个 receipt（同 L2）但 `4-arch.json.skills_used === ["security-review", "architecture"]`
- [ ] 若 spec §5 含 schema / 接口变化 → 4-arch.json 中 arch reviewer 给出 trade-off 评估
- [ ] verify:handoff 全 pass

**变体 B（主线驱动）**通过判据：
- [ ] retro.md 含"主线驱动 vs sub-agent 链"决策依据条目
- [ ] 至少 Stage 4 arch-reviewer 或 Stage 5 verify:handoff 由独立 sub-agent / 脚本兜底（避免主线既起草又审）
- [ ] 工单 commit message 明示走"主线驱动 + 选择性 sub-agent"路径

---

## 6. L4 ULTRA 是否引入

### 6.1 当前 L3 是否覆盖所有复杂度

观察 IS-003 ~ IS-016 系列（14 条 onboard skill 工单 + 4 条 secrets 分发工单），全部以 L3 处理。其中：
- 含跨模块边界（多次）
- 含新 schema（onboard audit yaml schema、secrets manifest schema 等）
- 含新依赖（Infisical Docker）
- 含安全敏感面（secrets 分发整条链路）
- 含 migration（凭证迁移）

**结论**：L3 判据足够覆盖到目前为止的所有"复杂"工单。无需 L4。

### 6.2 何种情况会迫使引入 L4

**假设触发条件**（任一）：
- 跨服务（>1 个独立 service，每个 service 自己的 b2r-process 实例）
- 跨 repo（需要协调 main repo + plugin repos 同时变更）
- 产线 hotfix（必须含 rollout plan + monitoring + on-call handoff）
- 灰度发布（>1 个发布阶段 + 阶段间观测期 + 灰度回滚预案）
- 客户合规审计触发的整改

**Stage 路径设计草图**（如果引入）：

```
0-triage → 1-planner → 2-promote → 2a-spec → 2b-plan → 2c-review → 3-impl → 4-arch (完整) → 4b-rollout (新) → 5-handoff → Done
```

新增 4b-rollout：
- sub-agent: `rollout-planner` — 出 rollout plan（阶段 / 观测指标 / 回滚预案）
- 产物: `4b-rollout.json`（含 stages, observability_metrics, rollback_steps）
- 与 5-handoff 协作：handoff commit 含 rollout-plan.md，customer-visible.md 段含"灰度 stage 1 已发"字段

### 6.3 决议

**暂不引入 L4**。理由：
- IS-003 ~ IS-016 全部 L3 处理且未 Manager Override → L3 容量充足
- 引入 L4 会增加判据决策成本（L3 vs L4 模糊地带容易争议）
- 若未来真有"跨服务 + 灰度 + 合规审计"工单，先评估能否用"L3 + 多个 sub-slice"切分

**重新审视触发点**：当**累计 ≥3 条 L3 工单触发 Manager Override 且都因"L3 路径不足"**时，再讨论引入 L4。

---

## 7. 跨等级共性验证

无论哪个等级，下列 5 项必须满足：

### 7.1 Pre-flight

- [ ] `state/active.md` = Idle（exactly-one 不变量）
- [ ] `workflow.config.mjs` 存在且 `npm run validate:config` 退出 0
- [ ] `npm run validate:state` 退出 0
- [ ] `BOARD.html` 已 render 且 mtime ≥ 所有 state/*.md
- [ ] 当前 worktree 干净（无外部并发 commit 风险，IS-001 经验）

### 7.2 Regression 套件

最低限度（与 `workflow.config.regressionCommands` 一致或子集）：
- `cd skills/blueprint2real/bootstrap/workflow && npm test`
- `cd b2r-process && npm run validate:state`
- `cd b2r-process && npm run validate:config`
- `cd b2r-process && npm run render:board`

若工单触及 npm test 应跑的代码路径（如 src/utils/* 改动），还要跑项目主 `npm test`。

### 7.3 Handoff verify

`npm run verify:handoff <id>` 必须全 pass：
- L0：6/6 pass（skip Check 4 spec/plan）
- L1：6/6 pass（skip Check 4 spec.md only? 待 L1 验证后确认）
- L2/L3：11/11 pass

### 7.4 Retro 记录

非 Manager Override 工单**也鼓励**在 retro.md 写一段（如 IS-002 / IS-003 经验段），覆盖：
- 失败链（即便无 fail：写过程中遇到的小问题）
- Manager 决策（无 override 时写"无 override"）
- 1 行经验

### 7.5 Commit 物理分离

- impl commit：仅含 spec §4 范围内代码，**不含** state/* / BOARD.html / work/<slug>/* / specs/<slug>.md
- handoff commit：含 state/* + BOARD.html + work/<slug>/{plan,context-pack,receipts/*} + specs/<slug>.md

---

## 8. 已知改进项汇总（来自 retro.md）

按改进对象分类：

### 8.1 SKILL.md / agent prompt 模板改进

- 所有 agent prompt 顶部加"重要执行规则"段（避免 sub-agent 早返回）— **IS-002 经验**
- roadmap-planner.md 明确"slug 必须调 `workItemSlug({workId, title})`"— **IS-003 经验**
- handoff-committer.md Step 11 改"先落盘 pipeline-status.json 再 commit"— **IS-002 经验**
- handoff-committer.md 加"amend 后必须重 render BOARD" 一步 — **IS-001 经验**
- spec-plan-reviewer.md checklist 加"§4 与 0-triage.files_estimated 不一致 ≠ fail" — **IS-002 经验**
- 不变量 4 措辞更新："handoff commit = state/* + BOARD.html + 工单元数据" — **IS-002 经验**
- SKILL.md 加"主线驱动 + 选择性 sub-agent" 触发条件 — **IS-003 经验**

### 8.2 脚本兜底改进

- 新增 `npm run start <id>` 同步 active.md + queue.md 翻 In Progress — **IS-003 经验**
- active.md schema：去掉 `Last commit` 字段（commit hash 在 queue.md 已有）— **IS-002 经验**
- 所有引用"Done 必须有 spec/plan"的脚本做全套 L0 兼容审计 — **IS-001 经验**
- pipeline-status.json 单写者契约重新评估（是否允许 sub-agent 写最终版） — **IS-002 经验**

### 8.3 工作流约束改进

- sub-agent 跑期间用户避免 `git add -A`（用 worktree 隔离更稳）— **IS-001 经验**
- skill bundle 分发策略：随项目发布 / submodule / 独立包三选一 — **跨工单经验**
- 工单标题建议避免中文括号 / `+` / `§` 等特殊字符（slug 越简越好）— **IS-003 经验**

---

## 9. 复用本方案

### 9.1 下次跑各等级验证

执行顺序建议（如果从零开始系统验证）：
1. **L0** — 派 direct-fix sub-agent 一次（≤30 行 doc 改动用例）
2. **L1** — 按本文 §3.3 候选用例派 4 个 sub-agent（含 plan-drafter 内嵌 self-review）
3. **L2** — 完整 7 stage 派 6-7 个 sub-agent（参考 IS-002）
4. **L3** — 选变体 A 或 B 跑一次

每跑完一个等级，**当场把 retro 经验回填本文 §X.4 与 §8**。

### 9.2 升级 b2r 版本后回归

b2r v5.2 → v5.3 升级时，按本文 4 个等级各跑一次"smoke test"，确保旧路径全部仍可走通。

### 9.3 新增等级（如 L4）的接入

如果未来引入 L4，按本文 §3-§5 结构补一节 §10 L4 验证方案，包含：
- 判据
- Stage 路径（含新增 stage 如 4b-rollout）
- 验证用例
- 通过 checklist

---

## 附录：路径与命令速查

**b2r 默认目录**：`b2r-process/`
**skill bundle 默认位置**：`skills/blueprint2real/`

**常用命令**（在 `b2r-process/` 目录下跑）：

| 用途 | 命令 |
|---|---|
| 校验 state/* | `npm run validate:state` |
| 校验 workflow.config | `npm run validate:config` |
| 渲染 BOARD | `npm run render:board` |
| 提升 Planned → Ready | `npm run promote <id>` |
| 验证 handoff | `npm run verify:handoff <id>` |
| 全套 workflow 单测 | `cd ../skills/blueprint2real/bootstrap/workflow && npm test` |

**receipt 路径**：`work/<slugDir>/receipts/<stage_id>.json`
**spec 路径**：`specs/<slugDir>.md`
**plan / context-pack 路径**：`work/<slugDir>/{plan,context-pack}.md`
