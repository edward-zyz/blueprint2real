# blueprint2real · 多机并行工单编号方案（时间戳号）设计

- 状态：设计已与用户确认，待评审
- 日期：2026-06-02
- 范围：仅解决多 worktree/分支并行时的工单编号撞号。UI 设计（#1）、E2E 验收（#2）为独立 spec。与 #2 仅在"FAIL 生成的修复工单走本编号方案"处相接，无深耦合。

## 1. 问题

工单编号 `IS-NNN`（3 位补零、全局顺序递增），新号在 Stage 1 roadmap-planner 往 `queue.md` 加 Planned 时按"现有最大号 +1"分配。

并行拓扑为**多 git worktree/分支各跑一个 b2r 实例、事后 merge 回 master**。每个 worktree 看自己的 `queue.md` 副本独立发号 → 多实例都算出同一个 `IS-046` → **merge 回 master 时撞号**（两条不同工单共用一个号 / queue.md 表行语义冲突）。

## 2. 目标与非目标

### 目标
1. 多 worktree 并行发号**不再产生语义重号**，merge 回 master 时各工单 ID 天然互异。
2. 零中心协调、离线可用（贴 blueprint2real git-based、无中心 infra 的定位）。
3. 保留**全局时间顺序**（可读、可排序）。
4. 向后兼容：存量项目（现有 `IS-001…`）不动，并行项目显式开启新方案，两种号可共存。

### 非目标
- 不解决 `queue.md` 的**文本级** merge 冲突（两分支各 append 不同行属正常 git merge，见 §6）——本方案只消除**语义重号**。
- 不做中心发号服务 / 不引入运行时依赖。
- 不追求"数学上跨机绝不撞"（见 §3 诚实边界）；以"工单不同时间发"为前提接受极小残留。
- 不实现 #1 / #2。

## 3. 决策记录（用户已确认）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 并行模型 | 多 worktree/分支各跑 b2r，merge 回 master | 用户确认的实际拓扑 |
| 编号方案 | **时间戳号**（直接以发号时刻为序列号） | 时间戳天然唯一 + 天然全局有序，零协调；契合"每个工单不同时间发"的事实 |
| 格式 | `<prefix>-YYMMDD-HHMMSS`（如 `IS-260602-143052`，秒级、带分隔符） | 一眼可读出日期/时刻，全局有序 |
| tiebreaker | **无尾缀**；同秒批量靠本地顺延 | 用户要最简；尾缀降可读性 |
| 跨机同秒 | **接受极小残留风险** | 时间单靠精度无法保证跨机不撞（诚实边界）；"工单不同时间发"前提下残留实际可忽略 |
| 开关 | `config.idScheme: 'sequential' \| 'timestamp'`，默认 `sequential` | 存量项目零改动；并行项目显式启用；两种号共存 |

### 诚实边界（写入设计，避免假承诺）
光靠时间、无论精度多高，都**无法在数学上保证多 worktree 绝不撞**——两台机器可读到同一时刻。要"构造级绝不撞"必须引入 per-instance 熵（随机/分片尾缀）或中心协调。本方案**有意不引入**，以"工单在不同时间发出"为前提接受残留：残留只在"两 worktree 恰在同一秒各发一条"时发生，这恰违背前提，实际可忽略。若将来该前提不成立，升级路径见 §8。

## 4. 设计

### 4.1 ID 格式与 scheme 开关

- `config.idScheme = 'timestamp'`：ID = `<workIdPrefix>-YYMMDD-HHMMSS`（秒级，本地时区）。`workIdDigits` 在此模式下被忽略。
- `config.idScheme = 'sequential'`（默认）：维持现状 `<prefix>-NNN`（`workIdDigits` 位补零，max+1）。

### 4.2 发号：`mintWorkId(config, existingIds, now)` helper（落 `config.mjs`）

确定性发号逻辑集中到一个 helper（**非 LLM 凭空捏造时间戳**——由脚本/主线用真实时钟调用）：

- `sequential`：`existingIds` 最大数值 +1，按 `workIdDigits` 补零。
- `timestamp`：
  1. 用 `now`（真实 `Date`）格式化为 `<prefix>-YYMMDD-HHMMSS`。
  2. **同秒批量本地顺延**：若该 ID 已在 `existingIds` 中（同机同秒/同批创建），`now` 加 1 秒重算，直到取到本地空闲值。ID 形态仍是纯时间戳，仅同秒的第二条顺延 1 秒。
- 时间源说明：b2r `workflow/scripts/*.mjs` 是普通 Node 脚本（非受限的 Workflow-tool 脚本），`new Date()` 可用。

发号调用点：
- Stage 1 roadmap-planner 批量加 Planned（主线为每条调用 helper 取号，传入当前已存在 ID 集，逐条顺延；planner 只产标题/范围，不自造号）。
- #2 E2E FAIL 生成修复工单时同样走 helper。

### 4.3 正则/工具兼容两种 scheme

`config.mjs` 的 `makeWorkIdRegex` / `makeWorkIdPattern` 放宽为同时匹配两种形态，使存量 `IS-001` 与新 `IS-260602-143052` 在同一 `queue.md` 共存、平滑切换：

```
<prefix>-(?:\d{<digits>,}|\d{6}-\d{6})
```

- `workItemSlug({ workId, title })` 不变（仍 `<workId>_<slug>`）；`slugDir` 形如 `IS-260602-143052_<title-slug>`。

### 4.4 跨 worktree 行为

- 不同 worktree 在不同时刻发号 → 时间戳不同 → merge 回 master 各 ID 互异，**无语义重号**。
- 同秒跨机残留：见 §3 / §6。

## 5. 改动面

| 文件 | 改动 |
|---|---|
| `bootstrap/workflow/scripts/config.mjs` | 加 `idScheme` 默认值 + `mintWorkId()` helper；`makeWorkIdRegex`/`makeWorkIdPattern` 放宽兼容两形态 |
| `bootstrap/workflow/scripts/validate-config.mjs` | 校验 `idScheme ∈ {sequential, timestamp}`（缺省 sequential 合法） |
| `bootstrap/workflow/scripts/validate-state.mjs` | 工单 ID 校验兼容两形态（不因存量 `IS-NNN` 与新时间戳并存而报错） |
| `bootstrap/workflow/scripts/promote.mjs` | 不受影响（接收已有 ID 作参数，不发号）；仅依赖放宽后的 regex |
| `agents/roadmap-planner.md` | prompt 明确：工单号由主线 `mintWorkId` 发，planner 不自造；占位填发好的号 |
| `workflow.config.mjs`（模板 + 文档） | 文档说明 `idScheme` 何时设 `timestamp`（多 worktree 并行项目） |
| `AGENT_RUNBOOK.md` §1 | 补一句两种编号 scheme 的说明 |

## 6. 边界与残留

- **跨机同秒残留**：两 worktree 同一秒各发一条 → 撞。以"工单不同时间发"前提接受（§3）。
- **`queue.md` 文本级 merge 冲突**：两分支各 append 不同行，git 仍可能在表区报文本冲突——这是**正常 git merge**，非语义重号；本方案不消除（append-only 行多数可顺利合并，冲突时人工/普通 merge 解决）。范围外。
- **存量共存**：切换 `idScheme=timestamp` 后，旧 `IS-NNN` 行保留不改写，新行为时间戳；regex/validate 两者皆容。无需重编号迁移。
- 以上残留均不涉安全/权限/审计/数据污染，符合带入下一轮的例外条件。

## 7. 验收口径

1. **sequential 默认不变**：未设 `idScheme` 的项目发号、regex、validate 行为与现状一致。
2. **timestamp 发号**：`idScheme=timestamp` 时 `mintWorkId` 产 `<prefix>-YYMMDD-HHMMSS`；注入固定 `now` 可断言确定输出。
3. **同秒批量顺延**：传入同秒、已占用的 `existingIds`，helper 顺延取到本地空闲值，互不重复。
4. **两形态共存**：放宽后的 regex 同时匹配 `IS-001` 与 `IS-260602-143052`；`validate-state` 对混合 `queue.md` 0 error。
5. **config 校验**：`idScheme` 非法值字段级报错；缺省退出码 0。
6. **planner 不自造号**：roadmap-planner prompt 指明号由主线发；占位填入。
7. **promote 不回归**：现有 promote 流程在放宽 regex 下照常工作。

## 8. 升级路径（若"不同时间发"前提将来不成立）

若并发密度升高到"同秒跨机发号"成为现实风险，最小升级 = 给 `mintWorkId` 的 timestamp 分支加一个 per-instance 尾缀（分支名短哈希或 2 字符随机，即先前讨论的 D2），ID 变 `<prefix>-YYMMDD-HHMMSS-<2char>`，构造级不撞。helper 单点改动，不影响调用方与已有 ID。
