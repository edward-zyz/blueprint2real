import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGroupStatus, parseGroupRows } from './e2e-group-status.mjs';
import { loadConfigSync } from './config.mjs';

function cfg(e2e) {
  return loadConfigSync({
    override: { workIdPrefix: 'IS', workIdDigits: 3, milestones: ['M0', 'M1'], ...(e2e ? { e2e } : {}) },
  });
}

const groupConfig = cfg({ verifySkill: 'verify', e2eCommands: ['npm run test:e2e'], reportsDir: 'e2e', maxRerun: 2, unit: 'group' });
const milestoneOnlyConfig = cfg({ verifySkill: 'verify', e2eCommands: ['npm run test:e2e'], reportsDir: 'e2e', maxRerun: 2 }); // unit 默认 milestone
const noE2eConfig = cfg(null);

function makeStateDir(queueMd, groupsMd) {
  const root = mkdtempSync(join(tmpdir(), 'e2e-group-status-test-'));
  const stateDir = join(root, 'state');
  mkdirSync(stateDir);
  writeFileSync(join(stateDir, 'queue.md'), queueMd);
  if (groupsMd !== null) writeFileSync(join(stateDir, 'e2e-groups.md'), groupsMd);
  return { root, stateDir };
}

const QUEUE = (rows) => `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows}
`;

const GROUPS = (rows) => `# E2E Groups

| Group | WorkIds | Status | Receipt | Created |
| --- | --- | --- | --- | --- |
${rows}
`;

test('boundary true when all group members Done and group Open (group unit enabled)', () => {
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |
| IS-002 | B | Done | M0 | x | x | def5678 | 2026-05-13 |`);
  const groups = GROUPS(`| EG-260602-190312 | IS-001, IS-002 | Open | — | 2026-06-02 |`);
  const { root, stateDir } = makeStateDir(queue, groups);
  const result = buildGroupStatus({ stateDir, config: groupConfig });
  assert.equal(result.group_unit_enabled, true);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].all_done, true);
  assert.equal(result.groups[0].boundary_reached, true);
  assert.equal(result.groups[0].next_action, 'run_group_e2e');
  rmSync(root, { recursive: true, force: true });
});

test('boundary false while a group member is not Done', () => {
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |
| IS-002 | B | In Progress | M0 | x | x | — | — |`);
  const groups = GROUPS(`| EG-260602-190312 | IS-001, IS-002 | Open | — | 2026-06-02 |`);
  const { root, stateDir } = makeStateDir(queue, groups);
  const result = buildGroupStatus({ stateDir, config: groupConfig });
  assert.equal(result.groups[0].boundary_reached, false);
  assert.equal(result.groups[0].next_action, 'continue_per_ticket_pipeline');
  assert.deepEqual(result.groups[0].open_members, [{ workId: 'IS-002', status: 'In Progress', found: true }]);
  rmSync(root, { recursive: true, force: true });
});

test('group unit disabled when config.e2e.unit is milestone (default)', () => {
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |`);
  const groups = GROUPS(`| EG-260602-190312 | IS-001 | Open | — | 2026-06-02 |`);
  const { root, stateDir } = makeStateDir(queue, groups);
  const result = buildGroupStatus({ stateDir, config: milestoneOnlyConfig });
  assert.equal(result.group_unit_enabled, false);
  assert.equal(result.groups[0].next_action, 'group_unit_disabled');
  rmSync(root, { recursive: true, force: true });
});

test('group unit disabled when no e2e block at all', () => {
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |`);
  const groups = GROUPS(`| EG-260602-190312 | IS-001 | Open | — | 2026-06-02 |`);
  const { root, stateDir } = makeStateDir(queue, groups);
  const result = buildGroupStatus({ stateDir, config: noE2eConfig });
  assert.equal(result.group_unit_enabled, false);
  assert.equal(result.groups[0].next_action, 'group_unit_disabled');
  rmSync(root, { recursive: true, force: true });
});

test('closed when group already Accepted', () => {
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |`);
  const groups = GROUPS(`| EG-260602-190312 | IS-001 | Accepted | e2e/e2e-EG-260602-190312.json | 2026-06-02 |`);
  const { root, stateDir } = makeStateDir(queue, groups);
  const result = buildGroupStatus({ stateDir, config: groupConfig });
  assert.equal(result.groups[0].boundary_reached, false);
  assert.equal(result.groups[0].next_action, 'closed');
  assert.equal(result.groups[0].receipt, 'e2e/e2e-EG-260602-190312.json');
  rmSync(root, { recursive: true, force: true });
});

test('member missing from queue is treated as not-done (MISSING)', () => {
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |`);
  const groups = GROUPS(`| EG-260602-190312 | IS-001, IS-999 | Open | — | 2026-06-02 |`);
  const { root, stateDir } = makeStateDir(queue, groups);
  const result = buildGroupStatus({ stateDir, config: groupConfig });
  assert.equal(result.groups[0].all_done, false);
  assert.deepEqual(result.groups[0].open_members, [{ workId: 'IS-999', status: null, found: false }]);
  rmSync(root, { recursive: true, force: true });
});

test('absent e2e-groups.md yields empty groups (no crash)', () => {
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |`);
  const { root, stateDir } = makeStateDir(queue, null);
  const result = buildGroupStatus({ stateDir, config: groupConfig });
  assert.deepEqual(result.groups, []);
  rmSync(root, { recursive: true, force: true });
});

test('unknown group is rejected instead of silently inventing one', () => {
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |`);
  const groups = GROUPS(`| EG-260602-190312 | IS-001 | Open | — | 2026-06-02 |`);
  const { root, stateDir } = makeStateDir(queue, groups);
  assert.throws(() => buildGroupStatus({ stateDir, config: groupConfig, group: 'EG-999999-999999' }), /未知 group/);
  rmSync(root, { recursive: true, force: true });
});

test('parseGroupRows splits comma/Chinese-comma work ids and reads dash receipt as null', () => {
  const rows = parseGroupRows(GROUPS(`| EG-260602-190312 | IS-001，IS-002, IS-003 | Open | — | 2026-06-02 |`));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].workIds, ['IS-001', 'IS-002', 'IS-003']);
  assert.equal(rows[0].receipt, null);
});

test('Superseded member does not block group boundary (treated as resolved)', () => {
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |
| IS-002 | B | Superseded | M0 | — | — | — | — |`);
  const groups = GROUPS(`| EG-260602-190312 | IS-001, IS-002 | Open | — | 2026-06-02 |`);
  const { root, stateDir } = makeStateDir(queue, groups);
  const result = buildGroupStatus({ stateDir, config: groupConfig });
  assert.equal(result.groups[0].all_done, true);
  assert.equal(result.groups[0].boundary_reached, true);
  assert.equal(result.groups[0].next_action, 'run_group_e2e');
  rmSync(root, { recursive: true, force: true });
});

test('Skipped group reports closed, not boundary', () => {
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |`);
  const groups = GROUPS(`| EG-260602-190312 | IS-001 | Skipped | skip:纯库无可观测面 | 2026-06-02 |`);
  const { root, stateDir } = makeStateDir(queue, groups);
  const result = buildGroupStatus({ stateDir, config: groupConfig });
  assert.equal(result.groups[0].boundary_reached, false);
  assert.equal(result.groups[0].next_action, 'closed');
  rmSync(root, { recursive: true, force: true });
});

test('unit=both enables group lane', () => {
  const bothConfig = cfg({ verifySkill: 'verify', e2eCommands: ['npm run test:e2e'], reportsDir: 'e2e', maxRerun: 2, unit: 'both' });
  const queue = QUEUE(`| IS-001 | A | Done | M0 | x | x | abc1234 | 2026-05-13 |`);
  const groups = GROUPS(`| EG-260602-190312 | IS-001 | Open | — | 2026-06-02 |`);
  const { root, stateDir } = makeStateDir(queue, groups);
  const result = buildGroupStatus({ stateDir, config: bothConfig });
  assert.equal(result.group_unit_enabled, true);
  assert.equal(result.groups[0].next_action, 'run_group_e2e');
  rmSync(root, { recursive: true, force: true });
});

test('group id with base36 suffix (collision-resolved) is accepted by parser', () => {
  const rows = parseGroupRows(GROUPS(`| EG-260602-190312-7a | IS-001 | Open | — | 2026-06-02 |`));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].group, 'EG-260602-190312-7a');
});
