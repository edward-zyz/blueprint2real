#!/usr/bin/env node
// 从 b2r-process/state/queue.md 解析工单依赖关系，输出 Mermaid graph 与文本摘要。
// 数据源：表格状态 + §Planned 工单范围摘要 里的 "依赖：<work-id> / <work-id>"。
//
// 用法：
//   node workflow/scripts/render-dependencies.mjs                # 人类可读输出
//   node workflow/scripts/render-dependencies.mjs --mermaid      # 只输出 mermaid 块
//   node workflow/scripts/render-dependencies.mjs --json         # JSON 输出
//   node workflow/scripts/render-dependencies.mjs --out path.mmd # 同时写到文件
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, inferDevRoot, makeWorkIdRegex, makeWorkIdPattern } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseQueueTable(md, workIdRe) {
  const lines = md.split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|')) continue;
    const cells = lines[i].split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 8) continue;
    if (!workIdRe.test(cells[0])) continue;
    rows.push({ workId: cells[0], name: cells[1], status: cells[2], milestone: cells[3] });
  }
  return rows;
}

function extractAllDependencies(md, workIdPattern) {
  const lines = md.split('\n');
  const result = new Map();
  let curId = null;
  let curBody = [];
  const headRe = new RegExp(`^###\\s+(${workIdPattern})\\s+·`);
  const depRe = new RegExp(workIdPattern, 'g');
  const flush = () => {
    if (!curId) return;
    const body = curBody.join('\n');
    const m = body.match(/依赖：([^\n。]+)/);
    const deps = m ? [...new Set((m[1].match(depRe) || []))] : [];
    result.set(curId, deps);
  };
  for (const line of lines) {
    const head = line.match(headRe);
    if (head) { flush(); curId = head[1]; curBody = []; continue; }
    if (/^##\s+/.test(line)) { flush(); curId = null; curBody = []; continue; }
    if (curId) curBody.push(line);
  }
  flush();
  return result;
}

export function buildDependencyModel({ queueMd, config }) {
  if (!config) throw new Error('buildDependencyModel 需要传入 config');
  const WORK_ID_RE = makeWorkIdRegex(config);
  const WORK_ID_PATTERN = makeWorkIdPattern(config);

  const rows = parseQueueTable(queueMd, WORK_ID_RE);
  const summaryDeps = extractAllDependencies(queueMd, WORK_ID_PATTERN);
  const byId = new Map(rows.map((r) => [r.workId, r]));

  const nodes = rows.map((r) => ({
    id: r.workId,
    name: r.name,
    status: r.status,
    milestone: r.milestone,
    deps: summaryDeps.get(r.workId) || [],
  }));

  const dependents = new Map();
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d).push(n.id);
    }
  }

  const issues = [];
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!byId.has(d)) issues.push(`${n.id} 声明依赖 ${d}，但 ${d} 不在 queue.md 中`);
    }
  }

  const leaves = nodes.filter((n) => n.deps.length === 0).map((n) => n.id);
  const heaviest = [...nodes].sort((a, b) => b.deps.length - a.deps.length).slice(0, 5);
  const bottleneck = [...dependents.entries()]
    .map(([id, ds]) => ({ id, count: ds.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { nodes, dependents, leaves, heaviest, bottleneck, issues };
}

export function renderMermaid(model) {
  const lines = ['graph TD'];
  for (const n of model.nodes) {
    const safeName = n.name.replace(/"/g, "'");
    lines.push(`  ${n.id}["${n.id}<br/>${safeName}"]:::st-${n.status.toLowerCase().replace(/\s+/g, '-')}`);
  }
  for (const n of model.nodes) {
    for (const d of n.deps) {
      lines.push(`  ${d} --> ${n.id}`);
    }
  }
  lines.push('');
  lines.push('  classDef st-done fill:#1a3a2a,stroke:#36D399,color:#E8ECF4;');
  lines.push('  classDef st-ready fill:#1a2a3a,stroke:#57A6F5,color:#E8ECF4;');
  lines.push('  classDef st-in-progress fill:#3a1a1a,stroke:#FF5566,color:#E8ECF4;');
  lines.push('  classDef st-blocked fill:#3a1a1a,stroke:#FF5566,color:#E8ECF4;');
  lines.push('  classDef st-planned fill:#1a1a1a,stroke:#6B7385,color:#9CA3B4;');
  lines.push('  classDef st-superseded fill:#1a1a1a,stroke:#6B7385,color:#6B7385;');
  return lines.join('\n');
}

export function renderTextReport(model) {
  const lines = [];
  lines.push(`# Dependency Report · queue.md (${model.nodes.length} work items)`);
  lines.push('');
  if (model.issues.length > 0) {
    lines.push('## ⚠ 校验问题');
    for (const m of model.issues) lines.push(`- ${m}`);
    lines.push('');
  }
  lines.push('## Leaf（无前置依赖，可直接 promote）');
  if (model.leaves.length === 0) lines.push('- 无');
  else for (const id of model.leaves) {
    const n = model.nodes.find((x) => x.id === id);
    lines.push(`- ${id} · ${n.name} · ${n.status}`);
  }
  lines.push('');
  lines.push('## Top 5 Bottleneck（被多少其他工单依赖）');
  if (model.bottleneck.length === 0) lines.push('- 无');
  else for (const b of model.bottleneck) {
    const n = model.nodes.find((x) => x.id === b.id);
    const dependents = (model.dependents.get(b.id) || []).join(' / ');
    lines.push(`- ${b.id} (${b.count}) · ${n ? n.name : '?'} · ${n ? n.status : '?'}\n    被依赖：${dependents}`);
  }
  lines.push('');
  lines.push('## Top 5 Heaviest（自身依赖最多）');
  for (const h of model.heaviest) {
    if (h.deps.length === 0) continue;
    lines.push(`- ${h.id} (${h.deps.length}) · ${h.name} · ${h.status}\n    依赖：${h.deps.join(' / ')}`);
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const devRoot = inferDevRoot();
  const stateDir = process.env.STATE_DIR || join(devRoot, 'state');
  const queuePath = join(stateDir, 'queue.md');
  if (!existsSync(queuePath)) {
    console.error(`[render-dependencies] 未找到 ${queuePath}`);
    process.exit(2);
  }
  const queueMd = readFileSync(queuePath, 'utf8');
  const config = await loadConfig({ devRoot });
  const model = buildDependencyModel({ queueMd, config });

  const args = process.argv.slice(2);
  const asMermaid = args.includes('--mermaid');
  const asJson = args.includes('--json');
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

  const mermaid = renderMermaid(model);
  if (asJson) {
    const exportable = {
      nodes: model.nodes,
      dependents: Object.fromEntries(model.dependents),
      leaves: model.leaves,
      heaviest: model.heaviest,
      bottleneck: model.bottleneck,
      issues: model.issues,
    };
    process.stdout.write(JSON.stringify(exportable, null, 2) + '\n');
  } else if (asMermaid) {
    process.stdout.write('```mermaid\n' + mermaid + '\n```\n');
  } else {
    console.log(renderTextReport(model));
    console.log('');
    console.log('## Mermaid graph');
    console.log('```mermaid');
    console.log(mermaid);
    console.log('```');
  }

  if (outPath) {
    writeFileSync(outPath, mermaid + '\n');
    console.error(`[render-dependencies] mermaid 写入 ${outPath}`);
  }

  if (model.issues.length > 0) process.exit(1);
}
