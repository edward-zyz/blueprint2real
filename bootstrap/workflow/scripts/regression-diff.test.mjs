import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffFailures, addToBaseline } from './regression-diff.mjs';

test('diffFailures: 区分 new 与 known', () => {
  const baseline = { suites: [{ name: 'a.test.js', reason: 'date-window' }] };
  const r = diffFailures(['a.test.js', 'b.test.js'], baseline);
  assert.deepEqual(r.known, ['a.test.js']);
  assert.deepEqual(r.new, ['b.test.js']);
});

test('diffFailures: 全在基线 → new 为空', () => {
  const baseline = { suites: [{ name: 'a.test.js' }] };
  const r = diffFailures(['a.test.js'], baseline);
  assert.deepEqual(r.new, []);
});

test('addToBaseline: 追加并去重', () => {
  const baseline = { suites: [{ name: 'a.test.js' }] };
  const next = addToBaseline(baseline, 'b.test.js', 'port-race', '2026-06-08T00:00:00+08:00');
  assert.equal(next.suites.length, 2);
  const again = addToBaseline(next, 'b.test.js', 'x', '2026-06-08T00:00:00+08:00');
  assert.equal(again.suites.length, 2); // 去重
});
