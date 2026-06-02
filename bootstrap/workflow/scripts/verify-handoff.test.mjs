import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyHandoff } from './verify-handoff.mjs';
import { loadConfigSync } from './config.mjs';

const testConfig = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3 } });

const ACTIVE_IDLE = `# Active Work Item

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

const ACTIVE_IN_PROGRESS = `# Active Work Item

- ID: IS-003
- Name: x
- Status: In Progress
- Started: 2026-05-13
- Spec: ../work/IS-003/spec.md
- Plan: ../work/IS-003/plan.md
- Last commit: —
- Next checkpoint: —
- Blockers: —
`;

const QUEUE_V3_DONE = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | a | Done | M0 | \`../work/IS-001/spec.md\` | \`../work/IS-001/plan.md\` | 11aa22b | 2026-05-13 |
| IS-002 | b | Done | M0 | \`../work/IS-002/spec.md\` | \`../work/IS-002/plan.md\` | 22bb33c | 2026-05-13 |
| IS-003 | c | Done | M0 | \`../work/IS-003/spec.md\` | \`../work/IS-003/plan.md\` | 33cc44d | 2026-05-13 |
`;

const ROADMAP_OK = `# Roadmap

## M0 · x
- **状态**：Planned

## M1 · y
- **状态**：Planned

## M2 · z
- **状态**：Planned
`;

const CV_WITH_V3 = `# Customer-Visible Changelog

## 2026-05-13 · IS-003 Done

- 客户/产品可感知变化：无
- Internal-only 变化：x

## 2026-05-13 · IS-002 Done

- 客户/产品可感知变化：无
- Internal-only 变化：y
`;

function setupFixture({ queue = QUEUE_V3_DONE, active = ACTIVE_IDLE, cv = CV_WITH_V3, withSpecPlan = ['IS-001', 'IS-002', 'IS-003'], boardMtimeDelta = 60 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'verify-handoff-test-'));
  const stateDir = join(root, 'state');
  const workDir = join(root, 'work');
  const boardPath = join(root, 'BOARD.html');
  mkdirSync(stateDir);
  mkdirSync(workDir);
  writeFileSync(join(stateDir, 'active.md'), active);
  writeFileSync(join(stateDir, 'queue.md'), queue);
  writeFileSync(join(stateDir, 'roadmap.md'), ROADMAP_OK);
  writeFileSync(join(stateDir, 'customer-visible.md'), cv);
  for (const id of withSpecPlan) {
    mkdirSync(join(workDir, id), { recursive: true });
    writeFileSync(join(workDir, id, 'spec.md'), `# ${id} spec stub`);
    writeFileSync(join(workDir, id, 'plan.md'), `# ${id} plan stub`);
  }
  writeFileSync(boardPath, '<html>fake</html>');
  // 把 BOARD 的 mtime 设为 state 之后（boardMtimeDelta 秒），模拟刚渲染过
  const now = Date.now() / 1000;
  utimesSync(boardPath, now + boardMtimeDelta, now + boardMtimeDelta);
  return { root, stateDir, workDir, boardPath };
}

test('全部合法 handoff → ok', () => {
  const { root, stateDir, workDir, boardPath } = setupFixture();
  const r = verifyHandoff({ stateDir, workDir, boardPath, workId: 'IS-003', config: testConfig });
  assert.equal(r.ok, true, `期望通过，实际:\n${r.checks.map((c) => `  ${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`).join('\n')}`);
  rmSync(root, { recursive: true, force: true });
});

test('timestamp ID handoff 校验通过', () => {
  const id = 'IS-260602-143052-7f';
  const queue = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ${id} | timestamp | Done | M0 | \`../work/${id}/spec.md\` | \`../work/${id}/plan.md\` | 33cc44d | 2026-06-02 |
`;
  const cv = `# Customer-Visible Changelog

## 2026-06-02 · ${id} Done

- 客户/产品可感知变化：timestamp
- Internal-only 变化：timestamp
`;
  const { root, stateDir, workDir, boardPath } = setupFixture({ queue, cv, withSpecPlan: [id] });
  const r = verifyHandoff({ stateDir, workDir, boardPath, workId: id, config: testConfig });
  assert.equal(r.ok, true, `期望通过，实际:\n${r.checks.map((c) => `  ${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`).join('\n')}`);
  rmSync(root, { recursive: true, force: true });
});

test('queue 中工单 Status 非 Done → fail', () => {
  const queue = QUEUE_V3_DONE.replace('| IS-003 | c | Done', '| IS-003 | c | Ready');
  const { root, stateDir, workDir, boardPath } = setupFixture({ queue });
  const r = verifyHandoff({ stateDir, workDir, boardPath, workId: 'IS-003', config: testConfig });
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => !c.ok && /queue Status/.test(c.name)));
  rmSync(root, { recursive: true, force: true });
});

test('queue commit hash 非法 → fail', () => {
  const queue = QUEUE_V3_DONE.replace('| 33cc44d |', '| oops |');
  const { root, stateDir, workDir, boardPath } = setupFixture({ queue });
  const r = verifyHandoff({ stateDir, workDir, boardPath, workId: 'IS-003', config: testConfig });
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => !c.ok && /commit hash/.test(c.name)));
  rmSync(root, { recursive: true, force: true });
});

test('active.md 未翻 Idle → fail', () => {
  const { root, stateDir, workDir, boardPath } = setupFixture({ active: ACTIVE_IN_PROGRESS });
  const r = verifyHandoff({ stateDir, workDir, boardPath, workId: 'IS-003', config: testConfig });
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => !c.ok && /active\.md 翻 Idle/.test(c.name)));
  rmSync(root, { recursive: true, force: true });
});

test('customer-visible 缺 IS-NNN Done 段 → fail', () => {
  const cv = CV_WITH_V3.replace(/## 2026-05-13 · IS-003 Done[\s\S]*?(?=## 2026-05-13 · IS-002 Done)/, '');
  const { root, stateDir, workDir, boardPath } = setupFixture({ cv });
  const r = verifyHandoff({ stateDir, workDir, boardPath, workId: 'IS-003', config: testConfig });
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => !c.ok && /customer-visible 段/.test(c.name)));
  rmSync(root, { recursive: true, force: true });
});

test('customer-visible 段只有 1 条 bullet → fail', () => {
  const cv = `# Customer-Visible Changelog

## 2026-05-13 · IS-003 Done

- 客户可感知变化：只有一条

## 2026-05-13 · IS-002 Done

- 客户可感知变化：无
- Internal-only 变化：y
`;
  const { root, stateDir, workDir, boardPath } = setupFixture({ cv });
  const r = verifyHandoff({ stateDir, workDir, boardPath, workId: 'IS-003', config: testConfig });
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => !c.ok && /bullet 数/.test(c.name)));
  rmSync(root, { recursive: true, force: true });
});

test('spec/plan 缺失 → fail', () => {
  const { root, stateDir, workDir, boardPath } = setupFixture({ withSpecPlan: ['IS-001', 'IS-002'] });
  const r = verifyHandoff({ stateDir, workDir, boardPath, workId: 'IS-003', config: testConfig });
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => !c.ok && /spec 文件存在/.test(c.name)));
  rmSync(root, { recursive: true, force: true });
});

test('BOARD.html 比 state 旧（未 render:board）→ fail', () => {
  const { root, stateDir, workDir, boardPath } = setupFixture({ boardMtimeDelta: -3600 });
  const r = verifyHandoff({ stateDir, workDir, boardPath, workId: 'IS-003', config: testConfig });
  assert.equal(r.ok, false);
  const stale = r.checks.find((c) => !c.ok && /BOARD\.html 已 render/.test(c.name));
  assert.ok(stale);
  assert.match(stale.detail, /请跑 npm run render:board/);
  rmSync(root, { recursive: true, force: true });
});

test('workId 格式非法 → 立即 fail，不继续走后续检查', () => {
  const { root, stateDir, workDir, boardPath } = setupFixture();
  const r = verifyHandoff({ stateDir, workDir, boardPath, workId: 'bad-id', config: testConfig });
  assert.equal(r.ok, false);
  assert.equal(r.checks.length, 1);
  rmSync(root, { recursive: true, force: true });
});
