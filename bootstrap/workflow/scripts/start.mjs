#!/usr/bin/env node
// 把一条 Ready 工单"启动"为 In Progress：原子同步 active.md + queue.md。
//
// 背景（v5.3 回灌 O8）：promote.mjs 只把工单从 Planned 翻到 Ready，生成 spec/plan stub。
// 之后真正"开始做"这一步——active.md 翻 In Progress 持有该工单 + queue.md 对应行
// Ready→In Progress——此前靠主线手工改两个文件，漏改一个就触发 validate-state 的
// cross-file 报错（"active 持有但 queue Status=Ready" / "active Idle 但 queue In Progress"）。
// 本脚本把这两处改动收成一条命令，并跑 validate-state 兜底 + 重 render BOARD。
//
// 不变量约束（与 SKILL.md / validate-state 对齐）：
//   - exactly-one-active：启动前 active 必须 Idle，否则拒绝（先 handoff 当前工单）。
//   - 只有 Ready 工单能启动：queue 行 Status 必须为 Ready（Planned 须先 promote）。
//
// 用法：
//   node workflow/scripts/start.mjs <work-id>            # 实际执行
//   node workflow/scripts/start.mjs <work-id> --dry-run  # 只展示动作，不写盘
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateState } from './validate-state.mjs';
import { renderBoard } from './render-board.mjs';
import { loadConfig, inferDevRoot, makeWorkIdRegex, isMainModule } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TODAY_ISO = (() => {
  const d = new Date();
  const tz = 8 * 60;
  const local = new Date(d.getTime() + (tz + d.getTimezoneOffset()) * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
})();

class StartError extends Error {}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseQueueRow(line, workIdRe) {
  if (!line.startsWith('|')) return null;
  const cells = line.split('|').slice(1, -1).map((s) => s.trim());
  if (cells.length < 8) return null;
  if (!workIdRe.test(cells[0])) return null;
  return {
    workId: cells[0], name: cells[1], status: cells[2], milestone: cells[3],
    spec: cells[4], plan: cells[5], commit: cells[6], finishedAt: cells[7],
  };
}

function findActiveField(md, key) {
  const m = md.match(new RegExp('^-\\s*' + escapeRegExp(key) + ':\\s*(.+)$', 'm'));
  return m ? m[1].trim() : null;
}

// 替换 `- <Key>: ...` 行的值；字段不存在则原样返回（容错，不引入新字段）
function setActiveField(md, key, value) {
  const re = new RegExp('^(-\\s*' + escapeRegExp(key) + ':).*$', 'm');
  if (!re.test(md)) return md;
  return md.replace(re, `$1 ${value}`);
}

// 重写 active.md 的 "## 当前状态" 段为 In Progress 文案（保留其上方所有字段行）
function setActiveBody(md, workId) {
  const marker = '## 当前状态';
  const idx = md.indexOf(marker);
  const body = `${marker}

- 正在推进 ${workId}，按 \`../AGENT_RUNBOOK.md\` §3 固定执行链路走：spec → plan → failing test（红）→ minimal impl（绿）→ targeted/regression → review → commit → handoff。
- 完成后跑 \`npm run verify:handoff ${workId}\` 验收通过，再把 active 翻回 Idle。
- 不变量：本工单期间 active 唯一持有它；切勿在同一 working tree 并发跑无关 git 操作。
`;
  if (idx === -1) {
    // 没有 "## 当前状态" 段：追加一段
    return md.replace(/\s*$/, '\n\n') + body;
  }
  return md.slice(0, idx) + body;
}

function flipQueueRowToInProgress({ queueMd, workId, workIdRe }) {
  const lines = queueMd.split('\n');
  let hit = false;
  for (let i = 0; i < lines.length; i++) {
    const r = parseQueueRow(lines[i], workIdRe);
    if (!r || r.workId !== workId) continue;
    if (r.status === 'In Progress') { hit = true; break; } // 幂等：已是 In Progress 不重写
    if (r.status !== 'Ready') {
      throw new StartError(`${workId} 当前 Status="${r.status}"，必须为 Ready 才能 start（Planned 须先 promote）`);
    }
    lines[i] = `| ${r.workId} | ${r.name} | In Progress | ${r.milestone} | ${r.spec} | ${r.plan} | ${r.commit} | ${r.finishedAt} |`;
    hit = true;
    break;
  }
  if (!hit) throw new StartError(`${workId} 不在 queue.md 表中`);
  let out = lines.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

export async function start({ stateDir, workId, config, dryRun = false, today = TODAY_ISO, boardPath = null }) {
  if (!config) throw new Error('start 需要传入 config（来自 loadConfig）');
  const WORK_ID_RE = makeWorkIdRegex(config);
  if (!WORK_ID_RE.test(workId)) {
    throw new StartError(`workId "${workId}" 不符合 ${config.workIdPrefix}-… 格式`);
  }

  const queuePath = join(stateDir, 'queue.md');
  const activePath = join(stateDir, 'active.md');
  if (!existsSync(queuePath)) throw new StartError(`未找到 ${queuePath}`);
  if (!existsSync(activePath)) throw new StartError(`未找到 ${activePath}`);

  const queueMd = readFileSync(queuePath, 'utf8');
  const activeMd = readFileSync(activePath, 'utf8');

  const row = parseQueueRow(
    queueMd.split('\n').find((l) => parseQueueRow(l, WORK_ID_RE)?.workId === workId) || '',
    WORK_ID_RE,
  );
  if (!row) throw new StartError(`${workId} 不在 queue.md 表中`);

  // exactly-one-active：active 必须 Idle（或已持有本工单 → 幂等）
  const activeStatusRaw = findActiveField(activeMd, 'Status') || '';
  const activeStatus = activeStatusRaw.split(/[（(]/)[0].trim();
  const activeId = findActiveField(activeMd, 'ID');
  const alreadyHolding = activeId === workId && activeStatus === 'In Progress';
  if (!alreadyHolding && activeStatus !== 'Idle') {
    throw new StartError(
      `active.md 当前 Status="${activeStatus}" / ID="${activeId}"，不是 Idle——` +
      `exactly-one-active 不允许启动新工单。请先 handoff 当前工单（npm run verify:handoff ${activeId}）。`,
    );
  }

  const newQueueMd = flipQueueRowToInProgress({ queueMd, workId, workIdRe: WORK_ID_RE });
  let newActiveMd = activeMd;
  newActiveMd = setActiveField(newActiveMd, 'ID', workId);
  newActiveMd = setActiveField(newActiveMd, 'Name', row.name);
  newActiveMd = setActiveField(newActiveMd, 'Status', 'In Progress');
  newActiveMd = setActiveField(newActiveMd, 'Started', today);
  newActiveMd = setActiveField(newActiveMd, 'Spec', row.spec);
  newActiveMd = setActiveField(newActiveMd, 'Plan', row.plan);
  newActiveMd = setActiveField(newActiveMd, 'Blockers', '—');
  newActiveMd = setActiveBody(newActiveMd, workId);

  const resolvedBoardPath = boardPath || join(stateDir, '..', 'BOARD.html');
  const summary = {
    workId, name: row.name, milestone: row.milestone, spec: row.spec, plan: row.plan,
    willWrite: [
      { path: activePath, action: 'rewrite (In Progress)' },
      { path: queuePath, action: `rewrite (${row.status} → In Progress)` },
      { path: resolvedBoardPath, action: 'rerender' },
    ],
  };

  if (dryRun) return { ok: true, dryRun: true, summary };

  writeFileSync(activePath, newActiveMd);
  writeFileSync(queuePath, newQueueMd);

  const validation = validateState({ stateDir, config });
  if (!validation.ok) {
    throw new StartError(
      `start 写盘成功但 validate-state 报错（请手工修复）：\n${validation.issues
        .filter((i) => i.severity === 'error')
        .map((i) => `  - ${i.file}: ${i.msg}`)
        .join('\n')}`,
    );
  }

  let boardResult = null;
  try {
    boardResult = await renderBoard({ stateDir, outPath: resolvedBoardPath, config });
  } catch (e) {
    console.error(`[start] 警告：自动 render-board 失败 (${e.message})；请手工跑 npm run render:board`);
  }

  return { ok: true, dryRun: false, summary, validation, board: boardResult };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const workId = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  if (!workId) {
    console.error('用法: node workflow/scripts/start.mjs <work-id> [--dry-run]');
    process.exit(2);
  }
  const devRoot = inferDevRoot();
  const stateDir = process.env.STATE_DIR || join(devRoot, 'state');
  try {
    const config = await loadConfig({ devRoot });
    const r = await start({ stateDir, workId, config, dryRun });
    if (dryRun) {
      console.log(`[start] DRY-RUN · ${workId}`);
      console.log(`  name      : ${r.summary.name}`);
      console.log(`  milestone : ${r.summary.milestone}`);
      console.log(`  will write:`);
      for (const w of r.summary.willWrite) console.log(`    - ${w.path} · ${w.action}`);
    } else {
      console.log(`[start] OK · ${workId} → In Progress（active 已持有，queue 已翻档）`);
      console.log('\n下一步：按 RUNBOOK §3 推进 spec → plan → TDD → review → handoff。');
    }
    process.exit(0);
  } catch (e) {
    if (e instanceof StartError) {
      console.error(`[start] ERROR: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
