# blueprint2real 实跑卡顿与改进 issue（codex 会话观测）

日期：2026-06-02
来源会话：codex `019e87aa-4639-77d0-89be-18ccda4d793c`（insight-subs 仓，promote IS-102 / Insight-Wiki Markdown 源格式往返 MVP）
观测者：Claude（持续观测中，新发现会追加到本文件末尾「追加观测」段）

工作目录布局（触发本批问题的前提）：
- `~/.agents/skills/blueprint2real` 是**软链** → `~/Documents/AI/my-opensource-projects/blueprint2real`（源码仓）
- b2r npm script 用 `${B2R_HOME:-$HOME/.agents/skills/blueprint2real}/bootstrap/workflow/scripts/*.mjs` 解析脚本路径，即默认走软链路径

---

## P0 · 软链安装下所有 npm gate 静默空转（假绿）★ 最高优先级 — ✅ 已修复（2026-06-02）

**修复**：抽出 `config.mjs::isMainModule(import.meta.url)`（`realpathSync` 解软链 + `pathToFileURL` 正确编码），10 个脚本（promote / validate-state / render-board / validate-config / verify-handoff / validate-pipeline-status / milestone-status / lint-redlines / render-dependencies / init）统一替换原 `import.meta.url === \`file://${process.argv[1]}\`` 守卫。
**验证**：经 `.agents` 软链路径跑 `validate-state` 从"exit 0 / 0 字节"变为"exit 1 / 290 字节并抓到真实状态不一致（insight-subs 的 active.md ID=IS-102 但 Status=Idle）"；`render-board` 真生成 BOARD.html。110 测试全绿。原始问题记录如下↓



**现象**：codex agent 跑 `npm run promote IS-102` 连续 4+ 次，每次 `exit 0` + 只有 npm banner + **零脚本输出 + 不产出 spec/plan**，期间各种 `mkdir`/`rmdir` 折腾，最后绕过 npm、直接 `node <源码真实路径>/promote.mjs IS-102` 才成功（`[promote] OK · IS-102 → Ready`）。

**根因**：每个脚本底部的 main-module 守卫写法不安全：
```js
if (import.meta.url === `file://${process.argv[1]}`) { /* main */ }
```
当脚本经软链路径被调用时：
- `process.argv[1]` = 软链路径 `…/.agents/skills/blueprint2real/…/promote.mjs`
- `import.meta.url` = Node 对 ESM **解析软链后的真实路径** `file://…/my-opensource-projects/blueprint2real/…/promote.mjs`
- 两者 `!==` → main 块整个被跳过 → 模块只 import 不执行 → **exit 0、零输出、零副作用**

现场复现（2026-06-02）：
```
# 软链路径：全部假绿
validate-state   exit=0  output_bytes=0
render-board     exit=0  output_bytes=0
validate-config  exit=0  output_bytes=0
promote --help   exit=0  （无 usage 文本）
# 真实路径：真跑
validate-state   exit=0  "[validate-state] OK · state/* 与 render-board 契约一致"
```

**影响面**：带同款守卫的脚本共 10 个 —
`promote.mjs / validate-state.mjs / render-board.mjs / validate-config.mjs / verify-handoff.mjs / validate-pipeline-status.mjs / milestone-status.mjs / lint-redlines.mjs / render-dependencies.mjs / init.mjs`。
即整条质检链（validate-state / verify-handoff / render-board / promote …）在软链安装下**全部静默假绿**。promote 之所以被发现，仅因下游 spec/plan 文件缺失可观测；validate:state 的假绿没人发现就直接信了。

**为什么危险**：b2r 的全部价值依赖这些 gate 真跑。假绿 = 工作流退化成「看心情写代码」却以为 gate 把过关。这是比"跑不顺"更严重的"静默放行"。

**建议修复**（一处模式，10 个文件同改）：
```js
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
const isMain = invokedPath && import.meta.url === pathToFileURL(invokedPath).href;
if (isMain) { /* main */ }
```
- `realpathSync(argv[1])` 把软链规整到真实路径，和 `import.meta.url` 对齐
- `pathToFileURL().href` 同时修掉 `file://` + 路径直拼对**空格 / 非 ASCII 路径**的 URL 编码 bug（中文路径同样会踩）
- 建议抽成 `config.mjs` 的共享 helper `isMainModule(importMetaUrl)`，10 个脚本统一引用，避免再次漂移
- 加一条 e2e/单测：经软链路径调用脚本，断言 stdout 非空 / 真有副作用（防回归）

---

## P1 · 无 turnkey `mint` 命令，agent 被迫手写算号脚本（且 regex 不兼容 timestamp）

**现象**：scripts/ 下没有 `mint.mjs`。SKILL.md 指示主线"读取 queue.md existing IDs → 调 `mintWorkId(config, existingIds, now)`"，但没有可直接 `npm run` 的命令。codex agent 只能手写 node 内联脚本，用正则 `/\|\s*(IS-\d+)\s*\|/g` 从 queue.md 抓已有 ID。

**隐患**：该手写 regex 只匹配 `IS-\d+`（sequential），**匹配不到 timestamp 号 `IS-260602-143052-xx`**。一旦项目切 `idScheme: timestamp`，这种 ad-hoc dedup 会漏掉时间戳号 → 算重号/撞号。

**建议**：提供 `scripts/mint.mjs` + npm script `mint`，封装 "读 queue.md → 用 `makeWorkIdRegex(config)` 收集已有 ID → `mintWorkId` → 打印新号 + slug"。让 agent 不必手写、也不必自创 regex。（注意此命令本身也要避开 P0 的 main 守卫坑。）

---

## ~~P1 · `npm run promote <id>` 参数转发歧义~~ — ❌ 误诊撤回（2026-06-02）

**复盘后撤回**：P0 修复后实测 npm 11.4.2，`npm run promote -- IS-NOPE` 与 `npm run promote IS-NOPE`（不带 `--`）**都正确把参数转发进脚本**（脚本报 "workId IS-NOPE 不符合格式"）。npm 7+ 会把用户参数自动拼到 script 命令尾部，**不需要 `"$@"`**。codex 那次 promote 全失败的唯一根因是 P0 软链空转——banner 显示 `promote.mjs IS-102` 恰好证明 npm 拼了参数，只是脚本被 P0 main 守卫跳过没执行。下面原始（错误）分析存档：

---
（原误判分析，已不成立）

**现象**：`npm run promote IS-102` 与 `npm run promote -- IS-102` 在本环境都没把参数喂进脚本，但 npm banner 仍回显 `…/promote.mjs IS-102`，让 agent 误判"参数已传"。叠加 P0 的静默空转，agent 完全无从判断到底哪步错了，只能反复试。

**说明**：npm script 是单条 `sh -c '… node "…promote.mjs"'`，脚本串未引用 `"$@"`，故 `--` 之后的转发参数落到外层 `sh` 的位置参数而非 node 命令行；banner 的回显又是 npm 另算的，与真实执行不一致。（本环境 Node 16.20.2。）

**建议**：npm script 末尾显式接 `"$@"`：
```json
"promote": "DEV_ROOT=\"$PWD\" node \"${B2R_HOME:-$HOME/.agents/skills/blueprint2real}/bootstrap/workflow/scripts/promote.mjs\" \"$@\""
```
让 `npm run promote IS-102` / `-- IS-102` 都能稳定把参数喂到脚本。

---

## P2 · promote 的 "spec/plan 已存在则拒绝" 与 agent 预建目录习惯冲突

**现象**：agent 先 `mkdir -p work/<slug>/receipts` 再 promote，随后又因 promote 行为不符预期去 `rmdir` 来回折腾。promote 的存在性守卫检查的是 spec/plan/context-pack **文件**（不是 receipts 目录），但报错信息 + 文档没让 agent 形成"promote 自己建目录，别手动预建"的预期。

**建议**：在 SKILL.md / RUNBOOK §9 明确"promote 自动建 work/<slug>/，调用前不要手动 mkdir"；promote 的"已存在"报错可补一句"如需重跑请先删除上述文件"。

---

## P2 · 多安装位置并存，来源不一致

**现象**：本机同时存在 `~/.agents/skills/blueprint2real`（软链，npm script 用）、`~/.claude/skills/blueprint2real`（独立拷贝）、`~/Documents/AI/my-opensource-projects/blueprint2real`（源码仓，SKILL.md 从这里加载）。三份 promote.mjs 当前 md5 一致，但拷贝份迟早漂移；且 agent 最终是手敲源码仓绝对路径绕过问题，说明它已对"哪份是权威"失去把握。

**建议**：文档明确权威安装位置与 `B2R_HOME` 的作用；`insight doctor` / b2r 自检里加一项"检测多份安装 / 软链 vs 拷贝混装"的告警。

---

## 备注 · 非 b2r 本体问题（仅记录，不归 b2r 改）

- 整条 promote+plan 周期里 codex 只 `spawn_agent` 1 次、`wait_agent` 1 次——pipeline 基本被 codex 当单 agent 内联跑，没走 b2r 设计的 sub-agent fan-out。更像 codex harness 的 spawn 能力/调用习惯限制，b2r 侧暂不处理，但若要在 codex 上保证多 agent 编排，需要 SKILL.md 对 codex 的 spawn 接口给更明确指引。
- handoff 回归 `npm test -- …insight-wiki…` 出现 24 failed / 45 passed，属 IS-102 TDD 红灯阶段的预期失败，非工作流问题。

---

## 追加观测

（持续观测 codex `019e87aa` 会话，新卡顿点追加于此）

- 2026-06-02：首批 5 条已记录（上文 P0–P2）。会话仍活跃，继续观测。

- 2026-06-02（会话 587→870 行，IS-102 实现+交付段）：
  - **P0 在交付收口处复发，且后果落实（升级 P0 证据）**：agent 完成实现后跑 `cd b2r-process && npm run validate:state` 与 `npm run render:board` 收口，两条均 `exit 0` 但**输出只有 npm banner（159 / 155 字节），无 `[validate-state] OK` / `[render-board]` 真输出** → 状态门**没校验**、BOARD.html **没重新生成**。agent 据此向用户声称"状态门通过""看板已重新生成"——**两条均为假绿**。即整个 IS-102 handoff 是被空转 gate 封板的：state 一致性未被校验、BOARD 相对 state 文件已漂移却无人知。**这把 P0 从"promote 跑不动"升级为"交付被静默放行"**，务必优先修。
  - **环境噪声（非 b2r 本体，但影响 b2r regression 门）**：本机默认 Node v16，仓库要求 v20。jest / eslint / `structuredClone` / `fetch` / `FormData` 在 Node 16 下全挂，agent 全程改用 `~/.cache/codex-runtimes/codex-primary-runtime/.../node` 跑测试。b2r 的 `regressionCommands`（`npm test` 等）若在默认 Node 下跑会被这环境带偏。**建议**：b2r 文档/`init` 提示固定 Node 版本，或 regression 命令允许声明 runtime；否则 regression 门的红/绿不可信。
  - 其余非零退出均为既有仓库噪声（历史 v1.0 文档命名 lint、flat-config 对 `packages/_sdk` 的 `require/module` no-undef、changed-only 安全扫描历史桩），agent 均正确判定"非本次引入"，不归 b2r。

- 2026-06-02（会话 992→1070 行，6173 UI 验收 + 最终状态封板段）：
  - **P0 第 3 次复发**：agent 补完 6173 验收证据、修正回执里的 Node 检查（Volta v20 通过）后，再次 `cd b2r-process && npm run validate:state`（159 字节仅 banner）+ `npm run render:board`（155 字节仅 banner）封板——又是空转假绿。即本会话**每一次**经 npm 跑 gate 都 no-op，agent **每一次**都当成通过。P0 在一条会话里复发 3 次（promote / 首次 handoff / 最终封板），无一被 agent 察觉，进一步证明这不是偶发而是软链安装下的确定性失效。
  - 本段其余为 insight-wiki 6173 UI 验收（找 dev 登录 super_admin / 固定验证码 123456 / Playwright 验 reader iframe 渲染），非 b2r。

- 2026-06-02（会话 1196→1378 行，commit / push / MR 段——P0 影响外溢到远端）：
  - **P0 第 4 次复发，且这次是 `verify:handoff`（此前只合成测过，现得实战确认）**：收尾 IS-101 时 `npm run verify:handoff IS-101` → exit 0 / **166 字节仅 banner / 无 `[verify-handoff]` 输出** → 空转假绿。agent 随即基于这个"已验证"的 handoff 连提 3 commit、`git push -o merge_request.create` **创建了真实 GitLab MR !823**（指向 master）。
  - **后果升级：假绿外溢到代码评审**。IS-101 Done 收尾 + IS-102 状态变更，是被**整套空转 gate**（promote / validate:state / render:board / verify:handoff 全 no-op）封板后推上 MR 的。即 b2r 的"可回滚、可审计、gate 把关"承诺在本会话**端到端落空**，且产物已进入远端评审流。这把 P0 从"本地假绿"升级为"**带病交付到 MR**"，务必最优先修。
  - 旁证（真跑的对照）：同会话 jest 套件（insight-wiki 64 套/350、cli 26 套/291）、Playwright 6173 验证均**有真实输出、真绿**——说明 agent 的测试是真跑的，唯独 b2r 自己的 npm gate 因软链守卫 bug 全程假绿。对比鲜明，根因确凿。
  - 注：项目封装的 `npm run test:e2e` 未被调用，端到端走的是 agent/子 Agent 手写 Playwright + HTTP 脚本（真跑真过）。
