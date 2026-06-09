# blueprint2real 过度拆分优化方案（最终版）

> 目标：消除「内聚特性被拆成多张线性工单 → 固定开销被乘以工单数」的无用功。
> 原则：把「该 1 工单多 slice 还是 N 工单」的决策，从**无人负责** → 前移到 planner **机械检测 + 人确认**。不自动合并、不新增基建、不新增 receipt 字段。

---

## 1. 问题与实证

最近一批 `IS-260609-113345` 是 5 张工单，严格线性依赖链：

```
oi (schema: +列/cancelled/三 store 对偶, L3)
 └→ p2 (derivedStatus 派生 + 截止闸门, L2, 依赖 oi)
     └→ j3 (listSurveys 聚合 + meta 补齐, L2, 依赖 oi+p2)
         └→ yi (首页密行列表 + 筛选纯函数, L1, 依赖 j3)
             └→ mo (close/cancel 路由 + 前端入口, L2, 依赖 oi+p2+yi)
```

全在同一个包 `packages/_sdk/survey`、共享同一 schema 基座，本质是**一个内聚特性被切成 5 张工单**。

**后果**：每张工单付一遍固定开销——逐 stage sub-agent dispatch 往返（每次 fresh context 重读 docs）＋ Stage 5 全量 `npm test`（retro 已五次备案为 flake 雷区）＋ 独立 handoff commit ＋ BOARD render。链是严格线性的、**无并行收益**，固定开销 ×5 = 纯浪费。

**根因**：roadmap-planner 用 `brainstorming`＋`writing-plans` 拆切片，二者天性往细拆成独立工单；而 sub-slice（同一 IS-NNN 内多个独立 commit）的声明点在后面的 spec §4，等到那时工单已 mint 进 `queue.md`。**「该不该是独立工单」这个决策当前没有任何节点负责。**

> 注：L0–L3 分级已经把「审查/设计」类重 stage 按工单大小跳过了（L1 实测只跑 triage/spec/plan/impl/handoff，跳过 reviewer＋arch）。本方案**不动分级**，只补「固定开销 × 工单数」这一块。

---

## 2. 方案（动 3 个文件，零新字段、零新 gate、零自动合并）

### 改动 1 · roadmap-planner 加「合并候选检测 + 提问」

planner 出 backlog proposal 时，对本批切片跑一个**机械检测**（集合交 ＋ 图单链，可证伪，**非模糊判断**）。命中**全部**硬条件的连续切片标 `coalesce_candidate`：

| 硬条件 | 判法 |
|---|---|
| `files_estimated` 同包前缀 | 路径前缀集合相交非空 |
| 依赖构成严格单链 | 依赖图上一条路径，无分叉、无并行收益 |
| 链上每条 ≤ L2 | L3 自动出局（**无需「L3 强制独立」豁免条款**——含 schema/migration/安全的链天然不满足「每条 ≤L2」） |
| 同 milestone | 防跨里程碑误并污染批次 E2E 分组 |
| 同 ui 标 | 防后端 slice 被拖进 mockup 流程 / 前端 slice 漏 Stage 3.5 fidelity 闸 |

命中 → 主线**必须 `AskUserQuestion`**：

> 「检测到 N 条切片是同包线性链，无并行收益。合成 1 工单 ＋ N sub-slice 可省 N-1 遍 spec/plan/review/regression/handoff。是否合并？」

**由人拍板，planner 不自动合并**（workId 未定型时不做结构决策）。此机制同构于既有 O27 `ui_paths_stale` → AskUserQuestion。

被合并的切片**从不单独 mint workId**（直接作为 sub-slice 存在）——因此不存在「跨批工单引用中间号 → 合并后断边」的风险。

### 改动 2 · spec-drafter 补 sub-slice 段

spec-drafter 模板**目前完全没有 sub-slice 段**，不补它就不会落。补一小段：

> 当工单确定走多 slice 时，按 **RUNBOOK §11** 在 spec §4 写 `### Sub-slice 列表`（`slice 1/M … slice M/M`，按交付顺序）。

复用 §11 既有格式，**不新增 receipt 字段**。追溯靠 `queue.md` §Planned 摘要**一行散文**（「含原 N 切片: …」），不进 receipt schema。

### 改动 3 · 固化 flake 放行纪律（治固定开销，无新基建）

把 retro 已反复手工执行的纪律写进 SKILL.md Stage 5 段：

- 全量 `npm test` 在本仓**恒带预存 flake**；
- 收敛 regression 的**真 gate = 受影响套件绿 ＋ `validate:state` ＋ `render:board`**；
- 全量红**不阻断**，只触发 `grep ^FAIL` → 隔离重跑 → `git diff` 二分核查；
- **不建受影响包映射表**（避免 `ui.uiPaths` 同款陈旧维护债）——「受影响」由主线收敛时按 retro 既有手法判定。

---

## 3. 护栏（最高危雷，必带）· level 一致性 Gate 按 slice 评估

Gate 的「实际改动文件数 vs 初判 level」校验若**整工单累加** slice 文件数，合并工单几乎必然撑爆 L2 阈值 → 误判升档 L3 → 走完整 7-stage，把省下的开销**全部吐回**。

写进 SKILL.md Gate 段一句规则澄清：

- 多 slice 工单：`level = max(slice levels)`；
- 「实际改动文件数 vs 初判 level」校验**按 slice 分摊**，不整工单累加；
- 多 slice 工单**末切片仍全量跑一次** regression（保证跨工单/跨 slice 回归不漏网）。

---

## 4. 明确砍掉 / 不做（防过度设计）

| 砍掉项 | 理由 |
|---|---|
| LLM 自动合并 | 要让自动合并安全需 ≥5 条谓词 = 本身就不该交给 LLM 判断；改人确认 |
| 新 receipt 字段 `sub_slices` / `coalesced_from` | 不 mint 中间号则无跨批引用断裂；追溯靠 queue 摘要一行即可 |
| 「M 切片→N 工单」专门播报 | AskUserQuestion 本身就是 surfacing，重复 |
| 受影响包映射表 | = `ui.uiPaths` 同款维护债；靠主线收敛时判定 |
| 相邻工单复用 fresh context（降 dispatch） | sub-slice 已对「过度拆分」这一主因消除了 dispatch 倍增，单独做是 scope creep |
| 「L3 强制独立」豁免条款 | 「每条 ≤L2」已天然排除 L3 链，多余 |
| regression 按 level 缩面到「受影响包」 | 会让跨工单回归漏网、且需维护映射表；改为「flake 不阻断 + 末切片全量」 |

---

## 5. 改动清单

| # | 文件 | 改动 | 量级 |
|---|---|---|---|
| 1 | `agents/roadmap-planner.md` | 加机械检测 `coalesce_candidate` ＋ 主线 AskUserQuestion 触发条款 | 中 |
| 2 | `agents/spec-drafter.md` | 补 spec §4 `### Sub-slice 列表` 落盘段（指向 RUNBOOK §11） | 小 |
| 3 | `SKILL.md` | (a) Stage 5 flake 放行纪律；(b) Gate level 按 slice 分摊护栏 | 小 |

**净效果**：对「同包线性链」这一主因，固定开销从 ×N 降到 ×1（回滚粒度靠 sub-slice 独立 commit 保留）；对所有工单，消除每次重新论证 flake 放行的重复成本。无新字段、无新 gate、无自动合并。

---

## 6. 建议执行方式

这套改进自身适合作为 b2r 的 dogfood 样例：改动 1＋2＋3＋护栏可收成 **1 张工单 ＋ 3 sub-slice**（恰好演示本方案要解决的形态）。建议先按本方案范围起一张 spec 走 b2r 流程落地。
