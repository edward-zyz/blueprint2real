import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from './start.mjs';
import { loadConfigSync } from './config.mjs';

const testConfig = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3, projectName: 'insight' } });

const ACTIVE_IDLE = `# Active Work Item

- ID: —
- Name: —
- Status: Idle
- Started: —
- Spec: —
- Plan: —
- Blockers: —
- Next checkpoint: —
- Last commit: 33163ba

## 当前状态

- 当前无 active work item，等待下一轮 promote / 启动。
`;

const ACTIVE_BUSY = ACTIVE_IDLE
  .replace('- ID: —', '- ID: IS-001')
  .replace('- Name: —', '- Name: 骨架')
  .replace('- Status: Idle', '- Status: In Progress');

// 注意：start 后 queue 行须翻 In Progress，故 IS-003 起始为 Ready（无 Planned 摘要段，
// 避免 validate-state 的 Planned⇔摘要 双源约束）。
const QUEUE_READY = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | 骨架 | Done | M0 | \`../specs/IS-001_骨架.md\` | \`../work/IS-001_骨架/plan.md\` | 33163ba | 2026-05-13 |
| IS-003 | Instance Profile 加载 | Ready | M0 | \`../specs/IS-003_Instance-Profile-加载.md\` | \`../work/IS-003_Instance-Profile-加载/plan.md\` | — | — |
`;

const QUEUE_PLANNED = QUEUE_READY.replace('| Ready | M0', '| Planned | M0');

const ROADMAP_OK = `# Roadmap

## M0 · 可被部署
- **状态**：Planned

## M1 · 业务工程师
- **状态**：Planned

## M2 · 复制交付
- **状态**：Planned
`;

const CV_OK = `# Customer-Visible Changelog

## 2026-05-13 · IS-001 Done

- 客户/产品可感知变化：骨架就位
- Internal-only 变化：脚手架
`;

function setup({ active = ACTIVE_IDLE, queue = QUEUE_READY } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'start-test-'));
  const stateDir = join(root, 'state');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'active.md'), active);
  writeFileSync(join(stateDir, 'queue.md'), queue);
  writeFileSync(join(stateDir, 'roadmap.md'), ROADMAP_OK);
  writeFileSync(join(stateDir, 'customer-visible.md'), CV_OK);
  return { root, stateDir };
}

test('成功 start IS-003：active 翻 In Progress 持有 + queue 行 Ready→In Progress + validate 通过', async () => {
  const { root, stateDir } = setup();
  const r = await start({ stateDir, workId: 'IS-003', config: testConfig, today: '2026-06-03', boardPath: join(root, 'BOARD.html') });
  assert.ok(r.ok);
  assert.ok(r.validation.ok, 'start 后 validate-state 应 0 error');

  const active = readFileSync(join(stateDir, 'active.md'), 'utf8');
  assert.match(active, /- ID: IS-003/);
  assert.match(active, /- Name: Instance Profile 加载/);
  assert.match(active, /- Status: In Progress/);
  assert.match(active, /- Started: 2026-06-03/);
  assert.match(active, /- Spec: `\.\.\/specs\/IS-003_Instance-Profile-加载\.md`/);
  assert.match(active, /正在推进 IS-003/);

  const queue = readFileSync(join(stateDir, 'queue.md'), 'utf8');
  assert.match(queue, /\| IS-003 \| Instance Profile 加载 \| In Progress \| M0 \|/);
  // Last commit 字段被保留（不因启动而丢失上一轮 commit）
  assert.match(active, /- Last commit: 33163ba/);
  rmSync(root, { recursive: true, force: true });
});

test('active 非 Idle（已持有其它工单）→ 拒绝（exactly-one-active）', async () => {
  const { root, stateDir } = setup({ active: ACTIVE_BUSY });
  await assert.rejects(
    start({ stateDir, workId: 'IS-003', config: testConfig, boardPath: join(root, 'BOARD.html') }),
    /不是 Idle|exactly-one/,
  );
  rmSync(root, { recursive: true, force: true });
});

test('queue 行非 Ready（仍 Planned）→ 拒绝（须先 promote）', async () => {
  const { root, stateDir } = setup({ queue: QUEUE_PLANNED });
  await assert.rejects(
    start({ stateDir, workId: 'IS-003', config: testConfig, boardPath: join(root, 'BOARD.html') }),
    /必须为 Ready|promote/,
  );
  rmSync(root, { recursive: true, force: true });
});

test('工单不在 queue 表中 → 拒绝', async () => {
  const { root, stateDir } = setup();
  await assert.rejects(
    start({ stateDir, workId: 'IS-099', config: testConfig, boardPath: join(root, 'BOARD.html') }),
    /不在 queue\.md 表中/,
  );
  rmSync(root, { recursive: true, force: true });
});

test('--dry-run 不写盘（active 仍 Idle）', async () => {
  const { root, stateDir } = setup();
  const r = await start({ stateDir, workId: 'IS-003', config: testConfig, dryRun: true, boardPath: join(root, 'BOARD.html') });
  assert.ok(r.dryRun);
  const active = readFileSync(join(stateDir, 'active.md'), 'utf8');
  assert.match(active, /- Status: Idle/, 'dry-run 不应改 active.md');
  rmSync(root, { recursive: true, force: true });
});

test('幂等：已持有 IS-003 且 queue 已 In Progress → 再 start 不报错', async () => {
  const { root, stateDir } = setup();
  await start({ stateDir, workId: 'IS-003', config: testConfig, today: '2026-06-03', boardPath: join(root, 'BOARD.html') });
  // 第二次 start 同一工单应仍成功（幂等）
  const r2 = await start({ stateDir, workId: 'IS-003', config: testConfig, today: '2026-06-03', boardPath: join(root, 'BOARD.html') });
  assert.ok(r2.ok && r2.validation.ok);
  rmSync(root, { recursive: true, force: true });
});
