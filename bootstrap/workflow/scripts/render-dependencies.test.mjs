import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDependencyModel, renderMermaid, renderTextReport } from './render-dependencies.mjs';
import { loadConfigSync } from './config.mjs';

const testConfig = loadConfigSync({ override: { workIdPrefix: 'IS', workIdDigits: 3 } });

const QUEUE = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-001 | 骨架 | Done | M0 | \`a\` | \`b\` | abc1234 | 2026-05-13 |
| IS-002 | Metadata | Done | M0 | \`a\` | \`b\` | def5678 | 2026-05-13 |
| IS-003 | Profile | Planned | M0 | — | — | — | — |
| IS-004 | HTTP | Planned | M0 | — | — | — | — |
| IS-005 | Identity | Planned | M0 | — | — | — | — |

## Planned 工单范围摘要

### IS-003 · Profile

目标：x。不做：y。验收：z。依赖：IS-002。

### IS-004 · HTTP

目标：x。不做：y。验收：z。依赖：IS-002。

### IS-005 · Identity

目标：x。不做：y。验收：z。依赖：IS-002 / IS-004。
`;

test('解析 5 个节点，3 条依赖关系正确', () => {
  const m = buildDependencyModel({ queueMd: QUEUE, config: testConfig });
  assert.equal(m.nodes.length, 5);
  const v3 = m.nodes.find((n) => n.id === 'IS-003');
  assert.deepEqual(v3.deps, ['IS-002']);
  const v5 = m.nodes.find((n) => n.id === 'IS-005');
  assert.deepEqual(v5.deps.sort(), ['IS-002', 'IS-004']);
});

test('timestamp ID 依赖解析不被全局扫描截成日期前缀', () => {
  const queue = `# Work Queue

| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IS-260602-143052-7f | A | Done | M0 | \`a\` | \`b\` | abc1234 | 2026-06-02 |
| IS-260700-090000-a3 | B | Done | M0 | \`a\` | \`b\` | def5678 | 2026-06-07 |
| IS-260700-091500-b4 | C | Planned | M0 | — | — | — | — |

## Planned 工单范围摘要

### IS-260700-091500-b4 · C

目标：x。不做：y。验收：z。依赖：IS-260602-143052-7f / IS-260700-090000-a3。
`;
  const m = buildDependencyModel({ queueMd: queue, config: testConfig });
  const c = m.nodes.find((n) => n.id === 'IS-260700-091500-b4');
  assert.deepEqual(c.deps.sort(), ['IS-260602-143052-7f', 'IS-260700-090000-a3']);
  assert.deepEqual(m.issues, []);
});

test('leaves 是 IS-001 和 IS-002（无依赖）', () => {
  const m = buildDependencyModel({ queueMd: QUEUE, config: testConfig });
  assert.deepEqual(m.leaves.sort(), ['IS-001', 'IS-002']);
});

test('IS-002 是 bottleneck（被 3 个工单依赖）', () => {
  const m = buildDependencyModel({ queueMd: QUEUE, config: testConfig });
  const top = m.bottleneck[0];
  assert.equal(top.id, 'IS-002');
  assert.equal(top.count, 3);
});

test('Mermaid 输出含节点声明 + 边 + class', () => {
  const m = buildDependencyModel({ queueMd: QUEUE, config: testConfig });
  const mer = renderMermaid(m);
  assert.match(mer, /^graph TD/);
  assert.match(mer, /IS-002\["IS-002<br\/>Metadata"\]:::st-done/);
  assert.match(mer, /IS-002 --> IS-003/);
  assert.match(mer, /IS-004 --> IS-005/);
  assert.match(mer, /classDef st-done/);
});

test('缺失依赖（声明 IS-999 但表中无）报 issue', () => {
  const broken = QUEUE + '\n### IS-006 · Bad\n\n依赖：IS-999。\n';
  const withRow = broken.replace(
    '| IS-005 | Identity | Planned | M0 | — | — | — | — |',
    '| IS-005 | Identity | Planned | M0 | — | — | — | — |\n| IS-006 | Bad | Planned | M0 | — | — | — | — |',
  );
  const m = buildDependencyModel({ queueMd: withRow, config: testConfig });
  assert.ok(m.issues.some((s) => /IS-006.*IS-999/.test(s)));
});

test('文本报告含 leaf / bottleneck / heaviest 三段', () => {
  const m = buildDependencyModel({ queueMd: QUEUE, config: testConfig });
  const txt = renderTextReport(m);
  assert.match(txt, /## Leaf/);
  assert.match(txt, /## Top 5 Bottleneck/);
  assert.match(txt, /## Top 5 Heaviest/);
  assert.match(txt, /IS-005 \(2\)/);
});

test('空 queue 也能 build 不崩溃', () => {
  const empty = '# Work Queue\n\n| Work ID | 名称 | Status | 里程碑 | Spec | Plan | Commit | 完成日期 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n';
  const m = buildDependencyModel({ queueMd: empty, config: testConfig });
  assert.equal(m.nodes.length, 0);
  assert.equal(m.leaves.length, 0);
});
