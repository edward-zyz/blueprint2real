import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMilestoneStatus } from './milestone-status.mjs';
import { loadConfigSync } from './config.mjs';

const baseConfig = loadConfigSync({
  override: {
    workIdPrefix: 'IS',
    workIdDigits: 3,
    milestones: ['M0', 'M1'],
  },
});

const e2eConfig = loadConfigSync({
  override: {
    workIdPrefix: 'IS',
    workIdDigits: 3,
    milestones: ['M0', 'M1'],
    e2e: {
      verifySkill: 'verify',
      launch: '',
      e2eCommands: ['npm run test:e2e'],
      reportsDir: 'e2e',
      maxRerun: 2,
    },
  },
});

const ACTIVE_IDLE = `# Active Work Item

- ID: —
- Name: —
- Status: Idle
`;

const ROADMAP = `# Roadmap

## M0 · Foundation
- **状态**：Contract Done

## M1 · Customer Flow
- **状态**：Contract Done
`;

function makeStateDir(queueMd) {
  const root = mkdtempSync(join(tmpdir(), 'milestone-status-test-'));
  const stateDir = join(root, 'state');
  mkdirSync(stateDir);
  writeFileSync(join(stateDir, 'active.md'), ACTIVE_IDLE);
  writeFileSync(join(stateDir, 'queue.md'), queueMd);
  writeFileSync(join(stateDir, 'roadmap.md'), ROADMAP);
  return { root, stateDir };
}

test('returns boundary true when all milestone items are Done', () => {
  const queue = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |
| IS-002 | B | Done | M0 | x | x | def5678 | 2026-05-13 |
| IS-003 | C | Planned | M1 | — | — | — | — |
`;
  const { root, stateDir } = makeStateDir(queue);
  const result = buildMilestoneStatus({ stateDir, config: e2eConfig, milestone: 'M0' });
  assert.equal(result.e2e_enabled, true);
  assert.equal(result.milestones.length, 1);
  assert.equal(result.milestones[0].boundary_reached, true);
  assert.equal(result.milestones[0].next_action, 'run_e2e_acceptance');
  assert.deepEqual(result.milestones[0].done_work_ids, ['IS-001', 'IS-002']);
  rmSync(root, { recursive: true, force: true });
});

test('returns boundary false while milestone has Ready or In Progress items', () => {
  const queue = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |
| IS-002 | B | Ready | M0 | x | x | — | — |
| IS-003 | C | In Progress | M0 | x | x | — | — |
`;
  const { root, stateDir } = makeStateDir(queue);
  const result = buildMilestoneStatus({ stateDir, config: e2eConfig, milestone: 'M0' });
  assert.equal(result.milestones[0].boundary_reached, false);
  assert.equal(result.milestones[0].next_action, 'continue_per_ticket_pipeline');
  assert.deepEqual(result.milestones[0].open_work_ids, [
    { workId: 'IS-002', status: 'Ready' },
    { workId: 'IS-003', status: 'In Progress' },
  ]);
  rmSync(root, { recursive: true, force: true });
});

test('reports skip action when milestone is complete but e2e block is absent', () => {
  const queue = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |
`;
  const { root, stateDir } = makeStateDir(queue);
  const result = buildMilestoneStatus({ stateDir, config: baseConfig, milestone: 'M0' });
  assert.equal(result.e2e_enabled, false);
  assert.equal(result.milestones[0].boundary_reached, true);
  assert.equal(result.milestones[0].next_action, 'skip_e2e_disabled');
  rmSync(root, { recursive: true, force: true });
});

test('unknown milestone is rejected instead of silently inventing one', () => {
  const queue = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |
`;
  const { root, stateDir } = makeStateDir(queue);
  assert.throws(
    () => buildMilestoneStatus({ stateDir, config: baseConfig, milestone: 'M9' }),
    /未知里程碑 "M9"/,
  );
  rmSync(root, { recursive: true, force: true });
});
