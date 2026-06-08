import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintAll, evaluateRedlines } from './lint-redlines.mjs';

// lint-redlines 当前是占位脚本（RULES = []）：
// 任何 fixture 都应返回 0 issue。
// 当 AGENT_RUNBOOK §6 沉淀出可执行红线、RULES 数组非空后，
// 在此文件追加针对每条规则的 fixture 测试。

test('lintAll · 占位状态返回空数组', () => {
  const root = mkdtempSync(join(tmpdir(), 'lint-redlines-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/foo.js'), `export const x = 1;`);
  assert.deepEqual(lintAll({ rootDir: root }), []);
  rmSync(root, { recursive: true, force: true });
});

test('lintAll · 空目录不崩', () => {
  const root = mkdtempSync(join(tmpdir(), 'lint-redlines-'));
  assert.deepEqual(lintAll({ rootDir: root }), []);
  rmSync(root, { recursive: true, force: true });
});

// === O14: evaluateRedlines + redlineCommands ===

test('占位态(无 RULES 无 redlineCommands)返回 placeholder=true', () => {
  const r = evaluateRedlines({ rootDir: process.cwd(), redlineCommands: [] });
  assert.equal(r.placeholder, true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test('redlineCommands 全 0 退出 → ok=true,non-placeholder', () => {
  const r = evaluateRedlines({ rootDir: process.cwd(), redlineCommands: ['true'] });
  assert.equal(r.placeholder, false);
  assert.equal(r.ok, true);
});

test('redlineCommands 非 0 退出 → ok=false + 命中记录', () => {
  const r = evaluateRedlines({ rootDir: process.cwd(), redlineCommands: ['false'] });
  assert.equal(r.ok, false);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].rule, 'redline-command');
});
