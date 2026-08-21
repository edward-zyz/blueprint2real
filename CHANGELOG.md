# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
