# blueprint2real

[English](README.md) | 简体中文

[![Validate](https://github.com/edward-zyz/blueprint2real/actions/workflows/validate.yml/badge.svg)](https://github.com/edward-zyz/blueprint2real/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.1.0-blue.svg)](CHANGELOG.md)

一个把路线图和设计文档转成可审计 Done 工单流水线的 agent skill。

blueprint2real 提供一套可复用的多 Agent 交付编排层：以 state 文件作为事实源，
配套分阶段 agent prompt、质量门禁、receipt 记录、TDD 约束、自动生成看板和
handoff 校验。它适合希望把规划、实现、评审、交付都留下证据链的项目，而不是让
交付过程散落在临时对话里。

## 核心能力

- **从 roadmap 到工单流水线**：把 roadmap 输入转成 Planned、Ready、In
  Progress、Done、Blocked、Superseded 等状态明确的工单。
- **分阶段 Agent 角色**：内置 roadmap planning、spec drafting、plan
  drafting、implementation、architecture/security review、direct fix、handoff
  commit 等角色 prompt。
- **默认质量门禁**：校验 state、依赖关系、架构红线、receipt、生成看板和
  handoff 边界。
- **里程碑 E2E 验收**：可选地按 `state/acceptance.md` 验证已完成里程碑，
  产出人类可读验收报告，并把集成失败回流成修复工单。
- **TDD 与提交纪律**：强制先写 failing test，再写最小实现，并把实现提交与
  state/board handoff 提交物理分离。
- **任意 repo 可 bootstrap**：生成 `b2r-process/` 工作区，包含 workflow config、
  state 文件、package scripts 和 board 渲染能力。
- **Agent 中立设计**：只依赖 Markdown、JSON、shell 和 Node.js 文件；不需要托管
  服务或专有 API。

## 安装

把本仓库克隆到你的 agent runtime 使用的 skills 目录：

```bash
SKILLS_DIR=/path/to/your/agent/skills
mkdir -p "$SKILLS_DIR"
git clone https://github.com/edward-zyz/blueprint2real.git "$SKILLS_DIR/blueprint2real"
```

安装 workflow 脚本依赖：

```bash
cd "$SKILLS_DIR/blueprint2real/bootstrap/workflow"
npm install
npm test
```

然后开启新的 agent session，或在你的 runtime 支持时手动刷新 skills。

## 快速开始

在目标项目中 bootstrap 工作流工作区：

```bash
node /path/to/blueprint2real/bootstrap/workflow/scripts/init.mjs \
  --bootstrap \
  --prefix APP \
  --milestones M0,M1,M2 \
  --project myapp \
  --target ./b2r-process
```

验证生成的工作区：

```bash
cd b2r-process
npm run validate:state
npm run render:board
```

通过 agent 使用：

```text
Use $blueprint2real to turn this roadmap into Done work items.
```

## 工作方式

这个 skill 按固定交付链路运行：

1. **定位 workflow state**：优先读取 `b2r-process/`，兼容 legacy `dev/`。
2. **Triage**：把每条工单打成 L0 到 L3 复杂度。
3. **Promote**：把 Planned 工单推进为经过 review 的 spec 和 plan。
4. **Implement**：先跑红测试，再做最小实现。
5. **Review**：复杂工单触发架构与安全红线审查。
6. **Handoff**：完成状态翻档、看板渲染和 handoff 校验。
7. **Milestone acceptance**：可选地在里程碑全部 Done 后跑蓝图级 E2E 旅程。

每个阶段都会写入或校验结构化产物，因此 Done 工单可以被事后审计。

## 目录结构

```text
.
├── SKILL.md
├── agents/
│   ├── roadmap-planner.md
│   ├── ui-designer.md
│   ├── design-reviewer.md
│   ├── spec-drafter.md
│   ├── plan-drafter.md
│   ├── implementor.md
│   ├── arch-security-reviewer.md
│   ├── e2e-verifier.md
│   ├── direct-fix.md
│   └── handoff-committer.md
├── bootstrap/
│   └── workflow/
├── references/
│   ├── pipeline-flow.md
│   ├── quality-gates.md
│   ├── receipts-schema.md
│   └── workflow-contract.md
├── evals/
└── design/
```

## 验证

运行仓库级验证：

```bash
npm run validate
```

也可以分别运行：

```bash
python3 .github/scripts/quick_validate.py .
cd bootstrap/workflow
npm test
bash ../../evals/run-all-assertions.sh
```

需要 agent 生成 fixture 的 heavy eval 默认跳过，可显式开启：

```bash
RUN_HEAVY_EVALS=1 bash evals/run-all-assertions.sh
```

## 安全模型

- `state/*.md` 是事实源；生成的 board 文件不手工编辑。
- workflow 脚本从本 skill bundle bootstrap，不由 agent 在交付过程中临时重造。
- sub-agent 只上报 stage receipt；pipeline status 由主线单写。
- Manager override 必须显式发生，并留下 decision record。
- 工作流默认基于本地文件运行。

## 路线图

- 增加更多不依赖特定目标 repo 的 portable eval fixture。
- 公开仓库创建后补充 Scorecard workflow。
- 补充 L0、L1、L2、L3 工单路径示例。

## 维护者

- X: [@Edwardzyzt](https://x.com/Edwardzyzt)

## 许可证

MIT
