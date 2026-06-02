import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from './validate-config.mjs';
import { loadConfigSync, makeWorkIdLoosePattern, mintWorkId } from './config.mjs';

function makeFixture(configContent) {
  const root = mkdtempSync(join(tmpdir(), 'vc-test-'));
  writeFileSync(join(root, 'workflow.config.mjs'), configContent);
  return root;
}

const VALID = `export default {
  workIdPrefix: 'IS',
  workIdDigits: 3,
  milestones: ['M0', 'M1', 'M2'],
  projectName: 'test',
  boardTitle: 'TEST · BOARD',
  docsRefs: ['../CLAUDE.md'],
  regressionCommands: ['npm test'],
  pipeline: { maxRetry: 1, retroSurfaceThreshold: 3, receiptsDir: 'receipts', specsDir: 'specs' }
};`;

test('a. happy path: 合法 config → ok: true', async () => {
  const root = makeFixture(VALID);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  rmSync(root, { recursive: true, force: true });
});

test('b. workIdPrefix 小写 → errors 含 workIdPrefix', async () => {
  const bad = VALID.replace("workIdPrefix: 'IS'", "workIdPrefix: 'is'");
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /workIdPrefix/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('c. workIdDigits 越界 (10) → errors 含 workIdDigits', async () => {
  const bad = VALID.replace('workIdDigits: 3', 'workIdDigits: 10');
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /workIdDigits/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('d. milestones 含空字符串 → errors 含 milestone', async () => {
  const bad = VALID.replace("['M0', 'M1', 'M2']", "['M0', '', 'M2']");
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /milestone/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('e. pipeline.maxRetry 越界 (10) → errors 含 pipeline.maxRetry', async () => {
  const bad = VALID.replace('maxRetry: 1', 'maxRetry: 10');
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /maxRetry/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('f. ui block 合法 → ok: true', async () => {
  const withUi = VALID.replace(
    '};',
    ",\n  ui: { designSkill: 'ui-ux-pro-max', designRefs: ['../docs/design-system/'], uiPaths: ['web/src/views/**'], anchorPath: 'state/ui-anchor.md' }\n};",
  );
  const root = makeFixture(withUi);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, true);
  assert.deepEqual(r.config.ui.designRefs, ['../docs/design-system/']);
  rmSync(root, { recursive: true, force: true });
});

test('g. ui.designRefs 缺省 → ok: true（自动发现 / 合成设计系统）', async () => {
  const withUi = VALID.replace(
    '};',
    ",\n  ui: { designSkill: 'ui-ux-pro-max', uiPaths: ['web/src/views/**'], anchorPath: 'state/ui-anchor.md' }\n};",
  );
  const root = makeFixture(withUi);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, true);
  assert.deepEqual(r.config.ui.designRefs, []);
  rmSync(root, { recursive: true, force: true });
});

test('h. ui.designRefs 空数组 → ok: true（自动发现 / 合成设计系统）', async () => {
  const withUi = VALID.replace(
    '};',
    ",\n  ui: { designSkill: 'ui-ux-pro-max', designRefs: [], uiPaths: ['web/src/views/**'], anchorPath: 'state/ui-anchor.md' }\n};",
  );
  const root = makeFixture(withUi);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, true);
  rmSync(root, { recursive: true, force: true });
});

test('i. ui.designSkill 为空 → errors 含 ui.designSkill', async () => {
  const bad = VALID.replace(
    '};',
    ",\n  ui: { designSkill: '', designRefs: ['../docs/design-system/'], uiPaths: ['web/src/views/**'], anchorPath: 'state/ui-anchor.md' }\n};",
  );
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /ui\.designSkill/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('j. ui.anchorPath 越界 → errors 含 ui.anchorPath', async () => {
  const bad = VALID.replace(
    '};',
    ",\n  ui: { designSkill: 'ui-ux-pro-max', designRefs: ['../docs/design-system/'], uiPaths: ['web/src/views/**'], anchorPath: '../ui-anchor.md' }\n};",
  );
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /ui\.anchorPath/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('k. e2e block 合法 → ok: true', async () => {
  const withE2e = VALID.replace(
    '};',
    ",\n  e2e: { verifySkill: 'verify', launch: '', e2eCommands: ['npm run test:e2e'], reportsDir: 'e2e', maxRerun: 2 }\n};",
  );
  const root = makeFixture(withE2e);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.config.e2e.verifySkill, 'verify');
  assert.equal(r.config.e2e.reportsDir, 'e2e');
  rmSync(root, { recursive: true, force: true });
});

test('l. e2e.verifySkill 为空 → errors 含 e2e.verifySkill', async () => {
  const bad = VALID.replace(
    '};',
    ",\n  e2e: { verifySkill: '', launch: '', e2eCommands: ['npm run test:e2e'], reportsDir: 'e2e', maxRerun: 2 }\n};",
  );
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /e2e\.verifySkill/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('m. e2e.e2eCommands 非数组 → errors 含 e2e.e2eCommands', async () => {
  const bad = VALID.replace(
    '};',
    ",\n  e2e: { verifySkill: 'verify', launch: '', e2eCommands: 'npm run test:e2e', reportsDir: 'e2e', maxRerun: 2 }\n};",
  );
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /e2e\.e2eCommands/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('n. e2e.reportsDir 越界 → errors 含 e2e.reportsDir', async () => {
  const bad = VALID.replace(
    '};',
    ",\n  e2e: { verifySkill: 'verify', launch: '', e2eCommands: ['npm run test:e2e'], reportsDir: '../e2e', maxRerun: 2 }\n};",
  );
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /e2e\.reportsDir/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('o. e2e.maxRerun 负数 → errors 含 e2e.maxRerun', async () => {
  const bad = VALID.replace(
    '};',
    ",\n  e2e: { verifySkill: 'verify', launch: '', e2eCommands: ['npm run test:e2e'], reportsDir: 'e2e', maxRerun: -1 }\n};",
  );
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /e2e\.maxRerun/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('p. idScheme 缺省为 sequential，timestamp 合法', async () => {
  const root = makeFixture(VALID.replace('workIdDigits: 3,', "workIdDigits: 3,\n  idScheme: 'timestamp',"));
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.config.idScheme, 'timestamp');
  rmSync(root, { recursive: true, force: true });

  const cfg = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3 } });
  assert.equal(cfg.idScheme, 'sequential');
});

test('q. idScheme 非法 → errors 含 idScheme', async () => {
  const bad = VALID.replace('workIdDigits: 3,', "workIdDigits: 3,\n  idScheme: 'uuid',");
  const root = makeFixture(bad);
  const r = await validateConfig({ devRoot: root });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /idScheme/.test(e.field || e.msg)));
  rmSync(root, { recursive: true, force: true });
});

test('r. mintWorkId sequential 忽略 timestamp 形态 existingIds', () => {
  const cfg = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3 } });
  const id = mintWorkId(cfg, ['IS-001', 'IS-260602-143052-7f', 'IS-010']);
  assert.equal(id, 'IS-011');
});

test('s. mintWorkId timestamp 生成秒级本地时间 + 2 位 base36 尾缀，并本地去重', () => {
  const cfg = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3, idScheme: 'timestamp' } });
  const now = new Date(2026, 5, 2, 14, 30, 52);
  const firstSeq = [7, 15];
  const first = mintWorkId(cfg, [], now, () => firstSeq.shift() / 36);
  assert.equal(first, 'IS-260602-143052-7f');

  const retrySeq = [7, 15, 7, 16];
  const second = mintWorkId(cfg, [first], now, () => retrySeq.shift() / 36);
  assert.equal(second, 'IS-260602-143052-7g');
});

test('t. workId loose pattern 全局扫描不截断 timestamp ID', () => {
  const cfg = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3 } });
  const re = new RegExp(makeWorkIdLoosePattern(cfg), 'g');
  const text = '依赖：IS-260602-143052-7f / IS-260700-090000-a3 / IS-001。';
  assert.deepEqual(text.match(re), ['IS-260602-143052-7f', 'IS-260700-090000-a3', 'IS-001']);
});

import { mintGroupId } from './config.mjs';
test('u. mintGroupId 同秒碰撞时追加 base36 尾缀去重', () => {
  const now = new Date(2026, 5, 2, 19, 3, 12);
  const a = mintGroupId(now, []);
  assert.equal(a, 'EG-260602-190312');
  const b = mintGroupId(now, [a], () => 0.5);
  assert.notEqual(b, a);
  assert.match(b, /^EG-260602-190312-[0-9a-z]{2}$/);
});
