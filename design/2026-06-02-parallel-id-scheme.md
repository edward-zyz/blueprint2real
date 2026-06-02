# blueprint2real · 多机并行工单编号方案（时间戳号）设计

- 状态：设计已与用户确认 + 经 sub-agent 评审修订，待二次评审
- 日期：2026-06-02
- 范围：仅解决多 worktree/分支并行时的工单编号撞号。UI 设计（#1）、E2E 验收（#2）为独立 spec。与 #2 仅在"FAIL 生成的修复工单走本编号方案"处相接，无深耦合。

## 1. 问题

工单编号 `IS-NNN`（3 位补零、全局顺序递增），新号在 Stage 1 roadmap-planner 往 `queue.md` 加 Planned 时按"现有最大号 +1"分配。

并行拓扑为**多 git worktree/分支各跑一个 b2r 实例、事后 merge 回 master**。每个 worktree 看自己的 `queue.md` 副本独立发号 → 多实例都算出同一个 `IS-046` → **merge 回 master 时撞号**（两条不同工单共用一个号 / queue.md 表行语义冲突）。

## 2. 目标与非目标

### 目标
1. 多 worktree 并行发号**构造级不再产生语义重号**，merge 回 master 时各工单 ID 互异。
2. 零中心协调、离线可用（贴 blueprint2real git-based、无中心 infra 的定位）。
3. 保留**全局时间顺序**（可读、可排序）。
4. 向后兼容：存量项目（现有 `IS-001…`）行**只读保留不改写**，并行项目显式切换后**只新增时间戳号**（纯切换，非长期混合发号）。

### 非目标
- 不解决 `queue.md` 的**文本级** merge 冲突（两分支各 append 不同行属正常 git merge，见 §6）——本方案只消除**语义重号**。
- 不做中心发号服务 / 不引入运行时依赖。
- 不做存量号的重编号迁移。
- 不实现 #1 / #2。

## 3. 决策记录（用户已确认；★ = 经评审修订）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 并行模型 | 多 worktree/分支各跑 b2r，merge 回 master | 用户确认的实际拓扑 |
| 编号方案 | **时间戳号 + 2 字符尾缀**（D2） | 时间戳天然全局有序 + 尾缀提供 per-instance 熵 → 构造级不撞 |
| ★ 格式 | `<prefix>-YYMMDD-HHMMSS-<2char>`（如 `IS-260602-143052-7f`，秒级 + base36 随机尾缀） | 评审指出：Stage 1 批量发号 + 多 worktree 常同时启动，"同秒"恰是高发区，纯时间戳残留非零；2 字符边际复杂度极低却把残留压到构造级 |
| ★ 共存策略 | **纯切换**：切到 timestamp 后只新增时间戳号，旧 `IS-NNN` 只读保留 | 评审指出"同 queue.md 混合发号"会引入 sequential mint 遇时间戳号的未定义行为 + 混合排序歧义；纯切换砍掉这层复杂度 |
| 开关 | `config.idScheme: 'sequential' \| 'timestamp'`，默认 `sequential` | 存量项目零改动；并行项目显式启用 |

### 诚实边界（写入设计，避免假承诺）
加 2 字符 base36 尾缀后，跨机同秒撞号需要"两 worktree 在同一秒、各自随机尾缀又恰好相同"——单次同秒事件的碰撞概率 ≈ 1/1296，且尾缀随机独立于时钟。这是**构造级低**而非数学零（生日问题意义上非零）。本方案接受这一极低残留；若极端高并发下仍出现实际撞号，升级路径见 §8。

## 4. 设计

### 4.1 ID 格式与 scheme 开关

- `config.idScheme = 'timestamp'`：新号 = `<workIdPrefix>-YYMMDD-HHMMSS-<2char>`（秒级本地时区 + 2 位 base36 随机尾缀，字符集 `[0-9a-z]`）。`workIdDigits` 在此模式下被忽略。
- `config.idScheme = 'sequential'`（默认）：维持现状 `<prefix>-NNN`（`workIdDigits` 位补零，max+1）。
- **纯切换语义**：项目一旦 `idScheme=timestamp`，发号路径只走 timestamp 分支；旧 `IS-NNN` 行保留只读（供 validate/render/依赖解析读取），不再被 sequential mint 触碰。

### 4.2 发号：`mintWorkId(config, existingIds, now)` helper（落 `config.mjs`）

确定性发号逻辑集中到一个 helper（**非 LLM 凭空捏造时间戳**——由脚本/主线用真实时钟调用）：

- `sequential`：`existingIds` 中**仅纯 `\d{workIdDigits,}` 形态**取最大数值 +1，补零（显式忽略任何时间戳形态号，防混合 existingIds 下 NaN）。
- `timestamp`：
  1. 用 `now`（真实 `Date`）格式化 `<prefix>-YYMMDD-HHMMSS`，附 2 位 base36 随机尾缀。
  2. **本地去重保障**：若该完整 ID 已在 `existingIds` 中（同机同秒同尾缀，极罕见），重掷尾缀重算，直到本地空闲。尾缀随机已覆盖同秒批量场景，无需"顺延 1 秒"。
- 随机源说明：b2r `workflow/scripts/*.mjs` 是普通 Node 脚本（非受限的 Workflow-tool 脚本），`new Date()` 与随机数可用。

发号调用点：
- Stage 1 roadmap-planner 批量加 Planned（主线为每条调用 helper 取号，传入当前已存在 ID 集；planner 只产标题/范围，不自造号）。
- #2 E2E FAIL 生成修复工单时同样走 helper。

### 4.3 正则/工具兼容两种 scheme（READ 端）

发号是纯切换（只产一种），但 `queue.md` 仍同时存在旧 `IS-001` 与新 `IS-260602-143052-7f` 行，**读取/解析端**正则必须同容。`config.mjs` 的 work-id 正则放宽，**时间戳分支放最前**（关键：避免交替分支在无右边界扫描下部分匹配）：

```
<prefix>-(?:\d{6}-\d{6}-[0-9a-z]{2}|\d{<digits>,})
```

- **为什么分支顺序是 P0**：正则交替 leftmost-first。若把 `\d{N,}` 放前，`IS-260602-143052-7f` 会先被 `\d{N,}` 吞成 `IS-260602`（在 `extractDependencies` / `render-dependencies` 的**无右边界 `g` 全局扫描**里没有边界回溯救回）→ 依赖号被截成日期前缀 → promote 的"前置依赖 Done"门（不变量 5）误报依赖不存在，阻断所有带依赖的时间戳工单。时间戳分支在前则先整体匹配成功。
- `makeWorkIdLoosePattern`（现为 `IS-\d+`）与 `WORK_ID_STRICT`（现为 `^IS-\d+$`，见 render-board）**同样放宽**为上述形态，否则 BOARD 把 `IS-260602-143052-7f` 显示/排序成 `IS-260602`（丢秒段+尾缀）。
- `workItemSlug({ workId, title })` 不变（仍 `<workId>_<slug>`）；`slugDir` 形如 `IS-260602-143052-7f_<title-slug>`。

### 4.4 跨 worktree 行为

- 不同 worktree 在不同时刻发号 → 时间戳不同；同秒则尾缀随机互异 → merge 回 master 各 ID 构造级互异，**无语义重号**。
- 极低残留：见 §3 / §6。

## 5. 改动面

> **不变量 #9 边界**：下表中 `bootstrap/workflow/scripts/*` 全是**底盘文件**——按不变量 #9，skill 主线/sub-agent **不得直接 Write/Edit**。这些是 **skill 自身演进**：改 skill 源的 `bootstrap/workflow/` 资产 + 用户重跑 `init.mjs --bootstrap` 分发，**不是** b2r 跑流水线时就地能加的运行期行为。`agents/*.md` 不在 #9 底盘清单内，可正常改。

### 5.1 底盘资产层（改源 + 走 bootstrap 重新分发）

| 文件 | 改动 |
|---|---|
| `config.mjs` | 加 `idScheme` 默认值 + `mintWorkId()` helper；放宽 `makeWorkIdRegex`/`makeWorkIdPattern`/`makeWorkIdLoosePattern`（时间戳分支在前） |
| `validate-config.mjs`（壳）/ `config.mjs`（实际校验逻辑） | 校验 `idScheme ∈ {sequential, timestamp}`（缺省 sequential 合法） |
| `validate-state.mjs` | 工单 ID 校验用放宽后正则（混合 `IS-NNN` + 时间戳号 0 error） |
| `promote.mjs` | 不主动发号；`extractDependencies` 的 `g`-扫描依赖放宽正则**正确分支顺序** |
| `render-dependencies.mjs` | `depRe = new RegExp(workIdPattern,'g')` 同走放宽正则（依赖图/环检测不被截断） |
| `render-board.mjs` | `makeWorkIdLoosePattern` + `WORK_ID_STRICT` 放宽（HERO「上一轮出产」/段落 split/sort 不丢尾缀） |
| `verify-handoff.mjs` | `makeWorkIdRegex/Pattern` + `WORK_ID_LABEL` 随放宽正则，Stage 5 handoff gate 对时间戳号全过 |
| `workflow.config.mjs.tmpl` | 加 `idScheme` 注释块 + 说明何时设 `timestamp`（多 worktree 并行项目） |
| `AGENT_RUNBOOK.md.tmpl` §1 | 补两种编号 scheme 说明 |

### 5.2 Prompt / 编排层（可正常改）

| 文件 | 改动 |
|---|---|
| `agents/roadmap-planner.md` | prompt 明确：工单号由主线 `mintWorkId` 发，planner 产标题/范围 + 占位符，不自造号 |
| `SKILL.md` Stage 1 描述 | 同步说明"planner 产占位 → 主线回填发好的号"的数据流 |

## 6. 边界与残留

- **跨机同秒残留**：构造级低（≈1/1296 per 同秒同机事件，见 §3），接受为已知风险。
- **`queue.md` 文本级 merge 冲突**：两分支各 append 不同行，git 仍可能在表区报文本冲突——这是**正常 git merge**，非语义重号；本方案不消除。范围外。
- **存量共存（只读）**：切换后旧 `IS-NNN` 行保留不改写、不再发同形态新号；读取端正则两者皆容。无重编号迁移。
- 以上残留均不涉安全/权限/审计/数据污染，符合带入下一轮的例外条件。

## 7. 验收口径

1. **sequential 默认不变**：未设 `idScheme` 的项目发号、regex、validate 行为与现状逐字节一致（含"传入任意 `now`，sequential 输出不变"）。
2. **timestamp 发号**：`idScheme=timestamp` 时 `mintWorkId` 产 `<prefix>-YYMMDD-HHMMSS-<2char>`；注入固定 `now` + 固定随机种子可断言确定输出。
3. **同秒批量**：传入同秒多次调用，尾缀互异、无重复（本地去重命中时重掷）。
4. **混合 existingIds 喂 sequential**：existingIds 含时间戳号时 sequential 分支只对纯 `\d{N}` 算 max、忽略时间戳号，不产 NaN。
5. **正则无右边界 g-扫描**（P0 回归）：`"依赖：IS-260602-143052-7f / IS-260700-090000-a3。".match(放宽正则的 g 形态)` 返回**完整两号**，不被截成日期前缀。
6. **读取端全覆盖**：放宽后 `validate-state` / `promote`（依赖门）/ `render-dependencies`（依赖图）/ `render-board`（loose+strict）/ `verify-handoff` 对混合 `queue.md` 与纯时间戳号均正确，无截断、无误报。
7. **config 校验**：`idScheme` 非法值字段级报错；缺省退出码 0。
8. **planner 不自造号**：roadmap-planner prompt 指明号由主线发；SKILL.md Stage 1 数据流同步。

## 8. 升级路径（若构造级残留仍不够）

极端高并发下若 2 字符尾缀仍出现实际撞号（出现 1 次即触发），最小升级 = 尾缀加长到 3-4 位 base36（碰撞概率再降两个数量级），`mintWorkId` 单点改动，不影响调用方与已有 ID。再不够则引入 per-instance 分片前缀（分支名短哈希），彻底构造级不撞。
