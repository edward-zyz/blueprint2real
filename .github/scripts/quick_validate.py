#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


REQUIRED_FILES = [
    "SKILL.md",
    "package.json",
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    ".editorconfig",
    ".gitignore",
    ".github/workflows/validate.yml",
    ".github/dependabot.yml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/CODEOWNERS",
]

REQUIRED_DIRS = [
    "agents",
    "bootstrap/workflow/scripts",
    "bootstrap/workflow/templates",
    "references",
    "evals",
]

FORBIDDEN_PATTERNS = [
    re.compile(r"/Users/[^\\s\"']+"),
    re.compile(r"Vibecoding/insight-subs"),
    re.compile(r"shiheng|食亨", re.IGNORECASE),
    re.compile(r"OpenAI|ChatGPT|Codex"),
]


def fail(message: str) -> None:
    print(f"[quick_validate] FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def iter_text_files(root: Path):
    ignored = {".git", "node_modules"}
    for path in root.rglob("*"):
        if any(part in ignored for part in path.parts):
            continue
        if path.relative_to(root).as_posix() == ".github/scripts/quick_validate.py":
            continue
        if path.is_file() and path.suffix.lower() in {
            "",
            ".md",
            ".mjs",
            ".js",
            ".json",
            ".yml",
            ".yaml",
            ".html",
            ".tmpl",
            ".txt",
        }:
            yield path


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    if not root.exists():
        fail(f"root does not exist: {root}")

    for rel in REQUIRED_FILES:
        if not (root / rel).is_file():
            fail(f"missing required file: {rel}")

    for rel in REQUIRED_DIRS:
        if not (root / rel).is_dir():
            fail(f"missing required directory: {rel}")

    skill = (root / "SKILL.md").read_text(encoding="utf-8")
    if "name: blueprint2real" not in skill:
        fail("SKILL.md frontmatter must include name: blueprint2real")
    if "description:" not in skill:
        fail("SKILL.md frontmatter must include description")

    readme = (root / "README.md").read_text(encoding="utf-8")
    readme_zh = (root / "README.zh-CN.md").read_text(encoding="utf-8")
    if "README.zh-CN.md" not in readme or "README.md" not in readme_zh:
        fail("README language switch links are missing")
    if "MIT" not in readme or "MIT" not in readme_zh:
        fail("README files must mention the MIT license")

    for path in iter_text_files(root):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in FORBIDDEN_PATTERNS:
            if pattern.search(text):
                fail(f"forbidden pattern {pattern.pattern!r} in {path.relative_to(root)}")

    print("[quick_validate] OK")


if __name__ == "__main__":
    main()
