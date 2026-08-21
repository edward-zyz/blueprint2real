import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_ALIASES, mergeAliases, extractDoneIds, planInit, runUpgrade } from './init.mjs';
import { loadConfigSync } from './config.mjs';

test('REQUIRED_ALIASES 含 v5.4 新脚本(值=脚本文件名)', () => {
  assert.equal(REQUIRED_ALIASES['regression:diff'], 'regression-diff.mjs');
  assert.equal(REQUIRED_ALIASES['start'], 'start.mjs');
  assert.ok(REQUIRED_ALIASES['validate:state']);
});

test('mergeAliases: 只补缺失,不覆盖用户定制,返回 {scripts, added, migrated}', () => {
  const existing = { 'validate:state': 'CUSTOM', other: 'keep' };
  const { scripts, added, migrated } = mergeAliases(existing);
  assert.equal(scripts['validate:state'], 'CUSTOM'); // 不覆盖（无烘焙指纹 = 用户定制）
  assert.equal(scripts.other, 'keep');
  assert.match(scripts['regression:diff'], /regression-diff\.mjs/); // 补缺,指向 bundle
  assert.ok(added >= 1);
  assert.equal(migrated, 0);
});

// v5.6 O-P0-1: alias 不再烘焙 skillRoot 绝对路径,改为运行时读 <devRoot>/.b2r-home
test('mergeAliases: 新补的 alias 用 .b2r-home 运行时解析,不含烘焙绝对路径', () => {
  const { scripts } = mergeAliases({});
  for (const name of Object.keys(REQUIRED_ALIASES)) {
    assert.match(scripts[name], /\$\(cat \.b2r-home/, `${name} 应从 .b2r-home 解析`);
    assert.doesNotMatch(scripts[name], /B2R_HOME:-\//, `${name} 不应烘焙绝对路径`);
  }
});

test('mergeAliases: 迁移旧式烘焙 alias(${B2R_HOME:-/abs/path})为 .b2r-home 解析', () => {
  const existing = {
    'validate:state': 'DEV_ROOT="$PWD" node "${B2R_HOME:-/Users/other-machine/skill}/bootstrap/workflow/scripts/validate-state.mjs"',
    'init': 'node "${B2R_HOME:-/Users/other-machine/skill}/bootstrap/workflow/scripts/init.mjs"',
    'custom': 'echo hi', // 无指纹,不动
  };
  const { scripts, migrated } = mergeAliases(existing);
  assert.equal(migrated, 2);
  assert.doesNotMatch(scripts['validate:state'], /other-machine/);
  assert.match(scripts['validate:state'], /\$\(cat \.b2r-home/);
  assert.doesNotMatch(scripts['init'], /other-machine/);
  assert.equal(scripts.custom, 'echo hi');
});

const FAKE_CONFIG = {
  workIdPrefix: 'IS', workIdDigits: 3, milestones: ['M0'],
  projectName: 'demo', boardTitle: 'demo · BOARD', docsRefs: [], regressionCommands: [],
};

test('planInit(bootstrap): 生成 .b2r-home(内容=skillRoot),package.json 无烘焙路径', () => {
  const items = planInit({ config: FAKE_CONFIG, targetDir: '/tmp/x', bootstrap: true });
  const home = items.find((it) => it.out.endsWith('.b2r-home'));
  assert.ok(home, '应生成 .b2r-home');
  assert.match(home.content.trim(), /bootstrap$|blueprint2real|\//); // 是一个路径
  const pkg = items.find((it) => it.out.endsWith('package.json'));
  assert.ok(pkg);
  assert.doesNotMatch(pkg.content, /\{\{skillRoot\}\}/, '占位应被处理');
  assert.doesNotMatch(pkg.content, /B2R_HOME:-\//, 'package.json 不应烘焙绝对路径');
  assert.match(pkg.content, /\$\(cat \.b2r-home/);
});

// 迭代2缺口①:--bootstrap 也要写 .b2r-version(此前只有 --upgrade 写,
// 导致新项目一 bootstrap 完就触发底盘契约自检的版本缺失分支、被迫补跑 upgrade)
test('planInit(bootstrap): 生成 .b2r-version(内容=bundle VERSION)', () => {
  const items = planInit({ config: FAKE_CONFIG, targetDir: '/tmp/x', bootstrap: true });
  const ver = items.find((it) => it.out.endsWith('.b2r-version'));
  assert.ok(ver, '应生成 .b2r-version');
  assert.match(ver.content.trim(), /^\d+\.\d+\.\d+$/);
});

// 迭代2缺口②:生成产物不得再硬编码 legacy `cd dev`(v5.1 起默认 devRoot=b2r-process,
// 且 target 名可自定义;模板用 {{devRootName}} 按实际 target 派生)
test('planInit: 生成的所有文件不含 legacy "cd dev &&",引用实际 target 目录名', () => {
  const items = planInit({ config: FAKE_CONFIG, targetDir: '/tmp/my-proc', bootstrap: true });
  for (const it of items) {
    assert.doesNotMatch(it.content, /cd dev &&/, `${it.out} 不应含 legacy cd dev`);
  }
  const queue = items.find((it) => it.out.endsWith('queue.md'));
  assert.match(queue.content, /cd my-proc &&/, 'queue.md 校验提示应引用实际 devRoot 目录名');
  const cfg = items.find((it) => it.out.endsWith('workflow.config.mjs'));
  assert.doesNotMatch(cfg.content, /cd dev\b/, 'config 的 regressionCommands 不应含 legacy dev');
});

test('extractDoneIds: 只取 Done 行的工单号', () => {
  const queue = [
    '| IS-001 | 标题 A | Done | M0 |',
    '| IS-002 | 标题 B | In Progress | M0 |',
    '| IS-003 | 标题 C | Done | M1 |',
  ].join('\n');
  assert.deepEqual(extractDoneIds(queue), ['IS-001', 'IS-003']);
});

// pre-promote guard:模板显式生成缺省值,upgrade 不得覆盖项目已配置的门禁
test('init 配置模板显式生成 prePromoteCommands: []', () => {
  const config = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3 } });
  const item = planInit({ config, targetDir: '/tmp/x', bootstrap: true })
    .find((it) => it.out.endsWith('workflow.config.mjs'));
  assert.ok(item);
  assert.match(item.content, /prePromoteCommands:\s*\[\]/);
});

test('upgrade 保留项目已有 prePromoteCommands 配置原文', () => {
  const root = mkdtempSync(join(tmpdir(), 'b2r-upgrade-guard-'));
  mkdirSync(join(root, 'state'));
  const configPath = join(root, 'workflow.config.mjs');
  const original = "export default { prePromoteCommands: ['npm run gate'] };\n";
  writeFileSync(configPath, original);
  writeFileSync(join(root, 'package.json'), '{"scripts":{}}\n');
  writeFileSync(join(root, 'state', 'queue.md'), '# Work Queue\n');
  runUpgrade({ targetDir: root });
  assert.equal(readFileSync(configPath, 'utf8'), original);
  rmSync(root, { recursive: true, force: true });
});
