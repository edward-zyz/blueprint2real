# Bootstrap Output Example

Running:

```bash
node /path/to/blueprint2real/bootstrap/workflow/scripts/init.mjs \
  --bootstrap \
  --prefix APP \
  --milestones M0,M1 \
  --project demo \
  --target ./b2r-process
```

Creates a local workflow workspace:

```text
b2r-process/
├── AGENT_RUNBOOK.md
├── BOARD.html
├── package.json
├── specs/
├── state/
│   ├── active.md
│   ├── customer-visible.md
│   ├── queue.md
│   ├── roadmap.md
│   └── retro.md
├── work/
└── workflow.config.mjs
```

The target project then owns state and receipts. The reusable workflow scripts
stay in the installed skill bundle.
