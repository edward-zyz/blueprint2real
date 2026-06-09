# 调研分析报告 · blueprint2real 的 UI 还原度断点与根治方案

- 受众：blueprint2real skill 维护者
- 触发案例：`insight-subs` 工单 **IS-260609-005309-p3**「Survey web 后台 UI 对齐 wiki（列表 + 详情三 Tab）」
- b2r 版本：5.4.0
- 结论一句话：**b2r 的 UI 线在「出图」之后，把高保真 mockup 走了一遍 `图 → 散文 spec → DOM 测试 → 代码` 的有损压缩；实现 agent 优化的目标函数是「散文 + happy-dom 测试」，不是「那张图」。凡未被转录进 spec 文字或测试断言的视觉信息，都会被静默丢弃，而所有质检闸照样全绿。**

---

## 1. 现象：mockup 高保真，代码低保真

这一轮的设计阶段（`2.0-ui-design`）交付质量很高：`work/<slug>/ui/` 下 4 张 mockup + `_chrome.css`，token / 组件 / IA 自洽，`reviewer_verdict: PASS`。**问题不在设计阶段。**

断点在 `2.0-ui-design → 3-impl`。实现相对 mockup 系统性丢失（以最重要的首屏「问卷列表」为例）：

| mockup 明确画了 | 代码实现 | 证据 |
|---|---|---|
| 工具条：搜索框 `.sv-search` + 卡片/表格视图切换 `.sv-segmented` | **整条砍掉** | `ui/survey-list.html:92-99` vs `InsightSurveyShell.vue:30-73` |
| 表格视图 `.sv-table-view`（`.table-wrap` 横滚） | **整块砍掉** | `ui/survey-list.html:154-167` 无对应实现 |
| 「登录填写 / 匿名公开」前的锁 / 人形 SVG 图标 | 纯文字 `{{ accessLabel }}` | `ui/survey-list.html:110,127` vs `InsightSurveyShell.vue:63` |
| 「AI 生成」/「新建问卷」按钮 SVG 图标 | 纯文字 + 一个字面 `+` | `ui/survey-list.html:82,86` vs `InsightSurveyShell.vue:37-38` |

> 注：设计 Tab（`SurveyEditor.vue`）实现**反而高保真**——品牌红序号圆点、`.sve-iconbtn`、虚线「+添加题目」、AI 软底卡全对上了。这证明实现 agent **有能力**做高保真，缺的不是能力，是「它不知道该还原哪些」。问题是机制，不是模型。

---

## 2. 根因：有损压缩，每一跳都丢未被转录的像素信息

b2r 的固定执行链（RUNBOOK §3）：

```
promote → spec → spec review → implementation plan
→ failing test (TDD) → minimal implementation
→ targeted verification → regression verification
→ architecture & security review → commit → handoff
```

UI 线只在**最前面**插了一个 `2.0-ui-design`（出 mockup + anchor），**后半段全部沿用通用 TDD 链**。于是 mockup 被生产出来后，再没有任何一个下游闸把它当作验收真值。具体四个失效点：

### 2.1 spec 把 mockup「散文化」时丢信息
`2a-spec` 把 mockup 压成 §5 输入输出契约（散文）。spec §5.1 只写了「列：标题/状态/登录档位/回收数 + 入口：新建/AI生成 + 空态」，**没提搜索框、没提卡片/表格切换**。mockup 虽被 §4 引为「实现必须对齐」，但真正可执行的契约是 §5 散文。**实现 agent 实现的是散文，不是图。散文漏写 = 实现漏做。**

### 2.2 TDD 验收测试几乎不锁视觉丰富度
`failing test` 这一闸是 `InsightSurveyShell.test.ts`，跑在 **happy-dom（不渲染像素）**。它断言：行数=3、`.level.high/mid/low`、`.pill.info`、`.kb-empty`、三个 tab 文案。它**不断言**：搜索框存在、视图切换存在、tier 有图标、按钮有图标。在「TDD + scope 纪律」双重压力下，TDD agent 天然把「测试不管、§5 没写」的东西当可选项删掉。**绿灯只覆盖被转录的那一小撮，不代表「像」。**

### 2.3 铁证：spec 白纸黑字写了「带图标」，实现却是纯文字，照样全绿
spec §5.1 原文：登录档位「… **带图标**」。mockup 也画了图标。实现 `InsightSurveyShell.vue:63` 是纯文字 `accessLabel`。**连 spec 明确要求的图标都丢了**——因为 §7 没有一条 `expect(icon).toExist()`。这是 mockup→code 丢失最干净的样本：**图有、spec 也有、测试没有 → 实现没有 → 管线全绿放行。**

### 2.4 实现/审查阶段从不「截自己的图与 mockup 并排比」
`targeted verification` / `architecture review` 全程没有 render-and-diff 闸。哪怕实现明显比 mockup 简陋，只要 happy-dom 那几条 class 断言过就 handoff。mockup 作为「参照」挂在 §4，但**没有任何环节强制「产出 == 参照」**。
> 旁证：连设计阶段自己都标了 `escalated_to_human: true`（管线知道视觉得人看），但人工视觉关被「五条全 Done」的流水线惯性盖过去了。

### 2.5（次要）config 的 designRefs 偏二手
`workflow.config.mjs` 的 `ui.designRefs` 指向**静态发布 HTML + 设计 MD**，而非真实运行组件 `InsightWikiShell.vue`。本案 mockup 质量仍高，所以这条不是本次主因；但它埋了「参照系是文字转述、非渲染真值」的隐患，建议一并修。

---

## 3. 机制总结（一张因果图）

```
高保真 mockup
   │  2a-spec 散文化            ← 丢「搜索框 / 视图切换 / 图标」（§2.1）
   ▼
散文 spec §5
   │  failing-test 转 DOM 断言   ← 只锁 class/文案，不锁元件存在性（§2.2）
   ▼
happy-dom 测试（不渲染像素）
   │  TDD minimal implementation ← 实现对着「散文+测试」编，不对着图编（§2.3）
   ▼
低保真代码
   │  verify / review            ← 无 render-diff，无人工视觉回执（§2.4）
   ▼
全绿 handoff（看起来 Done，屏幕上不像）
```

核心命题：**b2r 把 UI 还原度问题，错误地建模成了一个「文本可断言 + 自动可复跑」问题。但 UI 还原度的真值是一张与 mockup 并排的截图。当真值无法进入闭环，每一道闸测的都不是「像不像」，绿灯叠绿灯叠出一个文字自洽、视觉失真的产物。**

---

## 4. 根治方案（按性价比排序，均可落到现有结构）

### P0 — 引入 render-diff 闸：让 mockup 成为可验收真值
在 `targeted verification` 之后、`handoff` 之前，对带 UI 产物的工单**强制**插入一道 `ui-fidelity` 闸：
1. 用 `verify` skill 能力（已在 `e2e.verifySkill` 配置）启动 6173/6001，导航到实现页；
2. browser-harness 截图（深 + 浅双态）；
3. 与对应 mockup **并排**喂给一个 `design-reviewer` sub-agent（或人工），逐元件比对；
4. 差异项必须 **close 或显式记入 backlog**，否则该工单不得翻 Done。

> 这是唯一能堵住「§2.1 散文漏写就丢」的闸——因为它绕开了文字，直接拿图比图。

### P0 — UI 工单的 spec §5 必须「清单化 mockup」，禁止散文化
给 UI 线一个 spec 模板约束：把 mockup 里**每个可见元件**（搜索框、视图切换、每个图标、每个 stat、每个空态）列成 checklist，逐条标 `本轮做 / 顺延 / 不做`。**砍可以，但必须显式砍**，不能在写散文时手滑漏掉。spec-review 闸增加一条：「§5 元件清单是否覆盖了 mockup 的全部可见元件？」

### P1 — UI 验收测试加「元件存在性」断言
既然 spec 会清单化，`failing test` 就能逐条转成断言：`expect(tier.find('svg').exists()).toBe(true)`、`expect(w.find('.sv-search').exists())`…。把 mockup 关键元件转成可断言项，**丢一个红一个**。happy-dom 测不了像素，但测得了「元件在不在」。

### P1 — Done 判定里「截图对齐 mockup」与「测试绿」同权
改 RUNBOOK / verify-handoff 闸：UI 工单的验收口径中，render-diff 通过与测试绿是**并列必要条件**，不能只靠后者翻 Accepted。`escalated_to_human` 视觉关一旦点亮，**必须有人工并排比对回执**，不得被组级「全 Done」自动覆盖。

### P2 — config.designRefs 优先指向「可渲染的真实组件」
`ui.designRefs` 增加一条约定：设计阶段必须至少消费一个**能在浏览器里渲染的真实参照页**（运行组件 / 真实路由），并把它的截图入上下文；纯静态 HTML / MD 只能作为补充。`2.0-ui-design` 回执若 `design_ref_source` 含 `existing` 却无 live 截图证据，判 BLOCKED。

---

## 5. 对修复本身的验收标准（给 b2r 维护者）

这套优化「根治」的判据：

1. 拿 IS-260609-005309-p3 做回归——若按新管线重跑，§2.1 的搜索框/视图切换、§2.3 的图标，**必须在某道闸被红出来**（spec 清单缺项 / 元件断言失败 / render-diff 差异），而不是一路绿到 handoff。
2. 新增的 `ui-fidelity` 闸对**非 UI 工单零成本**（无 UI 产物时自动跳过，不拖慢主链）。
3. spec 清单化是**强约束但低负担**——元件 checklist 可由设计阶段从 mockup 自动抽取草稿，spec drafter 只做「做/顺延/不做」三态标注，不手抄。

---

## 6. 一句话给维护者

b2r 在「逻辑正确性」上的质检骨架（validate-state / failing-test / regression / verify-handoff）非常强，这套机制对**可文本断言**的东西是金标准。UI 还原度的失败不是这套机制不好，而是**它被套用到了一个真值无法文本化的问题上**。根治的方向只有一个：**把 mockup 这张图，作为一等公民的验收真值，重新拉回闭环的末端**——通过 render-diff 闸 + 元件清单化 spec + 元件存在性断言，让「不像」能在某道闸变红。否则无论模型多强，有损压缩的结构性丢失都会持续发生。

---

### 附：本报告引用的事实源（可复核）
- 设计回执：`b2r-process/work/IS-260609-005309-p3_.../receipts/2.0-ui-design.json`（`escalated_to_human: true`）
- 4 张 mockup + chrome：`b2r-process/work/IS-260609-005309-p3_.../ui/{survey-list,survey-detail-*}.html`、`_chrome.css`
- spec §5.1「带图标」：`b2r-process/specs/IS-260609-005309-p3_....md`
- 低保真实现：`packages/_sdk/survey/web/InsightSurveyShell.vue:30-73,63`
- 验收测试（DOM-only）：`packages/_sdk/survey/web/InsightSurveyShell.test.ts`
- 执行链 / UI 配置：`b2r-process/AGENT_RUNBOOK.md §3`、`b2r-process/workflow.config.mjs (ui 块)`
