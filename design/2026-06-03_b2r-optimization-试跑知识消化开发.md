# blueprint2real · 优化需求清单

> 来源：对 EG-260603-164500（知识消化整合，5 工单 T1–T5）UI 设计线 + E2E 验收线的执行细节 review，
> 叠加 `state/retro.md` 历史复盘债。生成日期：2026-06-03。
> 优先级口径：P0=反复复发/掩盖真实信号，应尽快清；P1=结构性缺口；P2=体验/收敛优化。

---

## P0 · 反复复发 / 掩盖真实信号

### O1. arch-security-reviewer 吞 receipt（跨月复发，回灌债）

- **现状**：派 `arch-security-reviewer`（重 `security-review` skill）后，sub-agent 反复以「无 findings」安全审散文收尾，**不把 4-arch receipt JSON 作为最后一条消息**。本批 T1/T3/T5 又中招 3 次（T3/T5 fresh 重派仍失败 → 主线内联接手）。
- **根因**：`security-review` skill 接管后挤掉外层 receipt 契约；经验只进了 `retro.md`/MEMORY，**从未回灌进 `agents/arch-security-reviewer.md`**，故从 2026-05-16 IS-002 一路复发至今。
- **建议**：
  1. 模板顶部加粗硬前置「末条必须是 4-arch receipt JSON；security-review 输出只是 markdown 段，不可替代 receipt」；
  2. 或对 L3 arch 默认走「security-review 取证 + 主线内联出 receipt」既定路径，降低吞没率；
  3. 建立闭环纪律：retro「经验」项凡指向某 agent 模板，必须同步开一个模板修订动作。
- **落点**：`.claude/skills/blueprint2real/agents/arch-security-reviewer.md`
- **影响**：每条 L3 工单 Stage4 额外 1–2 次重派/接手，token + 时延浪费。

### O2. 全量 `npm test` 预存 flake 家族掩盖回归信号

- **现状**：全量 `npm test` 长期带预存失败，集中在：① ai-chat `token-queries.integration` 日期边界（`new Date()` 跨天窗口）；② supertest 端口竞争（`spaceLifecycle` "Parse Error: Expected HTTP/"）；③ 跨套件并行污染（qualityConsole / workOrderLabel / dataDiscovery）。
- **问题**：每条工单收敛 regression 都要人肉 `git diff <base> HEAD -- <失败包>` 排除，真实回归信号被噪声淹没。
- **建议**：
  1. supertest 套件统一 `listen(0)` 随机端口 + `afterAll(close)`；
  2. 日期边界测试注入可控时钟（不用裸 `new Date()`）；
  3. 隔离会改全局状态的套件（独立 jest project / `--runInBand` 分片）。
- **落点**：`packages/_sdk/ai-chat/scripts/__tests__/`、各 supertest 套件、jest 配置。
- **影响**：收敛门信噪比，误判风险。

---

## P1 · 结构性缺口

### O3. E2E「固化回归」名实不副（重前端蓝图恒部分 skip）

- **现状**：固化的 `test/e2e/insight-wiki-digest-journeys.spec.ts` 在缺 secrets+浏览器的环境恒为 **2 passed + 3 skipped（J1）**，整套 `npm run test:e2e` exit 1。`e2e_regression_green=false`。真正耐久绿的是组件 vitest/jest（402+63+24），不是 playwright。
- **问题**：b2r 固化初衷是留可重复绿回归，但 playwright spec 达不到；流程未明确「重前端蓝图固化主力 = 组件测试，playwright 仅 CI 补充」，易高估覆盖。
- **建议**：
  1. SKILL/e2e-verifier 模板明确：组级固化主力按蓝图性质分流（重前端→组件测试为主），playwright 标注「CI-only」；
  2. `e2e_regression_green` 增加 `reason_category`（环境性 vs 质量性）字段，已部分体现，固化为枚举。
- **落点**：`.claude/skills/blueprint2real/agents/e2e-verifier.md`、`e2e/*.json` schema。

### O4. CI 未预置 E2E 真绿前置

- **现状**：本地缺 ① `playwright install chromium`（`~/Library/Caches/ms-playwright` 空）② dev-login 种子（Infisical 未注入 dev 验证码，`/auth/send-code` 401 / `/auth/login` 400 `AUTH_CODE_EXPIRED`）③ Node 版本错配（当前 v24，vitest/E2E 须 Node20）。
- **建议**：CI 流水线预置 `playwright install chromium` + dev-login 种子（或 Infisical dev 注入）+ 锁 Node20；本地参照 MEMORY `insight-subs-e2e-env-constraints` runbook。
- **落点**：CI 配置 + `b2r-process/AGENT_RUNBOOK.md` E2E 前置段。
- **影响**：让 `e2e_regression_green` 有机会真转绿，区分环境失败与质量失败不再依赖 Manager 人判。

### O5. 组级 evidence 目录名实不符

- **现状**：`e2e/evidence/` 6 个文件全是上一组 EG-260602-200000（IS-102）残留；本批 EG-260603-164500 **无任何 evidence 落 evidence/**（无浏览器→无截图/网络取证，证据只散在 acceptance.md 命令输出）。
- **问题**：目录名易被误读成「本组有取证」，实则薄。
- **建议**：e2e-verifier 强制每组至少落一份结构化 evidence 到 `evidence/<group>/`（即使是命令输出 JSON），与 group id 对齐。
- **落点**：`.claude/skills/blueprint2real/agents/e2e-verifier.md`、`e2e/evidence/<group>/` 目录约定。

### O6. skill bundle（bootstrap/）不入版本控制 → 版本漂移

- **现状**：`.claude/skills/blueprint2real/bootstrap/` 在 `.gitignore` 内。slugify 修复等改动改了不入 git，团队成员各自 bundle 版本漂移。
- **建议**：把 `.claude/skills` 移出 .gitignore，或单独 skill repo 用 submodule，或发 npm 包；短期每次改 bundle 必在 retro 记录 + 口头同步。
- **落点**：`.gitignore` / skill 分发策略。

### O7. slugify 对 `+` / 中文括号 promote↔verify-handoff 不一致

- **现状**：title 含 ` + ` 或中文括号时，`promote.mjs` slug 吞 `+`、`verify-handoff` 重算保 `-+-`，二者不一致 → verify「spec/plan 文件存在」FAIL，需手工 `git mv`（IS-003/033/035 复发）。
- **建议**：promote 与 verify-handoff 共用同一 `workItemSlug()`；roadmap-planner 模板建议工单标题避免 `+`/特殊字符。
- **落点**：`bootstrap/workflow/scripts/{promote,verify-handoff}.mjs`（注：在 gitignore，受 O6 阻塞）。

---

## P2 · 体验 / 收敛优化

### O8. Ready → In Progress 无脚本兜底

- **现状**：promote 只到 Ready，主线翻 active.md In Progress 后需手工同步 queue.md，否则 validate:state 报「active 持有但 queue Status=Ready」。
- **建议**：增 `npm run start <id>` 一条命令同步 active.md + queue.md 翻 In Progress。
- **落点**：`workflow/scripts/` 新增 start 命令。

### O9. sub-agent 与人工 git 操作并发不隔离

- **现状**：sub-agent 跑长任务期间，外部并发 commit / `git add -A` 会污染工单 commit 边界（IS-001 混合 commit；IS-035 implementor cwd 泄漏到主仓）。
- **建议**：派 implementor/handoff-committer 时 prompt 首条强制 `cd <worktree 绝对路径>` + commit 前断言 `git rev-parse --show-toplevel`==worktree；SKILL 不变量段提示「sub-agent 跑期间避免在同一 working tree 做 git 操作」。
- **落点**：`agents/{implementor,handoff-committer}.md`、SKILL 不变量段。

### O10. sub-agent 529/超时无降级协议

- **现状**：sub-agent 529/超时空耗（IS-024 slice2 空耗 ~7min 后主线接手），无统一降级条款。
- **建议**：定义超时降级协议（N 分钟无产出 → 主线接手 or fresh 重派），评估是否写进不变量。
- **落点**：SKILL.md 不变量 / quality-gates。

### O11. spec-drafter tbd 自检漏本仓 stub 标记

- **现状**：spec-drafter `tbd_grep` 只查「TBD/待定」，漏占位标记「待 fresh thread 起草」，曾谎报 sections_filled 假绿（IS-037）。
- **建议**：tbd_grep 自检纳入本仓 stub 标记（「待 fresh thread 起草」「占位」「（待」）+ 核行数；主线核 spec/plan 别只信 receipt。
- **落点**：`agents/spec-drafter.md`。

---

## 交付层已知缺口（非 b2r 流程，知识消化蓝图第二阶段补）

- 纳入开关不持久化（前端本地态，刷新丢失）；
- 全局消化任务执行 / 跨库 Ask / 重复·冲突·缺口 / 自动调度（运行按钮 disabled 占位）；
- 公司级知识层版本为占位（spec §11）。

---

## 优先级建议执行顺序

1. **O1**（arch-security-reviewer 回灌）——复发性最高、ROI 最大、纯模板改。
2. **O4 + O3**（CI 前置 + 固化定位）——让 E2E 真绿、消除「环境性 false」对 Manager 人判的依赖。
3. **O6 → O7**（解 gitignore 阻塞后修 slugify）——O7 受 O6 阻塞，需先定 bundle 分发策略。
4. **O2**（flake 家族）——技术债，独立排期。
5. 其余 P2 随工单顺手清。
