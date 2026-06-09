# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
