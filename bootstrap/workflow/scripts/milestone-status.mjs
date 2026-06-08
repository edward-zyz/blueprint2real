#!/usr/bin/env node
// milestone-status · 确定性判断某里程碑是否到达蓝图级 E2E 验收边界。
//
// 边界定义：该里程碑下 work item total > 0，且 done == total，且无 Ready/In Progress。
// E2E 是否启用只影响 next_action；边界判断本身只看 state/queue.md。
//
// 用法：
//   node workflow/scripts/milestone-status.mjs M1
//   node workflow/scripts/milestone-status.mjs M1 --json
//   node workflow/scripts/milestone-status.mjs M1 --quiet  # true 退出 0，false 退出 1
//   node workflow/scripts/milestone-status.mjs --json      # 输出全部 config.milestones

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, inferDevRoot, makeWorkIdRegex, isMainModule } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readRequired(p) {
  if (!existsSync(p)) throw new Error(`缺少文件: ${p}`);
  return readFileSync(p, 'utf8');
}

function stripParens(s) {
  return String(s).split(/[（(]/)[0].trim();
}

function findField(md, key) {
  const re = new RegExp('^-\\s*' + key + ':\\s*(.+)$', 'm');
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

function parseQueueRows(md, workIdRe) {
  const rows = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 8) continue;
    if (!workIdRe.test(cells[0])) continue;
    rows.push({
      workId: cells[0],
      name: cells[1],
      status: cells[2],
      milestone: cells[3],
      spec: cells[4],
      plan: cells[5],
      commit: cells[6],
      finishedAt: cells[7],
    });
  }
  return rows;
}

function parseRoadmapStatuses(md, milestones) {
  const out = new Map();
  if (!milestones.length) return out;
  const idAlt = milestones.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const headRe = new RegExp(`^##\\s+(${idAlt})\\s+·`);
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(headRe);
    if (!head) continue;
    const id = head[1];
    for (let j = i + 1; j < lines.length; j++) {
      if (headRe.test(lines[j])) break;
      const status = lines[j].match(/^-\s*\*\*状态\*\*：\s*(.+?)\s*$/);
      if (status) {
        out.set(id, stripParens(status[1]));
        break;
      }
    }
  }
  return out;
}

function summarizeMilestone({ id, rows, roadmapStatus, e2eEnabled }) {
  const scoped = rows.filter((r) => r.milestone === id);
  const counts = {
    total: scoped.length,
    done: scoped.filter((r) => r.status === 'Done').length,
    planned: scoped.filter((r) => r.status === 'Planned').length,
    ready: scoped.filter((r) => r.status === 'Ready').length,
    in_progress: scoped.filter((r) => r.status === 'In Progress').length,
    blocked: scoped.filter((r) => r.status === 'Blocked').length,
    superseded: scoped.filter((r) => r.status === 'Superseded').length,
  };
  const boundaryReached = counts.total > 0
    && counts.done === counts.total
    && counts.ready === 0
    && counts.in_progress === 0;
  return {
    milestone: id,
    roadmap_status: roadmapStatus || null,
    ...counts,
    boundary_reached: boundaryReached,
    next_action: boundaryReached
      ? (e2eEnabled ? 'run_e2e_acceptance' : 'skip_e2e_disabled')
      : 'continue_per_ticket_pipeline',
    done_work_ids: scoped.filter((r) => r.status === 'Done').map((r) => r.workId),
    open_work_ids: scoped.filter((r) => r.status !== 'Done').map((r) => ({ workId: r.workId, status: r.status })),
  };
}

export function buildMilestoneStatus({ stateDir, config, milestone = null }) {
  if (!config) throw new Error('buildMilestoneStatus 需要传入 config');
  if (milestone && !config.milestones.includes(milestone)) {
    throw new Error(`未知里程碑 "${milestone}"；合法值: ${config.milestones.join(', ') || '（空）'}`);
  }
  const workIdRe = makeWorkIdRegex(config);
  const activeMd = readRequired(join(stateDir, 'active.md'));
  const queueMd = readRequired(join(stateDir, 'queue.md'));
  const roadmapPath = join(stateDir, 'roadmap.md');
  const roadmapStatuses = existsSync(roadmapPath)
    ? parseRoadmapStatuses(readFileSync(roadmapPath, 'utf8'), config.milestones)
    : new Map();
  const rows = parseQueueRows(queueMd, workIdRe);
  const activeStatusRaw = findField(activeMd, 'Status') || '';
  const active = {
    id: findField(activeMd, 'ID') || null,
    status: activeStatusRaw ? stripParens(activeStatusRaw) : null,
  };
  const e2eEnabled = !!(config.e2e && typeof config.e2e.verifySkill === 'string' && config.e2e.verifySkill.trim());
  const selected = milestone ? [milestone] : config.milestones;
  const milestones = selected.map((id) => summarizeMilestone({
    id,
    rows,
    roadmapStatus: roadmapStatuses.get(id),
    e2eEnabled,
  }));
  return {
    ok: true,
    e2e_enabled: e2eEnabled,
    active,
    milestones,
  };
}

function parseArgs(argv) {
  const opts = { json: false, quiet: false, milestone: null, field: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--field') opts.field = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`未知参数: ${arg}`);
    else if (!opts.milestone) opts.milestone = arg;
    else throw new Error(`只能指定一个 milestone（多余参数: ${arg}）`);
  }
  return opts;
}

// 取顶层字段裸值单行(主线窄查询 --field 用,免即兴 grep/python)。
export function extractField(result, key) {
  const v = result?.[key];
  return v === undefined || v === null ? '' : String(v);
}

function formatHuman(result) {
  const lines = ['[milestone-status]'];
  for (const m of result.milestones) {
    const verdict = m.boundary_reached ? 'BOUNDARY' : 'NOT_READY';
    lines.push(`${m.milestone}: ${verdict} · ${m.done}/${m.total} done · Ready ${m.ready} · In Progress ${m.in_progress} · next=${m.next_action}`);
    if (m.open_work_ids.length > 0) {
      lines.push(`  open: ${m.open_work_ids.map((w) => `${w.workId}:${w.status}`).join(', ')}`);
    }
  }
  lines.push(`active=${result.active.id || '—'}:${result.active.status || '—'} · e2e=${result.e2e_enabled ? 'enabled' : 'disabled'}`);
  return lines.join('\n');
}

if (isMainModule(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`[milestone-status] ${e.message}`);
    process.exit(2);
  }
  try {
    const devRoot = inferDevRoot();
    const stateDir = process.env.STATE_DIR || join(devRoot, 'state');
    const config = await loadConfig({ devRoot });
    const result = buildMilestoneStatus({ stateDir, config, milestone: opts.milestone });
    const selected = opts.milestone ? result.milestones[0] : null;
    if (opts.field) {
      process.stdout.write(extractField(selected || result, opts.field) + '\n');
      process.exit(0);
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else if (!opts.quiet) {
      console.log(formatHuman(result));
    }
    if (opts.quiet) process.exit(selected && selected.boundary_reached ? 0 : 1);
    process.exit(0);
  } catch (e) {
    // 错误一律走 stderr,保持 stdout 纯净(O23)。
    console.error(`[milestone-status] ${e.message}`);
    process.exit(2);
  }
}
