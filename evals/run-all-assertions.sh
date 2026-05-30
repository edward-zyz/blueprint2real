#!/usr/bin/env bash
# 跑 evals.json 中所有 assertion（heavy + light），输出 grading.json 格式。
# 用于在 heavy eval 子 agent 完成后一次性 grade 全部 case。
#
# 用法：
#   bash evals/run-all-assertions.sh > /tmp/grading.json

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export SKILL_ROOT

python3 <<'PY'
from datetime import UTC, datetime
import json
import os
import re
import subprocess
from pathlib import Path

root = Path(os.environ["SKILL_ROOT"])
data = json.load(open(root / "evals" / "evals.json"))

out = {
    "skill_name": data['skill_name'],
    "graded_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    "evals": [],
}

run_heavy = os.environ.get("RUN_HEAVY_EVALS") == "1"

for ev in data['evals']:
    if ev.get("weight") == "heavy" and not run_heavy:
        continue
    expectations = []
    for a in ev['assertions']:
        r = subprocess.run(
            a['command'],
            shell=True,
            cwd=root,
            env={**os.environ, "SKILL_ROOT": str(root)},
            capture_output=True,
            text=True,
            executable='/bin/bash',
        )
        raw = (r.stdout or r.stderr).strip()
        last = raw.splitlines()[-1] if raw.splitlines() else ''
        exp = a['expected']
        m = re.match(r'>=(\d+)', exp)
        if m:
            try: passed = int(last) >= int(m.group(1))
            except: passed = False
        else:
            passed = last == exp
        expectations.append({
            "text": a['text'],
            "passed": passed,
            "evidence": f"cmd: {a['command'][:80]}... → got: {last[:200]}",
        })
    pass_n = sum(1 for e in expectations if e['passed'])
    out['evals'].append({
        "eval_id": ev['id'],
        "weight": ev['weight'],
        "prompt": ev['prompt'][:200] + ("..." if len(ev['prompt']) > 200 else ""),
        "pass_rate": f"{pass_n}/{len(expectations)}",
        "pass_n": pass_n,
        "total": len(expectations),
        "expectations": expectations,
    })

print(json.dumps(out, ensure_ascii=False, indent=2))
PY
