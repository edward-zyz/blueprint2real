import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_ALIASES, mergeAliases, extractDoneIds } from './init.mjs';

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
