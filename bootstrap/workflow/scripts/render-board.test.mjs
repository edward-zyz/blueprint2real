import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderBoard } from './render-board.mjs';
import { loadConfigSync } from './config.mjs';

const testConfig = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3, projectName: 'insight', boardTitle: 'Insight BOARD · 项目状态作战大屏' } });

function makeTempStateDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'render-board-test-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const VALID_ACTIVE = `# Active Work Item

- ID: IS-001
- Name: 测试用例
- Status: In Progress
`;

const VALID_QUEUE = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- |
| IS-002 | 下一项 | Ready | M0 | - | - |
| IS-001 | 测试用例 | In Progress | M0 | - | - |
`;

const VALID_ROADMAP = `# Roadmap · M0 / M1 / M2

## M0 · 可被部署 + 可信地接入第一个数据源
- 状态：Contract Done
`;

const VALID_CV = `# Customer-Visible Changelog

## 2026-05-13 · IS-001 Done

- 客户/产品可感知变化: 上线了新功能 X。
- Internal-only 变化: 重构了模块 Y。
`;

test('state 文件全缺失时报错退出', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'render-board-empty-'));
  await assert.rejects(
    () => renderBoard({ stateDir: dir, outPath: join(dir, 'BOARD.html'), config: testConfig }),
    /缺少 state 文件|missing state file/i,
  );
  rmSync(dir, { recursive: true, force: true });
});

test('完整 state 渲染出 HERO 区且 active.md 的 IS-001 与 HERO ID 一致', async () => {
  const dir = makeTempStateDir({
    'active.md': VALID_ACTIVE,
    'queue.md': VALID_QUEUE,
    'roadmap.md': VALID_ROADMAP,
    'customer-visible.md': VALID_CV,
  });
  const outPath = join(dir, 'BOARD.html');
  await renderBoard({ stateDir: dir, outPath, config: testConfig });
  const html = readFileSync(outPath, 'utf8');
  assert.match(html, /IS-001/);
  assert.match(html, /测试用例/);
  assert.match(html, /上线了新功能 X/);
  rmSync(dir, { recursive: true, force: true });
});

test('KPI CURRENT MILESTONE 加 done/total 进度（不再只显示 status）', async () => {
  const queue = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | a | Done | M0 | - | - | abc1234 | 2026-05-13 |
| IS-002 | b | Done | M0 | - | - | def5678 | 2026-05-13 |
| IS-003 | c | Planned | M0 | — | — | — | — |
| IS-004 | d | Planned | M1 | — | — | — | — |
`;
  const dir = makeTempStateDir({
    'active.md': VALID_ACTIVE,
    'queue.md': queue,
    'roadmap.md': VALID_ROADMAP,
    'customer-visible.md': VALID_CV,
  });
  const outPath = join(dir, 'BOARD.html');
  await renderBoard({ stateDir: dir, outPath, config: testConfig });
  const html = readFileSync(outPath, 'utf8');
  // M0 应显示 2/3 done (67%)
  assert.match(html, /M0[\s\S]{0,200}2\/3 done \(67%\)/);
  rmSync(dir, { recursive: true, force: true });
});

test('KPI ACTIVE Idle 时 sub-text 显示 backlog + 上轮信息（不只是"无 active"）', async () => {
  const idleActive = `# Active Work Item

- ID: —
- Name: —
- Status: Idle
- Started: —
- Spec: —
- Plan: —
- Last commit: abc1234
- Next checkpoint: —
- Blockers: —
`;
  const queue = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | a | Done | M0 | - | - | abc1234 | 2026-05-13 |
| IS-002 | b | Planned | M0 | — | — | — | — |
| IS-003 | c | Planned | M0 | — | — | — | — |
`;
  const dir = makeTempStateDir({
    'active.md': idleActive,
    'queue.md': queue,
    'roadmap.md': VALID_ROADMAP,
    'customer-visible.md': VALID_CV,
  });
  const outPath = join(dir, 'BOARD.html');
  await renderBoard({ stateDir: dir, outPath, config: testConfig });
  const html = readFileSync(outPath, 'utf8');
  // ACTIVE Idle 卡片 sub-text 应含 "上轮 IS-001" + "backlog 2 Planned"
  assert.match(html, /上轮 IS-001[\s\S]{0,100}backlog 2 Planned/);
  // READY QUEUE Empty 卡片 sub-text 应含 "2 Planned 待 promote"
  assert.match(html, /2 Planned 待 promote/);
  rmSync(dir, { recursive: true, force: true });
});

test('HERO panel Idle 时不显示一堆 — 字段（标题"当前在做"与内容不矛盾）', async () => {
  const idleActive = `# Active Work Item

- ID: —
- Name: —
- Status: Idle（无 active work item）
- Started: —
- Spec: —
- Plan: —
- Last commit: abc1234（IS-099 handoff · 2026-05-14）
- Next checkpoint: —
- Blockers: —

## 当前状态

IS-099 已 Done，落地 X / Y / Z：

- 实现 A
- 实现 B
- 实现 C
`;
  const dir = makeTempStateDir({
    'active.md': idleActive,
    'queue.md': VALID_QUEUE,
    'roadmap.md': VALID_ROADMAP,
    'customer-visible.md': VALID_CV,
  });
  const outPath = join(dir, 'BOARD.html');
  await renderBoard({ stateDir: dir, outPath, config: testConfig });
  const html = readFileSync(outPath, 'utf8');
  // HERO 区不再渲染一堆 "ID: —" / "Name: —" / "Spec: —" 字段（这些是 In Progress 模板，Idle 时无意义）
  // 找 panel [01] hero 区
  const heroMatch = html.match(/当前在做[\s\S]+?<\/section>/);
  assert.ok(heroMatch, 'HERO panel 应存在');
  const hero = heroMatch[0];
  assert.doesNotMatch(hero, /ID:\s*—/, 'Idle 时不应渲染 "ID: —"');
  assert.doesNotMatch(hero, /Spec:\s*—/, 'Idle 时不应渲染 "Spec: —"');
  assert.doesNotMatch(hero, /Plan:\s*—/, 'Idle 时不应渲染 "Plan: —"');
  // 应有"当前无 active work item" 友好提示 + Last commit + 上一轮成果总结
  assert.match(hero, /当前无 active work item/);
  assert.match(hero, /Last commit:.*abc1234/);
  assert.match(hero, /上一轮成果总结/);
  assert.match(hero, /IS-099 已 Done/);
  rmSync(dir, { recursive: true, force: true });
});

test('HERO panel In Progress 时显示完整字段（不应被 Idle 优化影响）', async () => {
  const dir = makeTempStateDir({
    'active.md': VALID_ACTIVE,
    'queue.md': VALID_QUEUE,
    'roadmap.md': VALID_ROADMAP,
    'customer-visible.md': VALID_CV,
  });
  const outPath = join(dir, 'BOARD.html');
  await renderBoard({ stateDir: dir, outPath, config: testConfig });
  const html = readFileSync(outPath, 'utf8');
  // VALID_ACTIVE 是 IS-001 In Progress，应渲染完整字段
  assert.match(html, /IS-001/);
  assert.match(html, /测试用例/);
  // 不应误触发 Idle 友好态
  assert.doesNotMatch(html, /当前无 active work item/);
  rmSync(dir, { recursive: true, force: true });
});

test('customer-visible 段落"老在前、新在后"时，LAST SHIPMENT 仍取最新段（按日期+workId 排序）', async () => {
  const cvOldFirst = `# Customer-Visible Changelog

## 2026-05-13 · IS-001 Done

- 客户/产品可感知变化: 老段（IS-001）
- Internal-only 变化: x

## 2026-05-13 · IS-002 Done

- 客户/产品可感知变化: 中段
- Internal-only 变化: x

## 2026-05-14 · IS-010 Done

- 客户/产品可感知变化: 最新段（IS-010）
- Internal-only 变化: x
`;
  const dir = makeTempStateDir({
    'active.md': VALID_ACTIVE,
    'queue.md': VALID_QUEUE,
    'roadmap.md': VALID_ROADMAP,
    'customer-visible.md': cvOldFirst,
  });
  const outPath = join(dir, 'BOARD.html');
  await renderBoard({ stateDir: dir, outPath, config: testConfig });
  const html = readFileSync(outPath, 'utf8');
  // KPI LAST SHIPMENT 应取 IS-010，不是 IS-001
  assert.match(html, /IS-010 · 2026-05-14/, 'LAST SHIPMENT 应是最新的 IS-010');
  // HERO "上一轮出产" 也应是 IS-010
  const heroSection = html.split('上一轮出产')[1] || '';
  assert.match(heroSection.slice(0, 500), /IS-010/, 'HERO 上一轮出产应展示 IS-010');
  rmSync(dir, { recursive: true, force: true });
});

test('customer-visible 不含任何 Done 段时打印 warning 但不阻断', async () => {
  const dir = makeTempStateDir({
    'active.md': VALID_ACTIVE,
    'queue.md': VALID_QUEUE,
    'roadmap.md': VALID_ROADMAP,
    'customer-visible.md': '# Customer-Visible Changelog\n\n（空，等待首个 work item Done 时追加）\n',
  });
  const outPath = join(dir, 'BOARD.html');
  let warned = false;
  const origWarn = console.warn;
  console.warn = (msg) => { if (/customer-visible/.test(String(msg))) warned = true; };
  try {
    await renderBoard({ stateDir: dir, outPath, config: testConfig });
  } finally {
    console.warn = origWarn;
  }
  assert.ok(existsSync(outPath), 'BOARD.html 应已生成');
  assert.ok(warned, '应触发 customer-visible 相关 warning');
  rmSync(dir, { recursive: true, force: true });
});
