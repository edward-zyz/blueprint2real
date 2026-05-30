import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintAll } from './lint-redlines.mjs';

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
