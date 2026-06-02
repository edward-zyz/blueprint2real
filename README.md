# blueprint2real

English | [简体中文](README.zh-CN.md)

[![Validate](https://github.com/edward-zyz/blueprint2real/actions/workflows/validate.yml/badge.svg)](https://github.com/edward-zyz/blueprint2real/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.1.0-blue.svg)](CHANGELOG.md)

An agent skill that turns roadmaps and design docs into auditable, Done-driven
work-item pipelines.

blueprint2real provides a reusable orchestration layer for multi-agent delivery:
state files as the source of truth, stage-specific agent prompts, quality gates,
receipt trails, TDD enforcement, generated boards, and handoff verification. It
is designed for teams that want planning, implementation, review, and delivery
to leave a clear evidence trail instead of becoming an informal chat transcript.

## Key Features

- **Roadmap-to-work pipeline**: turns roadmap input into Planned, Ready, In
  Progress, Done, Blocked, or Superseded work items.
- **Stage-specific agent roles**: includes prompts for roadmap planning, spec
  drafting, plan drafting, implementation, architecture/security review,
  direct fixes, and handoff commits.
- **Quality gates by default**: validates state, dependencies, redlines,
  receipts, generated boards, and handoff boundaries.
- **Milestone E2E acceptance**: optionally validates completed milestones
  against `state/acceptance.md`, writes human-readable acceptance reports, and
  feeds integration failures back into the work queue.
- **TDD and commit discipline**: enforces failing-test-first implementation and
  separates implementation commits from state/board handoff commits.
- **Bootstrap for any repo**: installs a `b2r-process/` workspace with workflow
  config, state files, package scripts, and board generation.
- **Agent-neutral design**: uses plain Markdown, JSON, shell, and Node.js files;
  no hosted service or proprietary API is required.

## Install

Clone this repository into the skills directory used by your agent runtime:

```bash
SKILLS_DIR=/path/to/your/agent/skills
mkdir -p "$SKILLS_DIR"
git clone https://github.com/edward-zyz/blueprint2real.git "$SKILLS_DIR/blueprint2real"
```

Install the workflow script dependency:

```bash
cd "$SKILLS_DIR/blueprint2real/bootstrap/workflow"
npm install
npm test
```

Then start a new agent session or reload skills if your runtime supports manual
skill refresh.

## Quick Start

From a target project, bootstrap the workflow workspace:

```bash
node /path/to/blueprint2real/bootstrap/workflow/scripts/init.mjs \
  --bootstrap \
  --prefix APP \
  --milestones M0,M1,M2 \
  --project myapp \
  --target ./b2r-process
```

Validate the generated workspace:

```bash
cd b2r-process
npm run validate:state
npm run render:board
```

Use it through an agent:

```text
Use $blueprint2real to turn this roadmap into Done work items.
```

## How It Works

The skill follows a fixed delivery chain:

1. **Locate workflow state** in `b2r-process/` or a legacy `dev/` workspace.
2. **Triage** each work item into L0 to L3 complexity.
3. **Promote** planned items into reviewed specs and implementation plans.
4. **Implement** with failing tests before production changes.
5. **Review** architecture and security redlines when complexity requires it.
6. **Handoff** with state transitions, board rendering, and verification.
7. **Accept milestones** with optional blueprint-level E2E journeys once all
   work items in a milestone are Done.

Every stage writes or validates structured artifacts under the target project,
so a finished work item can be audited after the fact.

## Included Resources

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

## Validation

Run repository-level validation:

```bash
npm run validate
```

Or run checks separately:

```bash
python3 .github/scripts/quick_validate.py .
cd bootstrap/workflow
npm test
bash ../../evals/run-all-assertions.sh
```

Heavy evals that require an agent-generated fixture can be enabled explicitly:

```bash
RUN_HEAVY_EVALS=1 bash evals/run-all-assertions.sh
```

## Safety Model

- `state/*.md` is the source of truth; generated board files are not hand-edited.
- Workflow scripts are bootstrapped from this skill bundle, not recreated by an
  agent during a delivery run.
- Sub-agents report stage receipts; the main thread owns pipeline status writes.
- Manager override is explicit and leaves a decision record.
- The workflow is file-based and local by default.

## Roadmap

- Add more portable eval fixtures that do not depend on a specific target repo.
- Add a Scorecard workflow after the public repository is live.
- Expand examples for L0, L1, L2, and L3 work-item paths.

## Maintainer

- X: [@Edwardzyzt](https://x.com/Edwardzyzt)

## License

MIT
