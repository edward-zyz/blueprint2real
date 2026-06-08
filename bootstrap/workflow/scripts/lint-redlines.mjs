#!/usr/bin/env node
// 架构红线 lint。两层能力:
//   1) RULES 数组(grep 类内建红线,owner 沉淀)
//   2) config.redlineCommands(项目自带的真 arch/layer/security lint,在 projectRoot 下跑)
// root 解析严格按 devRoot,绝不 fallback 到脚本自身所在仓(O14 根因)。
//
// 用法:
//   node workflow/scripts/lint-redlines.mjs            # 占位态 → WARN(stderr) + exit 0
//   node workflow/scripts/lint-redlines.mjs --json
//   DEV_ROOT=/path node ...                            # 注入工作目录(thin 架构)

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { isMainModule, loadConfig, inferDevRoot } from './config.mjs';

// 规则函数列表。每个函数签名:(rootDir: string) => Issue[]
// Issue = { rule, file, line, msg, severity: 'error' | 'warn' }
const RULES = [];

export function lintAll({ rootDir }) {
  const issues = [];
  for (const rule of RULES) issues.push(...rule(rootDir));
  return issues;
}

// 执行 config 声明的项目红线命令。任一非 0 退出 = 红线命中。
export function runRedlineCommands(redlineCommands = [], projectRoot) {
  const issues = [];
  for (const cmd of redlineCommands) {
    try {
      execSync(cmd, { cwd: projectRoot, stdio: 'pipe' });
    } catch (e) {
      const tail = (e.stdout?.toString() || e.stderr?.toString() || e.message || '')
        .split('\n').slice(-8).join('\n');
      issues.push({ rule: 'redline-command', file: cmd, line: 0, severity: 'error', msg: tail.trim() });
    }
  }
  return issues;
}

// 统一评估入口:返回 { ok, placeholder, issues, root }
export function evaluateRedlines({ rootDir, redlineCommands = [] }) {
  const issues = [...lintAll({ rootDir }), ...runRedlineCommands(redlineCommands, rootDir)];
  const placeholder = RULES.length === 0 && redlineCommands.length === 0;
  return { ok: issues.length === 0, placeholder, issues, root: rootDir };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const devRoot = inferDevRoot();
  // projectRoot:redlineCommands 跑在项目代码根。约定 = config.projectRoot || devRoot
  // (纯 CLI 项目 devRoot 自身即根;有独立代码根的项目在 config 里声明 projectRoot)。
  let config = {};
  try { config = await loadConfig({ devRoot }); } catch { /* 占位态容忍 config 缺失 */ }
  const projectRoot = config.projectRoot || devRoot;
  if (!existsSync(projectRoot)) {
    console.error(`[lint-redlines] 未找到 projectRoot ${projectRoot}`);
    process.exit(2);
  }
  let result;
  try {
    result = evaluateRedlines({ rootDir: projectRoot, redlineCommands: config.redlineCommands || [] });
  } catch (e) {
    console.error(`[lint-redlines] 致命错误: ${e.message}`);
    process.exit(2);
  }
  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (result.placeholder) {
    // 占位态:WARN 走 stderr,不阻断;杜绝「OK · 0 规则」假绿观感。
    console.error(`[lint-redlines] WARN · 红线未配置,本 gate 无保护力 · root=${result.root}`);
  } else if (result.ok) {
    console.log(`[lint-redlines] OK · ${RULES.length} 规则 + ${(config.redlineCommands || []).length} 命令 · 0 命中 · root=${result.root}`);
  } else {
    for (const i of result.issues) {
      console.log(`\n\x1b[31m✗ ${i.rule}\x1b[0m ${i.file}`);
      console.log(`  ${i.msg}`);
    }
    console.log(`\n[lint-redlines] 共 ${result.issues.length} 项红线命中 · root=${result.root}`);
  }
  process.exit(result.ok ? 0 : 1);
}
