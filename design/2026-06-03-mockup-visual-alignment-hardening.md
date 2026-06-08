# blueprint2real · mockup 视觉对齐硬化设计

- 状态：需求提出，待用户/评审确认
- 范围：把"UI 设计稿 → mockup → E2E 截图比对实现与设计对齐"这条链从**能力已存在但自陈式无硬闸**收紧为**带证据、可核验**。消费 #1（`2026-06-02-ui-design-stage.md`）的 mockup 产物与 #2（`2026-06-02-e2e-acceptance-stage.md`）的 E2E 验收阶段，不新增顶层 stage、不改其触发模型。

## 1. 问题

#1（UI 设计阶段）与 #2（E2E 验收阶段）已实现并 wire 进 `SKILL.md`：`ui-designer` 产 mockup → 写进 spec §4 → implementor 当实现目标 → `e2e-verifier` 逐屏对照 → receipt 落 `mockup_refs`/`mockup_match`。链路完整。

但一次真实组级验收（insight-subs `EG-260602-234337`，Milkdown 编辑器）暴露两层缺口：

1. **触发缺口（项目侧）**：该仓 `workflow.config.mjs` 只配了 `e2e` 块、**无 `ui` 块** → Stage 1.5/2.0 整条 UI 线静默跳过 → 没产任何 mockup → E2E receipt `mockup_refs:[]`、`mockup_match:null`。一个明显的纯 UI 工单全程没有可对齐的视觉目标。

2. **比对严谨性缺口（引擎侧）**：即便开了 UI 线，当前"视觉对齐"是**自陈式**——
   - `e2e-verifier.md` L74 是**自律条款**（"没有 mockup 时写明不假装比过"），不是可机检硬闸；
   - `mockup_match` 是 verifier 单方填的 `true|null`，**无并排证据要求、无比对方法记录、无第二人复核**；
   - #1 §4.3 只说"逐屏比对锚点/mockup"，**比对方法（肉眼/像素 diff/VLM）未定义**；
   - mockup 产物形态委派 `designSkill`，可能是纯文字描述——**文字描述无法截图比对**。

后果：UI 对齐验收最容易在"verifier 说像就像"处注水，与 skill"让脚本/证据说话、不靠 LLM 自陈"的核心哲学不符。

## 2. 目标与非目标

### 目标
1. 让"截图比对实现 vs 设计"成为**带证据、可核验**的 gate，而非自陈布尔。
2. 不新增顶层 stage、不改 #1/#2 的触发与跳过模型；纯增量收紧。
3. 对纯后端/CLI 项目、未配 `ui` 块的项目**零影响**（保持静默跳过）。
4. 组级线（`unit:'group'`，不读 `acceptance.md`）与里程碑级线**对称**地拿到 mockup 基准。
5. 保持无人值守：比对硬化引入的失败仍走 retry-once → Manager Override，PASS 不打扰。

### 非目标
- 不内置任何具体设计系统/像素 diff 工具/VLM provider（委派 `designSkill` / `verifySkill` / `design-reviewer`）。
- 不强制所有 UI 工单做像素级比对——允许"行为比对"降级，但必须**诚实标注**未做视觉比对。
- 不解决 #1 已记的锚点漂移、#2 已记的 flaky 固化等既有风险。

## 3. 决策记录（待确认）

| 决策点 | 结论 | 理由 |
|---|---|---|
| mockup 形态 | 做视觉比对的屏，`mockups[]` 每屏必须含**可渲染产物 + 基准截图**（baseline PNG）；纯文字 mockup 只能行为比对 | 没有"左图"就无法截图对齐；不能假装比过 |
| `mockup_match` 语义 | 从自陈布尔升为**带证据可核项**：并排证据 + `mockup_match_method` + `mockup_diff_notes`；无并排证据则 `mockup_match` 不得为 `true` | 把对齐从口头变可审 |
| 谁判视觉对齐 | verifier **拍**（取实现实拍 + mockup 基准并排）+ `design-reviewer` 在 E2E 阶段**判**一次 | 单点自陈 → 双人（拍/判）分离 |
| 组级 mockup 基准来源 | spec-drafter 对 `ui=true` 工单**强制**把 `2.0-ui-design.json.mockups[]` 写进 spec §4；组级 verifier 旅程合成显式纳入 §4 mockups | 组级不读 acceptance.md，§4 是它唯一能拿到屏基准的地方 |
| designRefs 核验 | `design-reviewer` 对 mockup 引用的 token/组件做 `ref_grep_hits` 命中核验，命不中 `NEEDS_FIX` | 把"符合设计系统"从自律升为可机检（#1 §5.3 已留此机制，本设计要求 E2E 侧也消费其结论） |

## 4. 设计（B1–B4）

### B1 · mockup 必须是可截图的基准产物（2.0 阶段产出 baseline 截图）

- `ui-designer(mode:delta)` 产物：对**要做视觉比对**的屏，除 mockup 源文件外，必须落一张**基准截图** `work/<slugDir>/ui/<screen>.baseline.png`。
  - designSkill 产 HTML/可渲染 mockup → 渲染截图作 baseline；
  - designSkill 仅产文字/线框描述 → 该屏标 `visual_baseline:false`，E2E 只做行为比对、不得声称视觉对齐。
- `2.0-ui-design.json.mockups[]` 每屏增字段：
  ```json
  { "screen": "...", "path": "work/<slugDir>/ui/<screen>.html",
    "baseline_screenshot": "work/<slugDir>/ui/<screen>.baseline.png",
    "visual_baseline": true, "kind": "mockup" }
  ```
- 落点：`agents/ui-designer.md`（delta 模式产 baseline 指令）+ #1 的 `2.0-ui-design.json` schema 字段（prompt 层，非底盘）。

### B2 · `mockup_match` 升级为带证据的可核项 ← 核心

- E2E 阶段对每个 `visual_baseline:true` 的 UI 旅程，**强制产出并排证据**：mockup baseline 图 + 实现实拍图（同屏左右/上下拼图或两图路径成对），落 `evidence[]`。
- `e2e-<scope>.json` 的 `journeys[]` 每条增：
  ```json
  { "id": "J1", "mockup_refs": ["work/<slugDir>/ui/<screen>.baseline.png"],
    "impl_screenshot": "<reportsDir>/screenshots/J1-impl.png",
    "mockup_match": true,
    "mockup_match_method": "vlm | human | pixel-diff",
    "mockup_diff_notes": ["差异点1", "..."],
    "design_reviewer_verdict": "PASS | NEEDS_FIX | null" }
  ```
- **硬约束**：`mockup_match:true` 仅当 `impl_screenshot` 与 `mockup_refs` 均非空、且 `mockup_match_method` 已填时成立；否则视为未比对，`mockup_match` 置 `null` 并在报告写明原因。
- **第二人复核**：E2E 阶段对 UI 旅程调一次 `design-reviewer`，输入 = mockup baseline + 实现实拍，输出 verdict 进 `design_reviewer_verdict`。reviewer `NEEDS_FIX` 走与 2c-review 同构的 retry-once → Manager Override。
- 落点：`agents/e2e-verifier.md`（强制并排证据 + method 字段 + 调 design-reviewer）+ #2 的 receipt schema 字段（prompt 层）。

### B3 · 组级线 mockup 消费链打通

- `spec-drafter` 对 `0-triage.ui=true` 工单：spec §4 **必须**列出 `2.0-ui-design.json.mockups[]` 的每屏路径与 baseline；缺失即 spec 不完整。
- `validate-state` 增**存在性校验**：`ui=true` 工单的 spec §4 须引用其 `2.0-ui-design.json` 的 mockups（确定性可写——查 §4 是否含对应路径字符串）。仅在配 `ui` 块时生效。
- `e2e-verifier.md` 组级模式覆盖：旅程合成除读各成员 spec §验收标准外，**显式纳入 §4 的 mockups[] 作为屏基准**（现 L65 已读 2.0 receipt，本设计要求组级旅程基准段也明示这一来源，避免组级因"只读 §验收标准"漏掉屏基准）。
- 落点：`agents/spec-drafter.md`（prompt）+ `validate-state.mjs`（底盘，走 bootstrap）+ `agents/e2e-verifier.md` §组级模式覆盖（prompt）。

### B4 · designRefs 接项目 design-system，对齐可机检

- 项目 `ui.designRefs` 指向其设计系统事实源（如 insight-subs 的 `../docs/design-system/`）。
- `design-reviewer` 的 `ref_grep_hits`（#1 §5.3 已有）对 mockup 引用的 token/组件名在 designRefs 文件 grep 命中，命不中 `NEEDS_FIX`；命中证据落 `1.5-ui-anchor.json`/`2.0-ui-design.json` 的 `ref_grep_hits`。
- 落点：纯**项目配置**（`workflow.config.mjs` 的 `ui.designRefs`）+ `agents/design-reviewer.md` 已具备机制，无需引擎改动。
- ⚠️ **栈适配核实点**：`docs/design-system/` 现规范主要面向 front-end/pc（React + AntD5），insight-subs 是 Vue3 + AntD Vue。需确认该 design-system 的 token（食亨红 `#c81c2f`、金额色、关停色、禁渐变/emoji 等）对 Vue 站点同样适用；若不适用，为 insight-subs 单列一份栈对齐的 designRefs，否则 `ref_grep_hits` 会对 Vue 组件名持续命不中。

## 5. 不变量 #9 落点映射（底盘 vs prompt）

| 改动 | 类别 | 落点 |
|---|---|---|
| `ui-designer` delta 产 baseline 截图 | prompt | `agents/ui-designer.md` |
| `2.0-ui-design.json` 增 `baseline_screenshot`/`visual_baseline` | prompt（schema 叙述） | `agents/ui-designer.md` + SKILL.md §Stage 2.0 |
| E2E 强制并排证据 + method + 调 design-reviewer | prompt | `agents/e2e-verifier.md` |
| `e2e-<scope>.json` 增 `impl_screenshot`/`mockup_match_method`/`mockup_diff_notes`/`design_reviewer_verdict` | prompt（schema 叙述） | `agents/e2e-verifier.md` + SKILL.md §E2E receipt |
| `validate-state` 校验 §4 引用 mockups | **底盘（走 bootstrap）** | `bootstrap/workflow/scripts/validate-state.mjs` + 用户重 `init.mjs --bootstrap` 分发 |
| spec §4 强制列 mockups | prompt | `agents/spec-drafter.md` |
| designRefs / 栈适配 | **项目配置** | `<devRoot>/workflow.config.mjs`（与引擎正交） |

> 仅 `validate-state.mjs` 一处碰底盘（经 `${B2R_HOME:-<skillRoot>}` 解析、随 bootstrap 分发），其余均 prompt 或项目配置。无新增 npm script alias，不碰 `dev-package.json.tmpl`。

## 6. 验收口径

1. **跳过保持**：未配 `ui` 块的项目无 baseline、无并排证据要求、无报错（B1–B3 全静默）。
2. **baseline 强制**：`visual_baseline:true` 的屏在 `work/<slugDir>/ui/` 有 baseline 截图；纯文字 mockup 标 `false` 且 E2E 不声称视觉比对。
3. **比对可核**：UI 旅程 `mockup_match:true` 必附 `impl_screenshot` + `mockup_refs` + `mockup_match_method`；缺证据则 `null` + 报告写明。
4. **第二人复核**：UI 旅程 receipt 有 `design_reviewer_verdict`；`NEEDS_FIX` 走 retry-once → Override，不静默放行。
5. **组级打通**：`ui=true` 工单 spec §4 引用其 mockups，`validate-state` 在配 `ui` 块时对缺引用报错；组级 verifier 旅程基准含 §4 屏基准。
6. **designRefs 命中**：mockup 引用 token 在 designRefs grep 命中，`ref_grep_hits` 非空；命不中 `NEEDS_FIX`。
7. **不变量保持**：不新增顶层 stage、不破 exactly-one-active、receipt 主线单写、底盘改动经 bootstrap 分发；PASS 不打扰。

## 7. 本仓（insight-subs）落地清单（项目侧，独立于引擎改动）

给 `b2r-process/workflow.config.mjs` 增 `ui` 块即可让下个 UI 工单进入本链：

```js
ui: {
  designSkill: 'ui-ux-pro-max',
  designRefs: ['../docs/design-system/'],   // 先核实 Vue 栈适配（B4 ⚠️）
  uiPaths: ['web/src/views/**', 'packages/**/web/**'],
  anchorPath: 'state/ui-anchor.md',
}
```

引擎层 B1–B3 落地前，本仓即便开 `ui` 块也只能拿到"自陈式"对齐；B1–B3 合入后方为带证据比对。

## 8. 剩余风险

- VLM 判"实现 ≟ mockup"非确定性，可能宽判；靠 `pixel-diff` method 与 `design-reviewer` 复核兜底，但像素 diff 对动态内容（时间戳、随机数据）易误报，需 verifier 圈定比对区域。
- baseline 截图随设计迭代会过期；本设计不做 baseline 漂移检测，沿用 #1 "仅显式刷新锚点"策略，长期靠 retro 复盘。
- 纯文字 mockup 的工单视觉对齐天然缺失，只能行为比对——诚实标注而非假装，接受为已知弱保证。
