# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.7.0] - 2026-08-21

依据：2026-08-21 对一条 L3、6 切片工单的实际运行观测——全部 gate attempt=1 一次通过、实现后独立架构安全审查零发现且回执大半复制上一环节、handoff 派 sub-agent 导致 verify 被推迟并留下脏尾、6 个切片里 5 个的"红色证据"只是 `ERR_MODULE_NOT_FOUND`、一个"只差提交两个文件"的微切片照样开了整轮 implementor 会话。重心从"事后把关"移到"事前想清楚"（实现前的 spec/plan 评审保留不动，它抓出 6 个真问题、是零返工的来源）。

### Changed

- **TDD 红门改按切片分型（不变量 3）**：`behavior-change`（改既有行为）切片仍强制 failing test 先跑红，且必须是**断言级**红；`new-module`（从零新建模块/文件）切片允许测试与最小实现同批落地，但 targeted 断言必须覆盖 spec §7 对应条目并跑绿。`ERR_MODULE_NOT_FOUND` / `Cannot find module` 式的红不再算红门证据。`3-impl` receipt 新增 `red_gate_mode` 字段。v5.6 的"失败结构 grep 关键字"作为断言级红的机械核法保留。
- **Stage 4 独立架构安全审查改条件触发**：L3 默认由主线内联完成（亲跑 `lint:redlines` + 核 scope 一致性 / spec §11 对齐 / diff 面）；仅在 (a) 红线 lint 命中、(b) diff 触碰安全敏感面（认证 / 授权 / 加密 / 密钥 / 权限 / schema migration / 计费）、(c) 内联核查发现疑点 时才派 `arch-security-reviewer`。`4-arch.json` 仍由主线确定性拼装，新增 `independent_review_dispatched` + `dispatch_reason`。L2 轻量内嵌 / L1 跳过不变。
- **Stage 5 handoff 改主线亲做**：白名单 `git add` → 断言 impl/handoff commit 物理分离 → 亲跑 `verify:handoff` → 翻档 → 主线落盘 `5-handoff.json`。`handoff-committer` 降级为可选模板（仅主线上下文吃紧或并行多单收尾时派）。理由：机械活派工反而引入交接损耗。
- **UI 设计回执只留一份**：`ui-designer` 最终只落 `2.0-ui-design.json`（anchor 模式为 `1.5-ui-anchor.json`），定稿后必须删除 `.draft.json` 等中间副本。
- **SKILL.md 减重**：E2E 机制（蓝图级 / 批次级验收线、两段式执行、里程碑 FAIL 闭环、对应质检行）原文迁至新增的 `references/e2e-acceptance.md`，SKILL.md 只留触发条件与指针；删除历代补丁的论证性散文与版本号括注（历史归本 CHANGELOG）；合并候选 / UI 线播报 / mockup→code 防线 / flake 放行纪律压缩为纯操作规则。操作规则一条未删，v5.6 的自主边界 / triage 决策树 / 批次完整性闸全部保留。
- **触发描述补自然语言场景**：跨模块 / 新 schema / 新依赖 / 安全敏感（计费、身份核验、写动作）的 L3 大改动要先立工单走流水线时，即使用户只说「这个大活先立个工单」「这个改动涉及安全，按流程走」也必须触发本 skill。与 v5.6 的批次收官 / 续跑 / bootstrap / 换机修底盘触发词取并集。

### Added

- **微切片内联通道**：`plan-drafter` 可为切片标 `inline_ok: true`（判据：改动 ≤2 文件 且 无新增行为断言需求），主线对这类切片可内联完成、不派 implementor，`3-impl.json` 记 `inline: true`。仍受不变量 3 / 4 约束；拿不准就不标，整轮 implementor 是默认。
- 新增 `references/e2e-acceptance.md`（可选 E2E 验收线的完整机制；批次账本建组与 D3 收口硬卡的无条件语义一并收在此）。

## [5.6.0] - 2026-07-05

### Added

- **P0 三项落地（workflow bootstrap v5.6，回应 2026-06-29 诊断报告）**：
  - **B2R_HOME 去硬编码（报告 3.4）**：生成的项目 `package.json` alias 不再烘焙 bootstrap 机器的 skill 绝对路径，改为运行时 `B2R_HOME` 环境变量 → `<devRoot>/.b2r-home` 项目本地配置两级解析；`init.mjs --bootstrap/--upgrade` 均写 `.b2r-home`，upgrade 自动迁移旧式烘焙 alias。换机克隆后跑一次 `init.mjs --upgrade` 即全量修复。
  - **Triage 判据决策树化（报告 3.8）**：`roadmap-planner` 的 L0-L3 判定从"满足任一"平行表格改为有序短路决策树；`reasons[]` 必须引用分支号；主线新增机械一致性校验（L1 ⇒ 恰 1 文件，L0/L2 ⇒ ≤3 文件），矛盾即打回——堵"单文件却涉及3文件"式自相矛盾误判。
  - **批次完整性闸（报告 3.6，给编排者自己的 gate）**：Stage 1 mint 后无条件把本批工单写入 `state/e2e-groups.md` 批次账本（原来仅 `e2e.unit∈{group,both}` 时建组）；每次 handoff 后主线必跑 `npm run batch:status`（新 alias，同 `e2e-group:status` 脚本）机械读取 `done/total` 与 `open_members`，`open_members` 非空禁止宣称批次收官；`validate-state` D3 簿记校验与"全 Done 仍 Open"收口硬卡无条件生效（e2e 未启用时收口 = 翻 `Skipped`，Receipt 写 `skip:e2e-disabled`）。
  - 测试：`init.test.mjs` / `e2e-group-status.test.mjs` / `validate-state.test.mjs` 新增/更新用例，且 `init.test.mjs`、`e2e-group-status.test.mjs`、`regression-diff.test.mjs` 补挂进 `npm test`（此前遗漏）。
- **迭代 2（v5.6 收尾）**：
  - `init --bootstrap` 补写 `.b2r-version`（此前仅 upgrade 写，新项目落地即触发契约自检被迫补跑 upgrade——评测代理实测发现）。
  - 生成产物去 legacy `cd dev` 硬编码：模板改用 `{{devRootName}}` 按实际 target 目录名派生，`defaults.regressionCommands` 同步更新为 `b2r-process`。
  - P1 文档三项：SKILL.md 新增「自主边界」一节（核心循环无人值守 + 必停问人清单 + 可选枝环境门槛分层）；红 gate 证据从「非空」收紧为「必须含失败结构」（非 0 退出码 / FAIL/Error/AssertionError 关键行）；消除 downgrade 回流点 Gate4/Gate6 编号冲突（统一 Gate 6=level branch），并声明 quality-gates.md 为 Gate 规则唯一权威、pipeline-flow.md 降级为图示。
  - description 触发短语扩充：补入 v5.6 新场景——批次收官判断、续跑中断批次、bootstrap 新项目、换机后底盘修复（Cannot find module）。

## [5.5.0] - 2026-06-09

### Added

- **UI 还原度三道防线（workflow bootstrap v5.5）**——根治「高保真 mockup 经 `图 → spec 散文 → happy-dom 测试 → 代码` 有损压缩后，未被转录的视觉信息静默丢失却全绿放行」：
  - 入口·清单化：`ui-designer` 抽 `2.0-ui-design.json.mockup_elements[]` 逐元件清单；`spec-drafter` 在 spec §4 逐元件标 `本轮做/顺延/不做`（只标注不手抄）、§7 为 `本轮做` 写元件存在性断言；`spec-plan-reviewer` 逐 key 对账覆盖。
  - 中段·元件断言：`implementor` 的 TDD 失败测试必须含元件存在性断言，丢一个元件红一个。
  - 末端·render-diff 硬闸（Stage 3.5）：`design-reviewer(mode=fidelity)` 把实现页截图 ↔ mockup 并排逐元件比对，产 `3.5-ui-fidelity.json`；`verify-handoff.mjs` Check 8 要求有 mockup 的工单必须 render-diff `PASS`（或显式 `deferred_to_backlog`/`env-blocked`），与测试绿并列必要——非 UI 工单零成本自动跳过。
- `workflow.config` 注释：`ui.designRefs` 建议优先指向「能在浏览器渲染的真实组件/路由」而非二手静态 HTML/MD。

## [0.1.0] - 2026-05-30

### Added

- Initial open-source release of the `blueprint2real` skill.
- Multi-agent workflow prompts for roadmap planning, spec drafting, planning,
  implementation, review, direct fixes, and handoff.
- Bootstrap workflow scripts, state validation, board rendering, dependency
  graph rendering, promotion, redline linting, and handoff verification.
- Bilingual README, license, contribution, security, conduct, issue, PR, CI, and
  Dependabot files.
