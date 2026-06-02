# blueprint2real · Bootstrap 资产

本目录是 blueprint2real skill 自带的"底盘脚手架"——给新项目首次使用 skill 时 bootstrap 用的完整 `workflow/` 子树。

## 何时使用

新项目首次用 blueprint2real skill 时，主线 thread 在启动协议中检测到无 `b2r-process/workflow.config.mjs`（也无 legacy `dev/workflow.config.mjs`）后，应当**亲自跑**：

```bash
node <SKILL_ROOT>/bootstrap/workflow/scripts/init.mjs \
  --bootstrap \
  --prefix XX \
  --milestones M0,M1,M2 \
  --project myapp \
  --target ./b2r-process
```

这条命令将一次性生成：
- `<target>/workflow/scripts/*.mjs`（validate-state / render-board / verify-handoff / promote / init / ...）
- `<target>/workflow/templates/`（init 模板）
- `<target>/workflow/package.json`（marked 依赖）
- `<target>/package.json`（npm script 别名：validate:state / render:board / verify:handoff / milestone:status / ...）
- `<target>/workflow.config.mjs`
- `<target>/AGENT_RUNBOOK.md`
- `<target>/state/{active,queue,roadmap,customer-visible,acceptance,retro}.md`

跑完后，新项目就具备完整的 b2r 底盘，可以 `cd <target>/workflow && npm install`，然后开始用 skill。

默认目录名是 `b2r-process/`（v5.1 起；旧项目可能仍叫 `dev/`，skill 启动协议两者都支持）。

## 重要：skill 不直接 Write 底盘脚本

这是 v5.1 不变量 9：**任何 sub-agent / 主线 thread 都不允许直接 Write 或 Edit** `workflow/scripts/`、`workflow/templates/`、`workflow/package.json`、`<devRoot>/package.json` 这些底盘文件。底盘只能通过 `init.mjs --bootstrap` 一次性 bootstrap。

理由：底盘文件是 skill 的共享物理实现，从单一权威源（本目录）分发；让 LLM"每次贴心生成"会导致版本漂移、与 skill 期望的契约脱节。

## 同步策略

本目录的内容应当作为 workflow 底盘的单一权威源。当 workflow 底盘升级时，需同步更新本目录并跑完整验证。
