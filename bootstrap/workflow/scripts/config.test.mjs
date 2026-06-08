import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyTitle, workItemSlug } from './config.mjs';

// v5.3 回灌 O7（IS-003/033/035 复发债）：标题含 ` + ` / 中文括号时 slug 必须稳定、
// 干净、regex 安全。promote.mjs 与 verify-handoff.mjs 共用 workItemSlug，本组测试钉死
// 该函数的产出契约，防止再退回"一个吞 +、一个留 -+-"的不一致。

test('slugifyTitle: ` + ` 归一为单个分隔符（+ 是 regex 元字符，绝不能漏进 slug）', () => {
  assert.equal(slugifyTitle('A + B'), 'A-B');
  assert.equal(slugifyTitle('C2c-review + handoff'), 'C2c-review-handoff');
});

test('slugifyTitle: 中英文括号 / 方括号一律归一为 -', () => {
  assert.equal(slugifyTitle('功能（实验）'), '功能-实验');
  assert.equal(slugifyTitle('feature (beta)'), 'feature-beta');
  assert.equal(slugifyTitle('迁移 schema（破坏性）/ 旧表'), '迁移-schema-破坏性-旧表');
});

test('slugifyTitle: 保留中文 / ASCII 字母数字 / 带变音符拉丁 / 下划线', () => {
  assert.equal(slugifyTitle('Instance Profile 加载'), 'Instance-Profile-加载');
  assert.equal(slugifyTitle('café 部署'), 'café-部署'); // 变音符不得被吞（与用户书写规范一致）
  assert.equal(slugifyTitle('snake_case 名'), 'snake_case-名');
});

test('slugifyTitle: filesystem 非法字符 / : ? * < > | " \\ 直接去掉（不留分隔符）', () => {
  assert.equal(slugifyTitle('a/b:c?d*e'), 'abcde');
});

test('slugifyTitle: 连续分隔符折叠 + 首尾去 -', () => {
  assert.equal(slugifyTitle('  ---  A  ===  B  ---  '), 'A-B');
  assert.equal(slugifyTitle('（前）后。'), '前-后');
});

test('slugifyTitle: 长度上限 80 且不以 - 收尾', () => {
  const long = '超'.repeat(200);
  const s = slugifyTitle(long);
  assert.ok(s.length <= 80, `slug 长度应 ≤80，实际 ${s.length}`);
  assert.ok(!s.endsWith('-'), 'slug 不应以 - 收尾');
});

test('slugifyTitle: 非字符串输入退化为空串', () => {
  assert.equal(slugifyTitle(null), '');
  assert.equal(slugifyTitle(undefined), '');
  assert.equal(slugifyTitle(42), '');
});

test('slugifyTitle: 产出对任意刁钻标题都是 regex 安全的（核心保证）', () => {
  const nasty = [
    'A + B (C) [D] {E} | F',
    'x*y?z:w',
    '正则元字符 .*+?^${}()|[]\\ 全套',
    '混合 ＋ 全角加号 （括号） 【方括】',
    'emoji 🚀 标题',
  ];
  for (const t of nasty) {
    const slug = slugifyTitle(t);
    // slug 只可能含 [Unicode 字母 / 数字 / _ / -]
    assert.ok(/^[\p{L}\p{N}_-]*$/u.test(slug), `slug "${slug}" 含非白名单字符（来自 "${t}"）`);
    // 拿 slug 直接拼 regex 不得抛（下游 grep / 路径匹配会这么用）
    assert.doesNotThrow(() => new RegExp(slug), `slug "${slug}" 不是合法 regex`);
  }
});

test('workItemSlug: workId_slug 拼接；标题为空时退化为纯 workId', () => {
  assert.equal(workItemSlug({ workId: 'IS-003', title: 'C2c-review + handoff' }), 'IS-003_C2c-review-handoff');
  assert.equal(workItemSlug({ workId: 'IS-009', title: '   ' }), 'IS-009');
  assert.equal(workItemSlug({ workId: 'IS-010', title: '/:*?' }), 'IS-010');
});

test('workItemSlug: 同一标题确定性产出（promote 与 verify-handoff 共用 → 天然一致）', () => {
  const args = { workId: 'IS-035', title: '统一 slugify（promote + verify-handoff）一致' };
  const a = workItemSlug(args);
  const b = workItemSlug(args);
  assert.equal(a, b);
  assert.equal(a, 'IS-035_统一-slugify-promote-verify-handoff-一致');
});
