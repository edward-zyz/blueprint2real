#!/usr/bin/env node
// e2e-group-status · 确定性判断"一次提交批次（e2e group）"是否到达组级 E2E 验收边界。
//
// 单位定义：一次 b2r 提交 mint 出的一批工单共享一个 group id（见 config.mjs::mintGroupId），
// 记录在 state/e2e-groups.md。当某 Open 组的工单全部 Done 时到达边界，应跑组级 E2E 验收并固化。
//
// 边界定义：该组 WorkIds 全部存在于 queue.md 且 status==Done，且组 Status 仍为 Open。
// E2E 是否启用（config.e2e + unit∈{group,both}）只影响 next_action；边界判断本身只看 state。
//
// 用法：
//   node workflow/scripts/e2e-group-status.mjs            # 输出全部 group
//   node workflow/scripts/e2e-group-status.mjs EG-...     # 指定 group
//   node workflow/scripts/e2e-group-status.mjs --json
//   node workflow/scripts/e2e-group-status.mjs EG-... --quiet  # 到边界退 0，否则退 1

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, inferDevRoot, makeWorkIdRegex } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GROUP_ID_RE = /^EG-\d{6}-\d{6}(?:-[0-9a-z]{2})?$/;

// 成员"已消解"= Done 或 Superseded（被 drop 的成员不阻断组边界，与里程碑线
// "不对 Superseded 做验收"语义一致）。
function isResolved(status) {
  return status === 'Done' || status === 'Superseded';
}

function readRequired(p) {
  if (!existsSync(p)) throw new Error(`缺少文件: ${p}`);
  return readFileSync(p, 'utf8');
}

function parseQueueStatuses(md, workIdRe) {
  const map = new Map();
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 8) continue;
    if (!workIdRe.test(cells[0])) continue;
    map.set(cells[0], cells[2]); // workId -> status
  }
  return map;
}

// state/e2e-groups.md 表行：| Group | WorkIds | Status | Receipt | Created |
export function parseGroupRows(md) {
  const rows = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 5) continue;
    if (!GROUP_ID_RE.test(cells[0])) continue;
    const workIds = cells[1]
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    rows.push({
      group: cells[0],
      workIds,
      status: cells[2],
      receipt: cells[3] === '—' ? null : cells[3],
      created: cells[4],
    });
  }
  return rows;
}

function summarizeGroup({ row, queueStatus, groupUnitEnabled, e2eEnabled }) {
  const members = row.workIds.map((workId) => ({
    workId,
    status: queueStatus.has(workId) ? queueStatus.get(workId) : null,
    found: queueStatus.has(workId),
  }));
  const allDone = members.length > 0 && members.every((m) => m.found && isResolved(m.status));
  const open = row.status === 'Open';
  const boundaryReached = allDone && open;
  let nextAction;
  if (!groupUnitEnabled) nextAction = 'group_unit_disabled';
  else if (!open) nextAction = 'closed';
  else if (boundaryReached) nextAction = e2eEnabled ? 'run_group_e2e' : 'skip_e2e_disabled';
  else nextAction = 'continue_per_ticket_pipeline';
  return {
    group: row.group,
    status: row.status,
    receipt: row.receipt,
    created: row.created,
    total: members.length,
    done: members.filter((m) => m.found && isResolved(m.status)).length,
    all_done: allDone,
    boundary_reached: boundaryReached,
    next_action: nextAction,
    members,
    open_members: members.filter((m) => !(m.found && isResolved(m.status))),
  };
}

export function buildGroupStatus({ stateDir, config, group = null }) {
  if (!config) throw new Error('buildGroupStatus 需要传入 config');
  const groupUnitEnabled = !!(config.e2e && ['group', 'both'].includes(config.e2e.unit));
  const e2eEnabled = !!(config.e2e && typeof config.e2e.verifySkill === 'string' && config.e2e.verifySkill.trim());
  const workIdRe = makeWorkIdRegex(config);
  const queueMd = readRequired(join(stateDir, 'queue.md'));
  const queueStatus = parseQueueStatuses(queueMd, workIdRe);

  const groupsPath = join(stateDir, 'e2e-groups.md');
  const rows = existsSync(groupsPath) ? parseGroupRows(readFileSync(groupsPath, 'utf8')) : [];
  if (group && !rows.some((r) => r.group === group)) {
    throw new Error(`未知 group "${group}"；e2e-groups.md 中查无此组`);
  }
  const selected = group ? rows.filter((r) => r.group === group) : rows;
  const groups = selected.map((row) => summarizeGroup({ row, queueStatus, groupUnitEnabled, e2eEnabled }));
  return {
    ok: true,
    e2e_enabled: e2eEnabled,
    group_unit_enabled: groupUnitEnabled,
    groups,
  };
}

function parseArgs(argv) {
  const opts = { json: false, quiet: false, group: null };
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg.startsWith('--')) throw new Error(`未知参数: ${arg}`);
    else if (!opts.group) opts.group = arg;
    else throw new Error(`只能指定一个 group（多余参数: ${arg}）`);
  }
  return opts;
}

function formatHuman(result) {
  const lines = ['[e2e-group-status]'];
  for (const g of result.groups) {
    const verdict = g.boundary_reached ? 'BOUNDARY' : g.next_action === 'closed' ? 'CLOSED' : 'NOT_READY';
    lines.push(`${g.group}: ${verdict} · ${g.done}/${g.total} done · Status ${g.status} · next=${g.next_action}`);
    if (g.open_members.length > 0) {
      lines.push(`  open: ${g.open_members.map((m) => `${m.workId}:${m.found ? m.status : 'MISSING'}`).join(', ')}`);
    }
  }
  if (result.groups.length === 0) lines.push('（无 group）');
  lines.push(`group_unit=${result.group_unit_enabled ? 'enabled' : 'disabled'} · e2e=${result.e2e_enabled ? 'enabled' : 'disabled'}`);
  return lines.join('\n');
}

// symlink-safe main-module 检测（修复 file://+argv[1] 直拼在软链安装下 main 被跳过的坑）
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
const isMain = invokedPath && import.meta.url === pathToFileURL(invokedPath).href;

if (isMain) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`[e2e-group-status] ${e.message}`);
    process.exit(2);
  }
  try {
    const devRoot = inferDevRoot();
    const stateDir = process.env.STATE_DIR || join(devRoot, 'state');
    const config = await loadConfig({ devRoot });
    const result = buildGroupStatus({ stateDir, config, group: opts.group });
    const selected = opts.group ? result.groups[0] : null;
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else if (!opts.quiet) {
      console.log(formatHuman(result));
    }
    if (opts.quiet) process.exit(selected && selected.boundary_reached ? 0 : 1);
    process.exit(0);
  } catch (e) {
    if (opts?.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + '\n');
    } else {
      console.error(`[e2e-group-status] ${e.message}`);
    }
    process.exit(2);
  }
}
