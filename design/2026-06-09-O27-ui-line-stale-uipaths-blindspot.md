# O27 · UI 设计线第二个静默盲区:有 ui 块但 uiPaths 陈旧/不覆盖目标目录

> 状态:已实施（2026-06-09 落地；eval 网 95/95 绿）
> 类别:防假绿 / 防静默少交付
> 编号:O27（O 序列衔接 `v5.4-优化落地清单.md` O1–O26；本条是 **O15 的对称补全**）
> 触发来源:2026-06-09 insight-subs 仓「数字员工工作台 /agent IM 交互重构」派单前的 triage 复盘
> 关联:O15（UI 线靠 config 块存在性静默开关）—— 本条堵的是 O15 兜底逻辑漏掉的另一半

---

## 一、前因后果（这次怎么撞上的）

insight-subs 本批要做的是 **数字员工工作台 `/agent`（`web/src/views/agent/**`）的重前端重构**:设计文档明确含 IM 四区布局、移动端三屏下钻、§6 要求 mockup / 线框稿对齐——是典型重 UI/UX 蓝图。

派 roadmap-planner 前发现一处会改变执行路径的隐患:

- 本仓 `workflow.config.mjs` **有** `ui` 块（设计线总开关是"开"的），但其中 `uiPaths` 当时指向的是上一批 insight-wiki 的前端路径，**没有覆盖这次设计稿的 `web/src/views/agent/**`**。
- 后果链：
  1. roadmap-planner 逐工单比对 `files_estimated` 命中哪些 `ui.uiPaths`（`agents/roadmap-planner.md:57-61`）。`/agent` 路径不在 uiPaths 内 → **每条工单都判 `ui:false`** → 1.5/2.0 设计线逐单全部跳过。
  2. O15 的兜底（`ui_intent_detected`）触发条件是 config **无** `ui` 块（`agents/roadmap-planner.md:111`）。本仓有 ui 块 → **O15 兜底不成立、不触发 AskUserQuestion**。
- 两个机制各自都"正常工作"，叠在一起的净效果是:**一个明确要 mockup 的重 UI 重构，既没被 uiPaths 路由进设计线，又没被 O15 兜底拦截，会静默地没有设计线、没有 mockup 就直接进实现。** 这正是 skill 想防的"静默少交付"，却从 O15 的覆盖范围里漏了出去。

本次已就地止血:把本仓 `uiPaths` 改为 `web/src/views/agent/**`。但"靠人每批手动校准 uiPaths"不是框架级防呆——uiPaths 一旦陈旧/写错，失败模式是**静默**的，没有任何信号提醒"这批的设计目标根本不在 uiPaths 覆盖范围内"。

---

## 二、根因:O15 只覆盖了"没有 ui 块"，没覆盖"有 ui 块但 uiPaths 失配"

设计线其实是**两个正交决策**：

| 决策 | 由谁定 | 失配时的现有防护 |
|---|---|---|
| A. 这个项目配不配设计线（总开关） | config 有无 `ui` 块 | **O15**：无 ui 块 + 闻到前端意图 → AskUserQuestion |
| B. 这一条工单要不要走设计（逐单路由） | `ui.uiPaths` glob 比对 `files_estimated` | **无防护**：uiPaths 不命中即静默 `ui:false` |

O15 防的是决策 A 的失配（纯后端 config 混进前端单）。但决策 B 的失配——**ui 块在、uiPaths 却跟本批设计目标对不上**——是一个对称的盲区，目前完全没有信号。两种失配的用户可见后果完全一样:重前端工作静默没了设计线。

根因一句话:**uiPaths 失配是静默的。** roadmap-planner 闻到了前端意图（关键词/路径），却因为 uiPaths 没覆盖而判 false，且不发出任何"uiPaths 可能陈旧"的警告。

---

## 三、建议方案

把 O15 的"前端意图探测"从"只在无 ui 块时兜底"扩成对称的两路，**复用已有的前端意图探测逻辑**（关键词 view/页面/工作台/reader/pill/总览/dashboard 等 + 路径信号），按 config 状态分流：

1. **无 `ui` 块 + 检测到前端意图** → 维持 O15 原行为：标 `ui_intent_detected:true` → 主线 AskUserQuestion「加 ui 块 / 确认只做后端」。

2. **有 `ui` 块，但本批检测到前端意图的工单里没有任何一条命中 `ui.uiPaths`** → 新增信号 `ui_paths_stale_suspected:true`（顶层，附 evidence：哪些工单有前端意图、它们的 `files_estimated`、当前 `uiPaths` 值）→ 主线**必须 AskUserQuestion**：
   > 「检测到 N 条工单疑似前端（关键词/路径命中），但无一落在当前 `ui.uiPaths`（`<当前值>`）内——uiPaths 是否已陈旧、未覆盖本批设计目标？(a) 修正 uiPaths 后重跑 triage (b) 确认这些工单确实不需要设计线」

   判定要谨慎、可证伪，避免对真正的纯后端批次误报：触发条件是「**有前端意图信号** AND **该批 0 命中 uiPaths**」的合取，而非任一单项。

3. **固定播报扩一行**：Stage 1 backlog 落地汇报除现有 `UI 线:开/关 · E2E 线:开/关` 外，当 ui 块存在时追加 `UI 工单:N/M 命中 uiPaths`（M=有前端意图的工单数，N=其中命中 uiPaths 的）。让 0/M 这种危险比例在汇报里一眼可见，而不是埋在每条 0-triage.json 里。

---

## 四、落点

| 文件 | 改动 |
|---|---|
| `agents/roadmap-planner.md` | 前端意图探测段（现 :111）扩为对称两路：无 ui 块走 `ui_intent_detected`（旧），有 ui 块但全批 0 命中 uiPaths 走新增 `ui_paths_stale_suspected` + evidence |
| `SKILL.md`（Stage 1） | 主线见 `ui_paths_stale_suspected:true` 必 AskUserQuestion 的契约；固定播报补 `UI 工单:N/M 命中 uiPaths` |
| `references/receipts-schema.md` | backlog proposal 顶层字段补 `ui_paths_stale_suspected` + 其 evidence 结构 |
| `evals/evals.json` | 静态断言：roadmap-planner.md / SKILL.md 含 `ui_paths_stale_suspected`；播报行含 `命中 uiPaths` |

---

## 五、验证口径（可证伪）

- **静态契约**：`grep -c ui_paths_stale_suspected` 命中 `agents/roadmap-planner.md`、`SKILL.md`、`references/receipts-schema.md` 各 ≥1；eval 网新增断言全绿。
- **行为正例**（本次场景）：构造「ui 块在 + uiPaths=`web/src/views/foo/**` + 一批工单 files_estimated 全落 `web/src/views/agent/**`」的 triage 输入，roadmap-planner proposal 应带 `ui_paths_stale_suspected:true`，主线应进 AskUserQuestion 分支。
- **行为反例**（防误报）：纯后端批次（无前端关键词、files_estimated 全是 `src/**` / `*.go`）即使 uiPaths 0 命中，也**不**报 `ui_paths_stale_suspected`（因前端意图信号为空，合取不成立）。
- **诚实边界**：与 O15 同样，静态 eval 只能验"锚点在不在"，验不了"LLM 是否照做"。判定阈值（怎样算"有前端意图"、合取严格度）的误报/漏报率需在真实 b2r 编排运行中观测调参。

---

## 六、备注

- 本条不改设计线的**总开关哲学**（总开关交给人显式配，因为 `ui` 块绑着设计线运行所必需的输入:`designSkill` / `designRefs` / `anchorPath`，自动开线拿不到这些输入）。O27 只补**逐单路由失配的可见性**，让"uiPaths 陈旧"从静默失败变成一次显式提问。
- insight-subs 本仓的就地止血（uiPaths 已改为 `web/src/views/agent/**`）属项目侧修复，与本框架级工单正交；O27 落地后，类似批次无需再靠人记得手动校准 uiPaths。
