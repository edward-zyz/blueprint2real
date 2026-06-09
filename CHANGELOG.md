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
- **O28 · 同包线性链合并候选探测**——治「内聚特性被拆成多张严格线性工单 → 固定开销（逐 stage dispatch ＋ 末切片全量 regression ＋ 独立 handoff commit ＋ BOARD render）×N」的无用功，把「该 1 工单多 sub-slice 还是 N 工单」这个原本无人负责的决策前移到 planner 机械检测 ＋ 人确认（纯 orchestration-prompt 改动，不动 bootstrap 脚本，故 `bootstrap/workflow/VERSION` 不变）：
  - `roadmap-planner`：对本批切片跑机械检测，命中**全部**硬条件（`files_estimated` 同包前缀∩非空 ＋ 依赖严格单链无分叉 ＋ 每条 ≤L2 ＋ 同里程碑 ＋ 同 ui 标）的连续切片写入顶层 `coalesce_candidates[]`（可证伪、非模糊判断）；结构同构于既有 O27 `ui_paths_stale` → AskUserQuestion。
  - `SKILL.md`：主线见 `coalesce_candidates[]` 非空**必须 `AskUserQuestion`** 让人拍板，**不自动合并**；采纳合并的组只 mint 1 个 workId、其余作 sub-slice，§Planned 摘要加「含原 N 切片」一行追溯（不进 receipt schema）。新增多 slice 工单 level 护栏（`level=max(slice)`、文件数按 slice 分摊不整工单累加、末切片仍全量 regression），并固化收敛 regression 的 flake 放行纪律（受影响套件绿 ＋ `validate:state` ＋ `render:board` 为真 gate；预存 flake 不阻断、本轮引入的红照常阻断）。
  - `spec-drafter`：spec §4 补 `### Sub-slice 列表` 落盘段（复用 RUNBOOK §11，零新 receipt 字段；单切片工单不写）。
  - 不自动合并、不新增 receipt 字段、不新增 gate。
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
