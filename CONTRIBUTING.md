# Contributing

Thanks for considering a contribution to blueprint2real.

## Development Setup

```bash
git clone https://github.com/edward-zyz/blueprint2real.git
cd blueprint2real
cd bootstrap/workflow
npm install
npm test
```

Run repository validation from the repository root:

```bash
python3 .github/scripts/quick_validate.py .
bash evals/run-all-assertions.sh
```

## Pull Requests

- Use Conventional Commits, for example `feat: add workflow fixture` or
  `fix: tighten handoff validation`.
- Keep changes focused.
- Update `README.md` and `README.zh-CN.md` together when behavior or commands
  change.
- Include validation output in the PR description.

## Design Changes

Changes to `SKILL.md`, `agents/`, `references/`, or `bootstrap/workflow/scripts/`
can affect the runtime contract. Document the reason, expected behavior, and
validation evidence in the pull request.
