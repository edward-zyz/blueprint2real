import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from './validate-config.mjs';

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
