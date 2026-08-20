import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_ALIASES, mergeAliases, extractDoneIds, planInit, runUpgrade } from './init.mjs';
import { loadConfigSync } from './config.mjs';

test('REQUIRED_ALIASES 含 v5.4 新脚本(值=脚本文件名)', () => {
  assert.equal(REQUIRED_ALIASES['regression:diff'], 'regression-diff.mjs');
  assert.equal(REQUIRED_ALIASES['start'], 'start.mjs');
  assert.ok(REQUIRED_ALIASES['validate:state']);
});

test('mergeAliases: 只补缺失,不覆盖已有,返回 {scripts, added}', () => {
  const existing = { 'validate:state': 'CUSTOM', other: 'keep' };
  const { scripts, added } = mergeAliases(existing, '/skill/root');
  assert.equal(scripts['validate:state'], 'CUSTOM'); // 不覆盖
  assert.equal(scripts.other, 'keep');
  assert.match(scripts['regression:diff'], /regression-diff\.mjs/); // 补缺,指向 bundle
  assert.ok(added >= 1);
});

test('extractDoneIds: 只取 Done 行的工单号', () => {
  const queue = [
    '| IS-001 | 标题 A | Done | M0 |',
    '| IS-002 | 标题 B | In Progress | M0 |',
    '| IS-003 | 标题 C | Done | M1 |',
  ].join('\n');
  assert.deepEqual(extractDoneIds(queue), ['IS-001', 'IS-003']);
});

test('init 配置模板显式生成 prePromoteCommands: []', () => {
  const root = mkdtempSync(join(tmpdir(), 'b2r-init-guard-'));
  const config = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3 } });
  const item = planInit({ config, targetDir: root }).find((it) => it.out.endsWith('workflow.config.mjs'));
  assert.ok(item);
  assert.match(item.content, /prePromoteCommands:\s*\[\]/);
  rmSync(root, { recursive: true, force: true });
});

test('upgrade 保留项目已有 prePromoteCommands 配置原文', () => {
  const root = mkdtempSync(join(tmpdir(), 'b2r-upgrade-guard-'));
  mkdirSync(join(root, 'state'));
  const configPath = join(root, 'workflow.config.mjs');
  const original = "export default { prePromoteCommands: ['npm run gate'] };\n";
  writeFileSync(configPath, original);
  writeFileSync(join(root, 'package.json'), '{"scripts":{}}\n');
  writeFileSync(join(root, 'state', 'queue.md'), '# Work Queue\n');
  runUpgrade({ targetDir: root });
  assert.equal(readFileSync(configPath, 'utf8'), original);
  rmSync(root, { recursive: true, force: true });
});
