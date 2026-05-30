import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateState } from './validate-state.mjs';
import { loadConfigSync } from './config.mjs';

const testConfig = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3 } });

function makeStateDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'validate-state-test-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const ACTIVE_IDLE = `# Active Work Item

- ID: —
- Name: —
- Status: Idle（无 active work item）
- Started: —
- Spec: —
- Plan: —
- Last commit: 182c25a
- Next checkpoint: —
- Blockers: —
`;

const ACTIVE_IN_PROGRESS = `# Active Work Item

- ID: IS-003
- Name: Instance Profile 加载
- Status: In Progress
- Started: 2026-05-13
- Spec: ../work/IS-003/spec.md
- Plan: ../work/IS-003/plan.md
- Last commit: 33163ba
- Next checkpoint: —
- Blockers: —
`;

const QUEUE_OK = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | 骨架 | Done | M0 | \`../work/IS-001/spec.md\` | \`../work/IS-001/plan.md\` | 33163ba | 2026-05-13 |
| IS-002 | Metadata Store | Done | M0 | \`../work/IS-002/spec.md\` | \`../work/IS-002/plan.md\` | 182c25a | 2026-05-13 |
| IS-003 | Instance Profile | Planned | M0 | — | — | — | — |

## Planned 工单范围摘要

### IS-003 · Instance Profile 加载

目标：定义 instance.yaml 格式。
`;

const ROADMAP_OK = `# Roadmap

## M0 · 可被部署
- **状态**：Planned

## M1 · 业务工程师工作环境就绪
- **状态**：Planned

## M2 · 可被复制交付
- **状态**：Planned
`;

const CV_OK = `# Customer-Visible Changelog

## 2026-05-13 · IS-002 Done

- 客户可感知变化：无
- Internal-only 变化：SQLite 元数据存储就位

## 2026-05-13 · IS-001 Done

- 客户可感知变化：无
- Internal-only 变化：v2 骨架仓库
`;

test('全合法的 Idle 状态通过', () => {
  const dir = makeStateDir({
    'active.md': ACTIVE_IDLE,
    'queue.md': QUEUE_OK,
    'roadmap.md': ROADMAP_OK,
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, true, `应当通过，实际 issues:\n${issues.map((i) => `  ${i.severity} ${i.file}: ${i.msg}`).join('\n')}`);
  rmSync(dir, { recursive: true, force: true });
});

test('active.md 缺字段报 error', () => {
  const dir = makeStateDir({
    'active.md': '# Active Work Item\n\n- ID: IS-003\n',
    'queue.md': QUEUE_OK,
    'roadmap.md': ROADMAP_OK,
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /缺少 `- Status:`/.test(i.msg)));
  assert.ok(issues.some((i) => /缺少 `- Name:`/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});

test('active.md Status 非法值报 error', () => {
  const dir = makeStateDir({
    'active.md': ACTIVE_IDLE.replace('Status: Idle', 'Status: WIP'),
    'queue.md': QUEUE_OK,
    'roadmap.md': ROADMAP_OK,
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /Status "WIP" 不在合法集/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});

test('queue.md Done 状态缺 commit hash 报 error', () => {
  const broken = QUEUE_OK.replace('| 33163ba ', '| oops ');
  const dir = makeStateDir({
    'active.md': ACTIVE_IDLE,
    'queue.md': broken,
    'roadmap.md': ROADMAP_OK,
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /IS-001: Done 状态 Commit "oops"/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});

test('queue.md Work ID 重复报 error', () => {
  const dup = QUEUE_OK.replace(
    '| IS-002 | Metadata Store | Done',
    '| IS-001 | 重复项 | Done',
  );
  const dir = makeStateDir({
    'active.md': ACTIVE_IDLE,
    'queue.md': dup,
    'roadmap.md': ROADMAP_OK,
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /Work ID IS-001 重复/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});

test('Planned 表里有但摘要段缺报 error', () => {
  const queue = QUEUE_OK.replace(/## Planned 工单范围摘要[\s\S]*$/, '');
  const dir = makeStateDir({
    'active.md': ACTIVE_IDLE,
    'queue.md': queue,
    'roadmap.md': ROADMAP_OK,
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /IS-003: 表里是 Planned 但.*缺.*小节/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});

test('已 promote 但摘要段残留报 error（防双源）', () => {
  const queue = QUEUE_OK.replace(
    '| IS-003 | Instance Profile | Planned',
    '| IS-003 | Instance Profile | Ready',
  );
  const dir = makeStateDir({
    'active.md': ACTIVE_IDLE,
    'queue.md': queue,
    'roadmap.md': ROADMAP_OK,
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /IS-003: 已 promote.*但.*仍残留/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});

test('cross-file: Idle 但 queue 有 In Progress 报脱钩 error', () => {
  const queue = QUEUE_OK.replace(
    '| IS-003 | Instance Profile | Planned',
    '| IS-003 | Instance Profile | In Progress',
  ).replace(/## Planned 工单范围摘要[\s\S]*$/, '');
  const dir = makeStateDir({
    'active.md': ACTIVE_IDLE,
    'queue.md': queue,
    'roadmap.md': ROADMAP_OK,
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /Idle 但 queue.md IS-003 仍 In Progress/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});

test('cross-file: active 持有的 ID 在 queue 中状态非 In Progress 报 error', () => {
  const queue = QUEUE_OK.replace(
    '| IS-003 | Instance Profile | Planned',
    '| IS-003 | Instance Profile | Ready',
  ).replace(/## Planned 工单范围摘要[\s\S]*$/, '');
  const dir = makeStateDir({
    'active.md': ACTIVE_IN_PROGRESS,
    'queue.md': queue,
    'roadmap.md': ROADMAP_OK,
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /active.md 持有 IS-003 但 queue.md 中其 Status="Ready"/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});

test('cross-file: customer-visible 引用 queue 中不存在的 ID 报 error', () => {
  const cv = CV_OK + '\n## 2026-05-13 · IS-099 Done\n\n- 客户可感知变化：x\n- Internal-only 变化：y\n';
  const dir = makeStateDir({
    'active.md': ACTIVE_IDLE,
    'queue.md': QUEUE_OK,
    'roadmap.md': ROADMAP_OK,
    'customer-visible.md': cv,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /IS-099 Done 段，但 queue.md 中查无此条/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});

test('roadmap.md 缺 M0/M1/M2 报 error', () => {
  const dir = makeStateDir({
    'active.md': ACTIVE_IDLE,
    'queue.md': QUEUE_OK,
    'roadmap.md': '# Roadmap\n\n## M0 · only\n- **状态**：Planned\n',
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /缺少里程碑二级标题 "## M1/.test(i.msg)));
  assert.ok(issues.some((i) => /缺少里程碑二级标题 "## M2/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});

test('roadmap.md 里程碑状态非法值报 error', () => {
  const broken = ROADMAP_OK.replace('## M0 · 可被部署\n- **状态**：Planned', '## M0 · 可被部署\n- **状态**：WIP');
  const dir = makeStateDir({
    'active.md': ACTIVE_IDLE,
    'queue.md': QUEUE_OK,
    'roadmap.md': broken,
    'customer-visible.md': CV_OK,
  });
  const { ok, issues } = validateState({ stateDir: dir, config: testConfig });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => /M0: 状态 "WIP" 不在合法集/.test(i.msg)));
  rmSync(dir, { recursive: true, force: true });
});
