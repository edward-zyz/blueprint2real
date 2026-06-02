#!/usr/bin/env node
// 架构红线 lint 占位脚本。
//
// 状态：项目的红线规则由 owner 沉淀进 RULES 数组；脚本本身不预设任何规则。
// 当 AGENT_RUNBOOK.md §6 中"可执行红线"条目积累到 ≥1 条时，再在 RULES
// 数组里加规则函数（签名见下方）。
//
// 用法：
//   node workflow/scripts/lint-redlines.mjs                # 总是 OK（RULES 为空时）
//   node workflow/scripts/lint-redlines.mjs --json
//   LINT_ROOT=/path/to/root node ...                       # 覆盖扫描根目录

import { existsSync } from 'node:fs';
import { isMainModule } from './config.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 规则函数列表。每个函数签名：(rootDir: string) => Issue[]
// Issue = { rule, file, line, msg, severity: 'error' | 'warn' }
const RULES = [];

export function lintAll({ rootDir }) {
  const issues = [];
  for (const rule of RULES) {
    issues.push(...rule(rootDir));
  }
  return issues;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  // 默认扫描根：从 b2r-process/workflow/scripts 上溯三级到仓库根
  const rootDir = process.env.LINT_ROOT || join(__dirname, '..', '..', '..');
  if (!existsSync(rootDir)) {
    console.error(`[lint-redlines] 未找到 ${rootDir}`);
    process.exit(2);
  }
  let issues;
  try {
    issues = lintAll({ rootDir });
  } catch (e) {
    console.error(`[lint-redlines] 致命错误: ${e.message}`);
    process.exit(2);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({ ok: issues.length === 0, root: rootDir, rules: RULES.length, issues }, null, 2) + '\n');
  } else if (RULES.length === 0) {
    console.log(`[lint-redlines] OK · 0 规则（占位脚本，待项目红线沉淀后再加入）· root=${rootDir}`);
  } else if (issues.length === 0) {
    console.log(`[lint-redlines] OK · ${RULES.length} 规则 · 0 命中 · root=${rootDir}`);
  } else {
    const byRule = {};
    for (const i of issues) (byRule[i.rule] ||= []).push(i);
    for (const [rule, list] of Object.entries(byRule)) {
      console.log(`\n\x1b[31m✗ ${rule}\x1b[0m (${list.length} 命中)`);
      for (const i of list) {
        console.log(`  ${i.file}:${i.line}`);
        console.log(`    ${i.msg}`);
      }
    }
    console.log(`\n[lint-redlines] 共 ${issues.length} 项红线命中 · root=${rootDir}`);
  }
  process.exit(issues.length === 0 ? 0 : 1);
}
