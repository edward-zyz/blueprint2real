# blueprint2real · UI 设计阶段（C 混合式）设计

- 状态：设计已与用户确认 + 经 sub-agent 评审修订，待二次评审
- 范围：仅 UI 设计能力。E2E 验证（#2）、多机并行编号（#3）为后续独立 spec，本文不实现，只在 §6 留接缝钩子。

## 1. 问题

blueprint2real 当前 6 阶段流水线（Triage → Backlog → Promote → Implement → Review → Handoff）从 roadmap 到 Done 工单全程没有任何 UI 设计环节。后果：

- 涉及界面的工单，implementor 没有可对齐的视觉目标，UI 临场发挥。
- 多个 UI 工单各自为政，跨工单视觉/信息架构漂移（insight-subs 的 `docs/design-system/` 明确把"风格漂移"列为反面样例）。

本设计为 skill 增加一个 **配置驱动、可被纯后端/CLI 项目完全跳过** 的 UI 设计能力，且不破坏 skill 现有的增量、脚本驱动、可无人值守的核心哲学。

## 2. 目标与非目标

### 目标
1. 在不新增顶层 stage 的前提下，把 UI 设计挂进现有 Stage 1 与 Stage 2。
2. UI 设计产物的"形态/技术栈"由项目配置的 `designSkill` 决定，skill 本身保持栈无关、开源通用。
3. 一致性与 just-in-time 准确性兼得：一次性轻量"设计锚点" + 每 UI 工单"继承锚点的 delta"。
4. **收口默认全自动（design-reviewer），仅异常 surface 给人**——锚点与 delta 同构，天然无人值守。
5. 给后续 #2 E2E 留干净的产物钩子（`mockups`）。

### 非目标
- 不实现 E2E 验证（#2）。
- 不解决多机并行编号（#3）。
- 不在 skill 内置任何具体设计系统/组件库知识（委派给 `designSkill` + `designRefs`）。
- 不自动重写已建立的锚点。

## 3. 决策记录（用户已确认；★ = 经评审修订）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 产物形态 | 委派项目配置的 `designSkill` + `designRefs` 出 mockup；未配 `designSkill` → 整条 UI 线静默跳过 | 保持开源通用，栈无关 |
| 放蓝图级还是工单级 | **C 混合式**：Stage 1.5 轻量锚点 + Stage 2.0 工单 delta | 纯蓝图级违反不变量 #5（基于想象设计）；纯工单级丢一致性。C 把一致性沉到锚点、准确性留给 delta，对齐 skill 已有"roadmap→工单"两层结构 |
| ★ 锚点收口 | **design-reviewer 自动判**；仅 `NEEDS_FIX` 或无 `designRefs` 时 surface 给人 | 评审指出：原"happy-path 人审"缺 attended/unattended 判定来源、且与"不做 config 旋钮"自相矛盾、破坏无人值守。统一成自动 + 异常 surface，与 delta 同构 |
| delta 收口 | **design-reviewer 自动判**；仅 `NEEDS_FIX` 或 `ui_novel:true` 时 surface 给人 | 锚点已确立，delta 在已批准语言内填内容；人审负担压到少数异常 |

### 为什么 C 不违反不变量 #5
不变量 #5 = "前置 Done 后才能 promote，禁止基于想象的接口做 spec"。
- **锚点**设计的是设计**语言/共享外壳/组件约定**，不是任何具体功能的内部，不依赖未建成的接口。
- **delta** 在工单本身要 promote 时（其依赖已 Done、邻接真实状态可读）才画，仍是 just-in-time，对的是真实状态而非想象。

## 4. 设计

### 4.1 pipeline 注入点

不新增顶层 stage，挂在现有 stage 上：

```
Stage 1 · Roadmap→Backlog
   └─ 1.5 · Design Anchor（新 · 蓝图级 · 每项目一次/按需刷新）
        位置：逻辑上紧随 backlog；实际**惰性触发**——首个 UI 工单将进入 Stage 2 时才跑（见 §6.1）
        触发条件：config 配了 ui.designSkill 且 该 UI 工单存在 且 锚点不存在
        执行：ui-designer(mode:anchor)
        产物：state/ui-anchor.md (+ ui-anchor-assets/)
        收口：design-reviewer 自动判 → PASS 即过；NEEDS_FIX/无 designRefs → surface
        receipt：1.5-ui-anchor.json
   ↓
Stage 2 · Promote（每条工单）
   └─ 2.0 · UI Delta Design（新 · 工单级 · 仅 0-triage.ui=true 的工单）
        位置：主线在派 spec-drafter 之前插入 ui-designer，**不改 promote.mjs**（promote.mjs 仍只做 Planned→Ready 翻档；2.0 是主线编排层动作）
        ui-designer(mode:delta) 拿【锚点 + 真实邻接状态】出本屏 mockup
        spec §4 随后引用 mockups
        收口：design-reviewer 自动判 → PASS 即过；NEEDS_FIX 或 ui_novel:true → surface
        receipt：2.0-ui-design.json
   ↓ spec-drafter / plan-drafter / spec-plan-reviewer 照旧
Stage 3 Implement → implementor 把 mockup 当实现目标
Stage 4 Review / Stage 5 Handoff 照旧
```

### 4.2 触发、跳过与挂载点（triage 收口）

- 新 config `ui.uiPaths`（glob 数组）。
- roadmap-planner 在 Stage 0 打标时，工单预计触碰 `uiPaths` → `0-triage.json.ui=true`；否则 `false`，完全不走 1.5/2.0。
- 项目未配 `ui.designSkill` → 1.5 与 2.0 全部静默跳过，纯后端/CLI 项目零感知。
- **挂载点（评审补）**：`ui` 标判定逻辑落 `agents/roadmap-planner.md` prompt + `0-triage.json` schema；锚点惰性触发判定（读 `0-triage.json.ui` + 探 `anchorPath` 存在性 + 决定先派 ui-designer）落 SKILL.md §6 编排图与"何时派 sub-agent"两节的主线编排叙述。
- **晚发现的 UI 工单（评审补，诚实处理）**：`ui` 标允许 implementor 在 Stage 3 由 false 升 true，但此时 1.5/2.0 已过、本轮无锚点/mockup 可补。**本轮不补设计**（不回流打断 happy-path）：implementor 照常实现，主线把"该工单 UI 设计缺失"登记进 `retro.md` 并 surface 给用户提示下轮处理。不假装"只升不降"在 ui 维度有补设计效果。

### 4.3 收口机制（锚点与 delta 同构）

| 层 | 默认收口 | surface 给人的条件 |
|---|---|---|
| 锚点（方向性、全局） | design-reviewer 自动判 | reviewer `NEEDS_FIX`，或项目无 `designRefs`（无清单可自动判） |
| 工单 delta（继承锚点） | design-reviewer 自动判 | reviewer `NEEDS_FIX`，或 `ui_novel:true`（无锚点可继承的全新形态屏） |

- surface 走既有 Manager Override 的人机交互（`AskUserQuestion` + 卷宗）——位于**异常路径**，与 skill 现状一致；happy-path **不**主动弹人，保住无人值守。
- 收口规则硬编码进 skill，无 config 旋钮（不再有 attended/unattended 二分，故无判定来源问题）。

## 5. 新增产物 / 配置 / 角色 / 落点

### 5.0 不变量 #9 落点映射（评审补：区分底盘改动 vs prompt 改动）

> 凡改 `bootstrap/workflow/scripts/*`（如 `config.mjs` 的 `ui` 块校验、receipt schema 的脚本支撑）= **skill 自身演进**：改 skill 源的 `bootstrap/workflow/` 资产 + 用户重跑 `init.mjs --bootstrap` 分发，**不是** b2r 运行期就地能加的（不变量 #9）。`agents/*.md` 与 SKILL.md 编排叙述不在 #9 底盘清单内，可正常改。
>
> **与 B2R_HOME（commit 458c03d）一致**：本设计**不新增 npm script alias**（`ui` 块校验在 `config.mjs` 内，1.5/2.0 是主线编排不需脚本入口），故无需碰 `dev-package.json.tmpl`。`config.mjs` 运行期经 `${B2R_HOME:-<skillRoot>}/bootstrap/workflow/scripts/` 解析——底盘在 B2R_HOME 而非项目内，坐实 #9。注意 `ui.designRefs`/`uiPaths`/`anchorPath` 都是 **DEV_ROOT（项目）侧**相对路径，与 B2R_HOME（引擎侧）正交。

| 改动 | 类别 | 落点 |
|---|---|---|
| `ui` 块字段校验 | 底盘（走 bootstrap） | `config.mjs`（校验逻辑）+ `validate-config.mjs`（壳）+ `workflow.config.mjs.tmpl`（注释块） |
| `0-triage.json` 加 `ui` 字段 | prompt | `agents/roadmap-planner.md` schema + 打标指令 |
| 锚点惰性触发编排 | 编排叙述 | `SKILL.md` §6 + "何时派 sub-agent" |
| 新增 ui-designer / design-reviewer | prompt | `agents/ui-designer.md`、`agents/design-reviewer.md` |
| 2.0 与 promote 的关系 | 编排 | 主线在 promote 前插入，**不改 `promote.mjs`** |

### 5.1 产物

| 产物 | 位置 | 内容 |
|---|---|---|
| 设计锚点 | `<devRoot>/state/ui-anchor.md`（+ `state/ui-anchor-assets/`） | 设计语言摘要（从 designRefs 提取）+ 共享外壳/导航 + 1-2 原型屏 + 组件约定。事实源级，地位类比 roadmap |
| 工单 mockup | `<devRoot>/work/<slugDir>/ui/`（可多屏，每屏一文件 + 可选截图） | 本工单各屏的 delta；被 spec §4 引用 |

### 5.2 config（新增 `ui` 块）

```js
// workflow.config.mjs
ui: {
  designSkill: 'frontend-design',           // 委派的设计 skill；缺失 → 1.5 与 2.0 全静默跳过
  designRefs: ['../docs/design-system/'],   // designer 必须遵守的设计系统文档（路径相对 devRoot）
  uiPaths: ['web/src/views/**'],            // 命中即 0-triage.ui=true
  anchorPath: 'state/ui-anchor.md',         // 锚点位置（相对 devRoot）
}
```

- `config.mjs` 增加 `ui` 块校验（壳为 `validate-config.mjs`）：若存在则 `designSkill` 非空字符串、`designRefs`/`uiPaths` 字符串数组、`anchorPath` 非空且不含路径越界。`ui` 块整体可缺省（缺省即关闭 UI 线）。

### 5.3 sub-agent 角色（`agents/*.md`，新增 2 个）

- **`ui-designer`**（带 `mode: anchor|delta`）
  - 通用职责：装填上下文 → 调 `designSkill` → 落产物 → 返回 receipt，自身不含技术栈知识。
  - `mode:anchor`：读 `designRefs` + backlog 的 UI 面；**存量项目**（designRefs 已有设计系统/现有 views）→ 提取/归纳现有系统为锚点，**不凭空造**；**绿地项目** → 按 designRefs/brand 现设计。产出 `state/ui-anchor.md`。
  - `mode:delta`：读锚点 + 工单 spec 草稿/context-pack + 真实邻接状态 → 出本屏 mockup（可多屏）到 `work/<slugDir>/ui/`。
- **`design-reviewer`**（审锚点 + 审 delta）
  - 拿 `designRefs` / constraint-pack 清单批 mockup，verdict `PASS | NEEDS_FIX`，附 checklist 命中项。
  - **可机检最低断言（评审补，把"不凭空造"从自律升为可核项）**：mockup/锚点引用的 token / 组件名必须能在 `designRefs` 指向的文件里 grep 命中（类比 spec-drafter §4 的 ls/grep 确认）；命不中即 `NEEDS_FIX`。命中证据落 receipt。

### 5.4 receipt（遵循现有 envelope + 单写者 #8，由主线落盘）

`1.5-ui-anchor.json`：
```json
{
  "stage_id": "1.5-ui-anchor",
  "anchor_path": "state/ui-anchor.md",
  "archetype_screens": ["..."],
  "extracted_from": "existing | greenfield",
  "ref_grep_hits": ["designRefs 中命中的 token/组件证据"],
  "reviewer_verdict": "PASS | NEEDS_FIX",
  "escalated_to_human": false
}
```

`2.0-ui-design.json`：
```json
{
  "stage_id": "2.0-ui-design",
  "mockups": [{ "screen": "...", "path": "work/<slugDir>/ui/<screen>.<ext>", "kind": "mockup|screenshot" }],
  "inherits_anchor": true,
  "ui_novel": false,
  "ref_grep_hits": ["..."],
  "reviewer_verdict": "PASS | NEEDS_FIX",
  "escalated_to_human": false
}
```

- `mockups` 为**数组**（评审补：一个工单可多屏；#2 E2E 逐屏断言需要逐屏路径 + `kind` 区分 mockup/截图）。
- 二者与现有 receipt 一样带通用 envelope（`level`/`attempt`/`completed_at`/`manager_override`）。失败处理复用现有"交付失败兜底 → retry-once → Manager Override"链。

## 6. 锚点生命周期 & 下游接缝

### 6.1 锚点生命周期
- **惰性建立**：首个 UI 工单将 promote 且 `anchorPath` 不存在时才触发 1.5（没有 UI 工作就不建锚点）。
- **冷启动分叉**：见 5.3（存量提取 / 绿地现设计）。
- **刷新**：仅显式用户请求，或 delta review 标记"锚点漂移"时**提示**用户——不自动重写锚点。

### 6.2 给 #2 E2E 的接缝（本 spec 只留钩子，不实现）
- spec §4 引用 `mockups` → implementor 把它当实现目标。
- `2.0-ui-design.json.mockups[].path` 将来由 #2 的 E2E gate 逐屏消费（断言"建出来的屏 ≟ mockup / 行为符合"）。本 spec 保证该数组结构存在且稳定。

## 7. 验收口径

1. **跳过路径**：未配 `ui.designSkill` 的项目跑完整 pipeline，无任何 UI 步骤、无新产物、无报错。
2. **triage 收口**：非 UI 工单 `0-triage.ui=false` 且不触发 2.0；触碰 uiPaths 的工单 `ui=true`。
3. **锚点惰性建立**：首个 UI 工单 promote 前锚点不存在 → 触发 1.5 并产出 `state/ui-anchor.md` + `1.5-ui-anchor.json`；锚点已存在 → 不重复建。
4. **存量提取 + 可核验**：designRefs 指向已有设计系统时 `extracted_from=existing`；锚点/mockup 引用的 token 在 designRefs grep 命中（`ref_grep_hits` 非空），命不中则 `NEEDS_FIX`。
5. **收口同构**：锚点与 delta reviewer PASS 均不打扰用户（`escalated_to_human=false`）；锚点 `NEEDS_FIX`/无 designRefs、delta `NEEDS_FIX`/`ui_novel=true` 才 surface。
6. **晚发现 UI 工单**：Stage 3 升 `ui=true` 时本轮不补设计，登记 retro + surface 提示，pipeline 不中断。
7. **config 校验**：对非法 `ui` 块报字段级错误；缺省 `ui` 块退出码 0。
8. **不变量保持**：1.5/2.0 不引入对 BOARD.html 的手写、receipt 仍主线单写、commit 物理分离不受影响；底盘改动经 bootstrap 分发（§5.0）。

## 8. 剩余风险（允许带入后续）

- 锚点"漂移检测"判据本 spec 仅做提示、不自动重写，长期可能锚点与实际渐行渐远——后续可在 retro 机制里纳入"锚点复盘"。
- 晚发现的 UI 工单本轮无设计目标（§4.2），靠 retro + 下轮补；不涉安全/权限/审计/数据。
- `designSkill` 产物形态由项目决定，design-reviewer 自动判质量依赖 `designRefs` 完整度；designRefs 稀薄 → 自动判偏宽，故 §4.3 把"无 designRefs"作为 surface 给人的触发条件之一兜底。
