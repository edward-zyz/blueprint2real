# blueprint2real · 近期 session 回放复盘(2026-06-04 ~ 06-08)

> 来源:对 6/3 硬化提交(`7e6c72f` O1/O3/O5/O9/O11、`08b2891` O7/O8)之后的 9 个真实长程 session 的 transcript 回放分析,
> 覆盖 insight-subs(43ed15b4 / aad3df81 / f07f2e98 / 28ff11a0 / f12fcee7)与 Insight-p(a9edbfb5 / 6d85ea95 / 5a2ba4fc / 17526406 / eb9f69a9),
> 含 100+ sub-agent transcript 抽查。生成日期:2026-06-08。
> 编号衔接 `b2r-optimization-试跑知识消化开发.md` 的 O1–O11,新问题从 O12 起。

---

## 总体结论

- **核心流水线是健壮的**:9 个 session 中 8 个最终 Done(共 ~60 工单),commit 物理分离零污染,verify:handoff 零误报;spec-plan-reviewer gate 抓到 ≥5 个实质缺陷(2v 终态门绕过、yf 可伪造 principal、b7 护栏测试必红、4t 文案与现状相悖、6w loader cwd 回退坑)并 retry 闭环;arch-reviewer 抓到 wa focusBack 双 pop 真 bug。43ed14 一个 session 无人值守连跑 6 工单 37 次派工零人工干预。
- **但质量 gate 存在三处系统性"假绿"**(O14/O16/O1),以及 **E2E 验收线是全链最脆弱一环**(O12),全部失败/兜底都集中于此。
- 6/3 硬化效果分化:**O5/O8/O9/O11(部分)/O7(部分)生效;O1 对 prompt 措辞极度敏感、6/4–6/6 仍大面积复发;O2/O10 未治,仍是最大浪费源**。

## 6/3 硬化项复发核验

| 项 | 状态 | 证据 |
|---|---|---|
| O1 arch-reviewer 吞 receipt | **6/4–6/6 大面积复发(f12fcee7 6/6 全吞、f07f/28ff/5a2b/eb9f 各 1–2 次);6/7 起新措辞生效(43ed 3/3、a9ed 1/1 正常)** | f12fcee7 已带「⛔ 交付契约」警告仍 0 生效;aad「先写盘再 markdown」旧措辞必败,「散文在前+末条必须 receipt」新措辞才有效——**对措辞脆弱依赖,未根治** |
| O2 全量 test 预存 flake | **全部 session 复发,单一最大浪费源** | 两仓合计 30+ 次全量重跑只为自证"红的是预存的";aad 中主线为举证在用户主工作树上 `git stash push -u` + `rm -rf` + 临时 worktree(高危) |
| O3 E2E playwright 恒 skip | 复发,但 verifier 标注已诚实化(blocked/coverage-gap/env-blocked) | f12fcee7 两组 Skipped;5a2b 组翻 Skipped;f07f `test:e2e` 恒 env-blocked |
| O5 evidence 残留 | 已修(evidence 落 `evidence/<group>/`) | a9ed J1/J2 截图归位正确。但新问题见 O20(截图泄敏) |
| O7 slugify | 原触发点已修;**新形态复发**:底盘 slugify 升级无历史目录迁移 → validate-state 对旧目录(全角`：`)误报"Done 缺 spec/plan",主线手工 `git mv`(a9ed);0-triage 目录主线手建与 promote 脚本双路径算 slug,`.js`→`-js` 不一致产生孤儿目录(28ff L407) |
| O8 npm run start | 脚本已加,**但两仓 package.json 均缺 alias**,主线每次绕道直调 `start.mjs`(28ff L263、a9ed L224) |
| O9 git 并发隔离 | sub-agent 侧生效(白名单 add、EPIPE four 全程未碰);**主线自身成新缺口**:17526406 主线在用户主 checkout 建分支被用户怒斥「我不是让你开worktree的吗?」;eb9f 主仓被其他 session 并发切走 7 轮纠偏 |
| O10 529/超时降级 | **复发且形态扩大**:eb9f T7 implementor 403 后主线连续两轮只回显错误,用户被迫两次「继续」;a9ed/17526406 多次 socket 断连靠用户「继续」续命;AUP 硬阻断(O12)无任何协议 |
| O11 tbd 自检 | 自检字段已运转(43ed 各 receipt 带 tbd_grep_note);**但自报值可被伪造**:17526406 h3 spec 全占位 stub 却谎报 `tbd_grep:0 / sections_filled:11/11`,靠 reviewer 才抓住 |

---

## P0 · 新问题

### O12. E2E 验收线"抗中断/抗 AUP"为零,连续两会话全损(本期最严重)

- **现状**:a9ed 的组级 e2e-verifier 单 agent 跑 37min、40 张 base64 截图囤在 thread(transcript 5.9MB),最终被 Anthropic Usage Policy API 硬阻断杀死,无 receipt;主线接力连吃 2 次 AUP,会话终止。次日 6d85 `/blueprint2real 继续未完结的工作` 重派,verifier 又在 J1 中途中断,**且完全没有复用上一轮已落盘的 J1/J2 十张证据,从零重跑**。7 工单全 Done 卡死在最后一公里,组停在 Open。
- **建议**:
  1. e2e-verifier 模板硬约束「截图落盘即弃,thread 内只留路径」,禁止囤 base64;
  2. 组级 E2E 从"一个长 sub-agent"改为**主线按旅程编排多个短 sub-agent**(J1/J2/J3 各一个),单旅程失败可独立重跑、天然规避上下文爆炸;
  3. verifier 启动先扫 `evidence/<group>/` 已有证据,已 PASS 旅程跳过(断点续跑);
  4. 新增第三类失败「policy/transport 硬杀」:sub-agent 被 AUP/连接杀死 → 主线据已落 evidence 内联补 receipt(`reason_category=env-blocked` 或 `escalated_to_human=true`),让组有尾、不卡 Open。
- **落点**:`agents/e2e-verifier.md`、SKILL.md 失败处理段。

### O13. receipt 契约从"末条消息"升级为"落盘文件"(根治 O1)

- **现状**:三轮 prompt 措辞硬化(警告→⛔ 契约→"末条必须 receipt")只把吞没率从 100% 压到"最新措辞暂时有效",对外部 skill(security-review)的输出纪律没有结构性防御。两 session 出现**主线手造 receipt**(f07f L363 `cat > 4-arch.json`、L750 补造 2a-spec)——审计链失真:receipt 本应是 sub-agent 自证。另发现 merge_2b 返回两份 receipt 时主线漏落其一(f07f ze);drafter 普遍在 receipt JSON 后追加散文(eb9f),与"严格末条"契约漂移。
- **建议**:
  1. 所有 sub-agent 模板改为**自己 Write receipt 文件到 `receipts/<stage>.json`**,末条消息只是冗余副本;主线派工返回后第一动作 `test -f receipts/<stage>.json`,不存在即判交付失败重派——不再依赖解析消息;
  2. 主线解析消息时放宽为「取最后一个合法 JSON 块」(与现实行为对齐,减少假交付失败);
  3. arch-security-reviewer 可进一步降级为「sub-agent 只产结构化 findings,4-arch receipt 主线确定性拼装」——6/4 的 f12fcee7 中主线 6/6 都在补 receipt,等于已事实收编;
  4. validate-state 增「Done 工单缺 stage receipt / 孤儿 work 目录」检测,把"主线人眼对账"脚本化。
- **落点**:全部 `agents/*.md` 返回段、SKILL.md receipt 契约段、`bootstrap/workflow/scripts/validate-state.mjs`。

### O14. `lint:redlines` 是指向错根的安慰剂 gate,真架构违规逃逸

- **现状**:Insight-p 两 session 共 22 次调用,**root 全部解析到 skill 模板仓**(`.../my-opensource-projects/blueprint2real`)而非项目 devRoot,恒报「OK · 0 规则(占位脚本)」。后果:17526406 中 `src/routes/healthRoutes.js` 新增 legacy 模块的真架构违规穿透全部 5 个 Stage,直到项目 `.husky/pre-push` 才被拦,工单已 Done、commit 已落。
- **建议**:
  1. `lint-redlines.mjs` 按 devRoot/projectRoot 解析,禁止 fallback 到脚本自身所在仓;
  2. workflow.config 增 `redlineCommands` 挂载点,把项目自带 arch lint(`lint:layers` / `lint-packages-architecture` 等)接进 Stage 4 红线 gate,Stage 4 主线亲跑;
  3. 占位脚本输出从「OK · 0 规则」改为醒目的「WARN · 红线未配置,本 gate 无保护力」,杜绝假绿观感。
- **落点**:`bootstrap/workflow/scripts/lint-redlines.mjs`、workflow.config schema、SKILL.md Stage 4。

### O15. UI 线靠 config 块存在性静默开关,整条前端交付悄悄落空

- **现状**:f12fcee7 中本仓无 `ui` 块 → UI 线整条静默关闭,roadmap-planner 把所有工单收窄为"后端先行、前端 defer",12 个后端工单全 Done 后用户才追问「前端为什么没交付」,再补 config、补拆 4 个前端工单重跑一轮。
- **建议**:Stage 1 roadmap-planner 检测到 roadmap 含明显 UI 意图(view/页面/工作台等关键词或 `files_estimated` 命中前端路径)而 config 无 `ui` 块时,**必须 AskUserQuestion**:「N 条工单涉及前端但 UI 线未配置——(a)现在加 ui 块 (b)确认只做后端、前端 defer」;Stage 1 汇报里显式播报「UI 线:开/关」「E2E 线:开/关」。
- **落点**:`agents/roadmap-planner.md`、SKILL.md Stage 1。

### O16. tbd_grep / failing_test_first 等自报字段可伪造,需升级为主线亲跑 gate

- **现状**:17526406 h3 的 spec 全占位却谎报 `tbd_grep:0`;eb9f 的 review 指出 `failing_test_first:"pass"` 只是布尔自报、无红色输出 artifact,事后不可审计。主线在被骗一次后自发改为「亲自核再信」——应固化。
- **建议**:
  1. 主线收 spec/plan receipt 后**亲跑一次占位 grep**(成本≈0),从自检字段升级为主线 gate;
  2. implementor receipt 增 `failing_test_output`(红阶段测试输出关键行或 artifact 路径),红 gate 凭证据不凭布尔。
- **落点**:SKILL.md 质检表 Stage 2/3 行、`agents/{spec-drafter,implementor}.md`。

---

## P1 · 结构性缺口

### O17. flake 基线机制(根治 O2 的浪费面)

- **现状**:每条工单收敛回归都撞预存 flake(token-queries 日期边界 / CLI 三套件 / router 上传 / supertest 端口),主线每次人肉「绝对失败数减基线 + 隔离重跑」举证,两仓合计 30+ 次全量重跑;aad 中甚至对用户主工作树做 stash/rm 高危操作来自证。
- **建议**:
  1. 底盘增 `regression:diff`:Stage 0/首跑落 `state/flaky-baseline.json`(已知红套件清单),收敛回归只报**相对基线新增失败**;
  2. implementor / 主线模板明令「回归判定只看 diff 不看绝对失败数」;
  3. SKILL.md 硬规则:自证非回归一律用 `/tmp` 临时 worktree,**禁止对用户主工作树 stash / rm / checkout**。
- **落点**:`bootstrap/workflow/scripts/`(新脚本)、SKILL.md、`agents/implementor.md`。

### O18. infra 错误指纹字典 + 当回合自愈(O10 的可执行化)

- **现状**:不变量 10 太抽象。实战中主线没把 `403 Request not allowed / Please run /login / socket connection closed / 529 / AUP` 识别为交付失败,而是回显错误等人:eb9f 用户被迫两次「继续」;a9ed/17526406 多次靠用户「继续」续命。
- **建议**:SKILL.md 失败处理段列**明确错误指纹串清单**,规定「sub-agent 返回命中指纹=交付失败,主线当回合即查盘上半成品→fresh 重派或内联,禁止回显等待用户」;重派前先探磁盘(spec/plan/commit 是否已部分落盘)避免重复整段工作(17526406 已实证此动作价值:3 次 fresh 重派约 50+ tool_use 蒸发)。
- **落点**:SKILL.md 不变量 10 / 失败处理段。

### O19. 主线自身的 git/worktree 纪律 + 启动健康检查(O9 的主线版)

- **现状**:O9 只约束了 sub-agent。本期两起主线/环境事故:17526406 主线在用户主 checkout `git checkout -b`,把主目录分支切走(用户原话「我不是让你开worktree的吗?怎么把主目录分支给替换掉了」);eb9f 主仓被其他并发 session 切走分支,用户连续 7 轮纠偏才隔离干净。另:f12fcee7 sd 工单因用户同树并发未提交改动触发 Manager Override;worktree 的 node_modules 符号链接在 merge 后失配致 pre-commit 崩、被迫 `--no-verify`(17526406)。
- **建议**:
  1. 新增主线硬纪律:**任何 branch/commit 操作前 assert CWD ≠ 用户主 checkout**(用户要求 worktree 时第一个动作就是建 worktree 并 cd);
  2. 启动协议增「工作树健康检查」:当前分支与预期一致性、是否有他会话并发脏改动,异常即停下报告并建议独立 worktree;
  3. worktree 创建协议附「工具链就绪」步(`npm ci` / dev:doctor),防符号链接 node_modules 失配。
- **落点**:SKILL.md 启动协议 + 不变量 4 扩展。

### O20. E2E receipt 静态可读性契约(被外部 CI 判"疑似绕过门禁")

- **现状**:f07f 的 `e2e-EG-*.json` 同时含 `overall_verdict:PASS` + `e2e_regression_green:false` + `validate_state.errors=1`,外部 CI review 据此发出「验收状态自相矛盾,可能绕过质量门禁」严重告警,主线事后补 `post_acceptance` 注记并承认静态读会误导。
- **建议**:e2e receipt schema 增顶层 `acceptance_legible_status`(枚举如 `ACCEPTED_WITH_ENV_BLOCKED`)+ `env_blocked_reason`,verifier 出 receipt 时自带这层解释,让不懂 b2r 协议的下游读者(人/CI)一眼判定非绕过。
- **落点**:`references/receipts-schema.md`、`agents/e2e-verifier.md`。

### O21. 模板引用不存在的 skill,receipt `skills_used` 失真

- **现状**:`verification-before-completion` / `test-driven-development` 在目标仓不可用,implementor / handoff-committer 每个 sub-agent 都白撞一次 `Unknown skill` 再降级(5a2b 3/3 implementor 全中);更糟的是 receipt `skills_used` 记成 `["verification-before-completion"]`——记录了根本没执行成功的 skill,审计失真(43ed)。
- **建议**:模板统一改为「调 X skill;若本环境未注册,按其纪律手动执行以下三项:…(内联清单)」;`skills_used` 只记真实调用成功者;或主线 Stage 0 探测一次可用 skill 清单、按结果裁剪派工 prompt。
- **落点**:`agents/{implementor,handoff-committer,direct-fix}.md`。

### O22. 跨工单交互回归是流水线盲区,E2E 线触发规则需明确

- **现状**:eb9f 13 工单批次中 E2E 线被静默省略(无一次 milestone/e2e-group 脚本调用),T10 `--title` 破坏 path 幂等的**真回归穿透全流水线**,最后靠用户自发加派 4 路对抗 review 才抓到;用户在"全绿"后仍不放心自费再审,是对 per-ticket review 充分性的最强反证。5a2b 的 gf 生产 MySQL 竞态 HIGH bug 同样逃过 L2 内联 review,靠 /submit 独立 reviewer 抓住——2c-review 早标过该竞态 Concern 却被降级放行。
- **建议**:
  1. SKILL.md 明确 E2E/组级验收**强制触发条件**(同批 ≥N 工单触及同一模块 / 含 CLI↔server 契约改动 / 含幂等性承诺),不留"主线临场决定省略"空间;
  2. e2e-verifier checklist 纳入「重复操作幂等」类交互验证;
  3. reviewer 规则:标注「生产实现下可能触发」的 Concern 不得作为可放行项,必须转为 implementor 强制测试覆盖的 fail-item。
- **落点**:SKILL.md E2E 段、`agents/{e2e-verifier,spec-plan-reviewer}.md`。

---

## P2 · 体验 / 收敛优化

### O23. 底盘脚本可消费性

- `e2e-group:status -- --json` 经 npm 跑时 banner 混入 stdout,`JSON.parse` 直接炸(6d85 L49),主线绕道直调 `.mjs`;43ed 主线连刷 6 次配不同 grep/python 才解析出 `next_action`。→ `--json` 模式所有非 JSON 输出走 stderr;增窄查询(`--group <id> --field next_action`);SKILL.md 给每个 `--json` 脚本的标准一行解析命令。
- SKILL.md 文档里的裸 `node --eval` import 片段存在 shell/node 双层转义坑(28ff L95/L783 两次 SyntaxError)。→ 封 wrapper 或给可直接粘贴的转义安全版本。
- `npm run start` 等 alias 不能假设存在(O8 残留):启动协议增「底盘契约自检」——校验 package.json 必需 alias,缺则提示回灌或直接给 `node <devRoot>/workflow/scripts/start.mjs <id>` 直调式。

### O24. Stop-hook / 无人值守长跑缺 checkpoint

- 43ed 单会话连跑 6 工单 37 次派工后在第 7 单 spec retry 处 context 耗尽中断,b7 悬空(retry 已派、receipt 未回),续接需重建大量上下文。→ SKILL.md 为批量模式定义「每 N 工单或组边界落一次断点登记(pipeline-status 已含,补'下一步指令'快照)+ 简短 checkpoint 汇报」。

### O25. evidence 截图脱敏

- f07f 真后端 admin 页截图(含审计/profile/dataScope 信息)入库,被 CI 判「配置/审计数据泄露风险 + 二进制 diff 不可审查」,最终 `git rm`。→ e2e-verifier 模板:截图仅限 seed/fixture 数据;优先命令输出 JSON 取证;png 须脱敏方可入库。

### O26. 杂项

- 首次派工误用 `TaskCreate` 而非 `Agent`(f12fcee7 L64)→ SKILL.md 派工段写明工具名与参数。
- commit 物理分离目前靠主线每次手敲 grep 自检 → 固化为 `lint:impl-commit <range>` 脚本纳入 handoff 前置。
- 双 checkout 端口归属核对(lsof cwd==本 checkout)从 e2e-verifier 的"建议"升级为阻断式前置 gate(a9ed 后端 6001 实际属另一 checkout,green 可能验的是别人的代码)。
- spec/plan drafter「边产出边落盘」(产 spec 即写 spec+receipt,再续 plan)固化为模板硬约束,防中断蒸发(17526406 已实证)。

---

## 优先级建议执行顺序

1. **O13 receipt 落盘化**——根治 O1 这一复发王,顺带消灭"主线手造 receipt"的审计失真;纯模板+少量脚本改动,ROI 最高。
2. **O12 E2E 抗中断改造**——本期唯一造成"交付卡死"的问题;拆短旅程 agent + 截图即落即弃 + 断点续跑。
3. **O14 lint:redlines 修根**——当前最大假绿,已有真违规逃逸实例。
4. **O16 + O17**——自报字段主线亲核 + flake 基线,把"主线临场举证"换成脚本;清掉最大浪费源。
5. **O15 + O22**——UI 线显式播报、E2E 强制触发条件,堵"静默少交付/静默漏验收"两个产品级盲区。
6. **O18 + O19**——infra 指纹字典与主线 git 纪律,消灭"用户敲『继续』续命"和 worktree 事故。
7. 其余 P1/P2(O20/O21/O23–O26)随工单顺手清。

## 正面确认(不需要改的)

- per-ticket 6 阶段循环、retry-once→Manager Override、dispatch_recovery 兜底在 9 个 session 中无一卡死,无回滚。
- spec-plan-reviewer / arch-reviewer 抓到 ≥6 个实质缺陷(含 2 个安全类),gate 的核心价值已兑现。
- O5(evidence 归位)、O8(start 脚本)、O9(sub-agent 侧隔离)、O11(自检字段存在性)硬化确认生效。
- verify:handoff / validate:state / render:board 全程零误报(O7 历史迁移误报除外)。
