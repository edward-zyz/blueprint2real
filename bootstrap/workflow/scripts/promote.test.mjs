import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promote } from './promote.mjs';
import { loadConfigSync } from './config.mjs';

const testConfig = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3, projectName: 'insight' } });

const ACTIVE_IDLE = `# Active Work Item

- ID: —
- Name: —
- Status: Idle
- Started: —
- Spec: —
- Plan: —
- Last commit: 182c25a
- Next checkpoint: —
- Blockers: —
`;

const QUEUE_BASE = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | 骨架 | Done | M0 | \`../work/IS-001/spec.md\` | \`../work/IS-001/plan.md\` | 33163ba | 2026-05-13 |
| IS-002 | Metadata Store | Done | M0 | \`../work/IS-002/spec.md\` | \`../work/IS-002/plan.md\` | 182c25a | 2026-05-13 |
| IS-003 | Instance Profile 加载 | Planned | M0 | — | — | — | — |
| IS-004 | Control Plane HTTP | Planned | M0 | — | — | — | — |

## Planned 工单范围摘要

### IS-003 · Instance Profile 加载

目标：定义 yaml 格式。不做：多 Customer。验收：改 yaml 即生效。依赖：IS-002。

### IS-004 · Control Plane HTTP

目标：起 Express。不做：业务路由。验收：审计落表。依赖：IS-002。
`;

const ROADMAP_OK = `# Roadmap

## M0 · 可被部署
- **状态**：Planned

## M1 · 业务工程师
- **状态**：Planned

## M2 · 复制交付
- **状态**：Planned
`;

const CV_OK = `# Customer-Visible Changelog

## 2026-05-13 · IS-002 Done

- 客户可感知变化：无
- Internal-only 变化：SQLite 就位

## 2026-05-13 · IS-001 Done

- 客户可感知变化：无
- Internal-only 变化：骨架
`;

function setupFixture(queueOverride) {
  const root = mkdtempSync(join(tmpdir(), 'promote-test-'));
  const stateDir = join(root, 'state');
  const workDir = join(root, 'work');
  mkdirSync(stateDir);
  mkdirSync(workDir);
  writeFileSync(join(stateDir, 'active.md'), ACTIVE_IDLE);
  writeFileSync(join(stateDir, 'queue.md'), queueOverride ?? QUEUE_BASE);
  writeFileSync(join(stateDir, 'roadmap.md'), ROADMAP_OK);
  writeFileSync(join(stateDir, 'customer-visible.md'), CV_OK);
  return { root, stateDir, workDir };
}

test('成功 promote IS-003：spec/plan 落地 + queue 翻 Ready + 摘要段删除 + validate 通过', async () => {
  const { root, stateDir, workDir } = setupFixture();
  const r = await promote({ stateDir, workDir, workId: 'IS-003', config: testConfig });
  assert.equal(r.ok, true);
  assert.equal(r.validation.ok, true);

  // v5.2: spec 上移到 specs/<slug>.md；plan/context 留在 work/<slug>/
  const slugDir = 'IS-003_Instance-Profile-加载';
  const specPath = join(root, 'specs', `${slugDir}.md`);
  const planPath = join(workDir, slugDir, 'plan.md');
  assert.ok(existsSync(specPath), `spec 应在 ${specPath}`);
  assert.ok(existsSync(planPath), `plan 应在 ${planPath}`);

  const queue = readFileSync(join(stateDir, 'queue.md'), 'utf8');
  // 表格行翻 Ready + 填新结构路径
  assert.match(queue, /\|\s*IS-003\s*\|[^\n]*\|\s*Ready\s*\|[^\n]*`\.\.\/specs\/IS-003_Instance-Profile-加载\.md`\s*\|[^\n]*`\.\.\/work\/IS-003_Instance-Profile-加载\/plan\.md`/);
  // 摘要段已删
  assert.doesNotMatch(queue, /^### IS-003 ·/m);
  // 其他摘要保留
  assert.match(queue, /^### IS-004 ·/m);

  // spec 含摘要原文 quote
  const spec = readFileSync(specPath, 'utf8');
  assert.match(spec, /目标：定义 yaml 格式/);
  assert.match(spec, /IS-002.*Done/);

  rmSync(root, { recursive: true, force: true });
});

test('不存在的 workId 报错', async () => {
  const { root, stateDir, workDir } = setupFixture();
  await assert.rejects(() => promote({ stateDir, workDir, workId: 'IS-999', config: testConfig }), /不在 queue\.md 表中/);
  rmSync(root, { recursive: true, force: true });
});

test('当前已是 Ready 状态 → 报错', async () => {
  const queue = QUEUE_BASE.replace('| IS-003 | Instance Profile 加载 | Planned', '| IS-003 | Instance Profile 加载 | Ready');
  const { root, stateDir, workDir } = setupFixture(queue);
  await assert.rejects(() => promote({ stateDir, workDir, workId: 'IS-003', config: testConfig }), /必须为 Planned 才能 promote/);
  rmSync(root, { recursive: true, force: true });
});

test('前置依赖未 Done → 报错', async () => {
  const queue = QUEUE_BASE.replace(
    '| IS-002 | Metadata Store | Done | M0 | `../work/IS-002/spec.md` | `../work/IS-002/plan.md` | 182c25a | 2026-05-13 |',
    '| IS-002 | Metadata Store | Planned | M0 | — | — | — | — |',
  ) + '\n### IS-002 · Metadata Store\n\n目标：SQLite。不做：MySQL。验收：建表通过。依赖：IS-001。\n';
  const { root, stateDir, workDir } = setupFixture(queue);
  await assert.rejects(() => promote({ stateDir, workDir, workId: 'IS-003', config: testConfig }), /前置依赖未 Done：IS-002/);
  rmSync(root, { recursive: true, force: true });
});

test('--force 跳过依赖检查', async () => {
  const queue = QUEUE_BASE.replace(
    '| IS-002 | Metadata Store | Done | M0 | `../work/IS-002/spec.md` | `../work/IS-002/plan.md` | 182c25a | 2026-05-13 |',
    '| IS-002 | Metadata Store | Planned | M0 | — | — | — | — |',
  ) + '\n### IS-002 · Metadata Store\n\n目标：SQLite。不做：MySQL。验收：建表通过。依赖：IS-001。\n';
  const { root, stateDir, workDir } = setupFixture(queue);
  // IS-002 在本测试里是 Planned，customer-visible 里不能含 IS-002 Done 段
  writeFileSync(join(stateDir, 'customer-visible.md'),
    `# Customer-Visible Changelog\n\n## 2026-05-13 · IS-001 Done\n\n- 客户可感知变化：无\n- Internal-only 变化：骨架\n`);
  const r = await promote({ stateDir, workDir, workId: 'IS-003', force: true, config: testConfig });
  assert.equal(r.ok, true);
  rmSync(root, { recursive: true, force: true });
});

test('spec.md 已存在 → 拒绝覆盖', async () => {
  const { root, stateDir, workDir } = setupFixture();
  // v5.2: spec 在 specs/<slug>.md
  mkdirSync(join(root, 'specs'), { recursive: true });
  writeFileSync(join(root, 'specs', 'IS-003_Instance-Profile-加载.md'), 'existing');
  await assert.rejects(() => promote({ stateDir, workDir, workId: 'IS-003', config: testConfig }), /已存在，promote 拒绝覆盖/);
  rmSync(root, { recursive: true, force: true });
});

test('§Planned 摘要缺对应段 → 报错（即便表里是 Planned）', async () => {
  const queue = QUEUE_BASE.replace(/### IS-003 · Instance Profile 加载[\s\S]*?(?=### IS-004|$)/, '');
  const { root, stateDir, workDir } = setupFixture(queue);
  await assert.rejects(() => promote({ stateDir, workDir, workId: 'IS-003', config: testConfig }), /§Planned 工单范围摘要 中缺/);
  rmSync(root, { recursive: true, force: true });
});

test('--dry-run 不写盘', async () => {
  const { root, stateDir, workDir } = setupFixture();
  const before = readFileSync(join(stateDir, 'queue.md'), 'utf8');
  const r = await promote({ stateDir, workDir, workId: 'IS-003', dryRun: true, config: testConfig });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  const after = readFileSync(join(stateDir, 'queue.md'), 'utf8');
  assert.equal(before, after, 'queue.md 不应被修改');
  assert.ok(!existsSync(join(root, 'specs', 'IS-003_Instance-Profile-加载.md')), 'spec 不应被创建');
  assert.ok(!existsSync(join(workDir, 'IS-003_Instance-Profile-加载', 'plan.md')), 'plan 不应被创建');
  rmSync(root, { recursive: true, force: true });
});

test('promote 后 validate-state 兜底通过', async () => {
  const { root, stateDir, workDir } = setupFixture();
  const r = await promote({ stateDir, workDir, workId: 'IS-003', config: testConfig });
  assert.equal(r.validation.ok, true, `应通过，实际 issues:\n${r.validation.issues.map((i) => `  ${i.severity} ${i.file}: ${i.msg}`).join('\n')}`);
  rmSync(root, { recursive: true, force: true });
});

test('promote 生成 context-pack.md 含依赖工单的 customer-visible 段', async () => {
  const { root, stateDir, workDir } = setupFixture();
  await promote({ stateDir, workDir, workId: 'IS-003', config: testConfig });
  const cpPath = join(workDir, 'IS-003_Instance-Profile-加载', 'context-pack.md');
  assert.ok(existsSync(cpPath), 'context-pack.md 应被生成');
  const cp = readFileSync(cpPath, 'utf8');
  assert.match(cp, /# IS-003 Context Pack/);
  assert.match(cp, /## 1\. 工单基础/);
  assert.match(cp, /## 2\. 前置工单已交付的能力/);
  // IS-002 是依赖，customer-visible 中有 Done 段，应被注入
  assert.match(cp, /### 2026-05-13 · IS-002 Done/);
  assert.match(cp, /SQLite 就位/);
  // RUNBOOK 必读章节列表
  assert.match(cp, /§4 Agent 启动检查表/);
  assert.match(cp, /§6 架构红线/);
  // 启动 checklist
  assert.match(cp, /\[ \] 已读本文/);
  rmSync(root, { recursive: true, force: true });
});

test('依赖工单不在 customer-visible 中（如刚 promote 的 Ready），context-pack 给明确提示', async () => {
  // IS-004 依赖 IS-002（Done，有 cv 段）；假设 IS-002 cv 段被删除
  const { root, stateDir, workDir } = setupFixture();
  writeFileSync(join(stateDir, 'customer-visible.md'),
    `# Customer-Visible Changelog\n\n## 2026-05-13 · IS-001 Done\n\n- 客户可感知变化：无\n- Internal-only 变化：骨架\n`);
  // 同时把 IS-002 改成 Ready 状态以便 force promote IS-004（其依赖未 Done）
  const queue = QUEUE_BASE.replace(
    '| IS-002 | Metadata Store | Done | M0 | `../work/IS-002/spec.md` | `../work/IS-002/plan.md` | 182c25a | 2026-05-13 |',
    '| IS-002 | Metadata Store | Ready | M0 | `../work/IS-002/spec.md` | `../work/IS-002/plan.md` | — | — |',
  );
  writeFileSync(join(stateDir, 'queue.md'), queue);
  await promote({ stateDir, workDir, workId: 'IS-004', force: true, config: testConfig });
  const cp = readFileSync(join(workDir, 'IS-004_Control-Plane-HTTP', 'context-pack.md'), 'utf8');
  assert.match(cp, /IS-002.*customer-visible.md 中查无此 Done 段/s);
  rmSync(root, { recursive: true, force: true });
});

test('promote IS-004 不影响 IS-003 的摘要段', async () => {
  const { root, stateDir, workDir } = setupFixture();
  await promote({ stateDir, workDir, workId: 'IS-004', config: testConfig });
  const queue = readFileSync(join(stateDir, 'queue.md'), 'utf8');
  assert.match(queue, /^### IS-003 ·/m, 'IS-003 摘要应保留');
  assert.doesNotMatch(queue, /^### IS-004 ·/m, 'IS-004 摘要应删除');
  rmSync(root, { recursive: true, force: true });
});

test('promote 自动重 render BOARD.html（防 IS-011/IS-012 类 stale 复发）', async () => {
  const { root, stateDir, workDir } = setupFixture();
  const boardPath = join(root, 'BOARD.html');
  // 故意写一个旧 BOARD（pre-promote 内容）
  writeFileSync(boardPath, '<html>OLD BOARD - IS-003 not yet promoted</html>');
  const r = await promote({ stateDir, workDir, workId: 'IS-003', boardPath, config: testConfig });
  assert.equal(r.ok, true);
  assert.ok(r.board, 'promote 返回值应含 board 字段（render 成功）');
  assert.equal(r.board.outPath, boardPath);
  const board = readFileSync(boardPath, 'utf8');
  // 新 BOARD 应是真 HTML 模板（含 KPI/BOARD 等标识），不再是旧字符串
  assert.match(board, /INSIGHT · BOARD/);
  assert.match(board, /ACTIVE WORK ITEM/);
  // queue.md IS-003 已 Ready，所以 READY QUEUE 应 = 1
  assert.match(board, /kpi-label">READY QUEUE<\/div>\s*<div class="kpi-value">1<\/div>/);
  rmSync(root, { recursive: true, force: true });
});

test('promote --dry-run 时不真的 render BOARD（只在 willWrite 中列出）', async () => {
  const { root, stateDir, workDir } = setupFixture();
  const boardPath = join(root, 'BOARD.html');
  writeFileSync(boardPath, '<html>OLD</html>');
  const r = await promote({ stateDir, workDir, workId: 'IS-003', dryRun: true, boardPath, config: testConfig });
  assert.equal(r.dryRun, true);
  // dry-run 时 BOARD 应未被改写
  assert.equal(readFileSync(boardPath, 'utf8'), '<html>OLD</html>');
  // 但 willWrite 列表应含 BOARD.html 提示
  assert.ok(r.summary.willWrite.some((w) => w.path === boardPath && w.action === 'rerender'));
  rmSync(root, { recursive: true, force: true });
});

test('依赖解析含多个 IS-NNN（"IS-001 / IS-002"）', async () => {
  const queue = QUEUE_BASE.replace(
    '目标：起 Express。不做：业务路由。验收：审计落表。依赖：IS-002。',
    '目标：起 Express。不做：业务路由。验收：审计落表。依赖：IS-001 / IS-002。',
  );
  const { root, stateDir, workDir } = setupFixture(queue);
  const r = await promote({ stateDir, workDir, workId: 'IS-004', config: testConfig });
  assert.deepEqual(r.summary.depsResolved.sort(), ['IS-001', 'IS-002']);
  rmSync(root, { recursive: true, force: true });
});

test('timestamp ID 依赖解析不被截断，promote 依赖门通过', async () => {
  const queue = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | legacy | Done | M0 | \`../work/IS-001/spec.md\` | \`../work/IS-001/plan.md\` | 33163ba | 2026-05-13 |
| IS-260602-143052-7f | A | Done | M0 | \`../work/IS-260602-143052-7f/spec.md\` | \`../work/IS-260602-143052-7f/plan.md\` | 182c25a | 2026-06-02 |
| IS-260700-090000-a3 | B | Done | M0 | \`../work/IS-260700-090000-a3/spec.md\` | \`../work/IS-260700-090000-a3/plan.md\` | 282c25b | 2026-06-07 |
| IS-260700-091500-b4 | C | Planned | M0 | — | — | — | — |

## Planned 工单范围摘要

### IS-260700-091500-b4 · C

目标：x。不做：y。验收：z。依赖：IS-260602-143052-7f / IS-260700-090000-a3。
`;
  const { root, stateDir, workDir } = setupFixture(queue);
  writeFileSync(join(stateDir, 'customer-visible.md'), `# Customer-Visible Changelog

## 2026-06-07 · IS-260700-090000-a3 Done

- 客户可感知变化：B
- Internal-only 变化：B

## 2026-06-02 · IS-260602-143052-7f Done

- 客户可感知变化：A
- Internal-only 变化：A

## 2026-05-13 · IS-001 Done

- 客户可感知变化：legacy
- Internal-only 变化：legacy
`);
  const r = await promote({ stateDir, workDir, workId: 'IS-260700-091500-b4', config: testConfig });
  assert.deepEqual(r.summary.depsResolved.sort(), ['IS-260602-143052-7f', 'IS-260700-090000-a3']);
  assert.equal(r.validation.ok, true);
  rmSync(root, { recursive: true, force: true });
});
