#!/usr/bin/env node
// state/*.md 契约校验器
// 目标：把 render-board.mjs 与 AGENT_RUNBOOK §§4/7/9 隐式依赖的 schema
// 显式化为可执行检查，杜绝 state/* 静默错位。
//
// 用法：
//   node workflow/scripts/validate-state.mjs              # 人类可读输出，违规则退出码 1
//   node workflow/scripts/validate-state.mjs --json       # JSON 输出（CI 消费）
//   STATE_DIR=/path/to/state node ...                     # 覆盖 state 目录（默认 <devRoot>/state）
//   WORKFLOW_CONFIG=/path/to/config.mjs node ...          # 覆盖 config 文件
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, inferDevRoot, makeWorkIdRegex, makeWorkIdPattern, makeWorkIdLoosePattern, workItemSlug } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACTIVE_STATUSES = ['Idle', 'Ready', 'In Progress', 'Blocked'];
const QUEUE_STATUSES = ['Planned', 'Ready', 'In Progress', 'Blocked', 'Done', 'Superseded'];
const MILESTONE_STATUSES = ['Planned', 'Contract Done', 'Demo Ready', 'Production Ready'];

// 本校验器只读这 4 个核心 state 文件；其它在 state/ 下出现的文件（如 v5.1 的 retro.md）
// 由 blueprint2real skill / 其他工具维护，不在本校验范围。若未来加"未知 state 文件警告"功能，
// 需把以下白名单同步纳入：active.md / queue.md / roadmap.md / customer-visible.md / retro.md / acceptance.md
const KNOWN_STATE_FILES = ['active.md', 'queue.md', 'roadmap.md', 'customer-visible.md', 'retro.md', 'acceptance.md'];
const COMMIT_HASH_RE = /^[0-9a-f]{7,40}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readFile(p) {
  if (!existsSync(p)) throw new Error(`缺少 state 文件: ${p}`);
  return readFileSync(p, 'utf8');
}

function findField(md, key) {
  const re = new RegExp('^-\\s*' + key + ':\\s*(.+)$', 'm');
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

function stripParens(s) {
  return String(s).split(/[（(]/)[0].trim();
}

function parseQueueTable(md) {
  const lines = md.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|\s*Work ID\s*\|/.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return null;
  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 8) continue;
    rows.push({
      workId: cells[0],
      name: cells[1],
      status: cells[2],
      milestone: cells[3],
      spec: cells[4],
      plan: cells[5],
      commit: cells[6],
      finishedAt: cells[7],
      lineNo: i + 1,
    });
  }
  return { headerLine: headerIdx + 1, rows };
}

function parsePlannedSummaryIds(md, workIdPattern) {
  const re = new RegExp(`^###\\s+(${workIdPattern})\\s+·`, 'gm');
  const ids = [];
  let m;
  while ((m = re.exec(md)) !== null) ids.push(m[1]);
  return ids;
}

function parseCvSegments(md, workIdPattern) {
  // v5.1: Done 后允许尾随说明（如 "Done（L0 trivial · Manager Override accept-override）"）
  // 与 verify-handoff::findCvSegment 保持一致
  const re = new RegExp(`^##\\s+(\\d{4}-\\d{2}-\\d{2})\\s+·\\s+(${workIdPattern})\\s+Done\\b.*$`, 'gm');
  const out = [];
  let m;
  while ((m = re.exec(md)) !== null) {
    out.push({ date: m[1], workId: m[2], index: m.index });
  }
  return out;
}

function parseMilestones(md, milestones) {
  // 通用：匹配 `## <id> · <title>`，其中 <id> 是 config.milestones 中任一项
  const idAlt = milestones.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const headRe = idAlt ? new RegExp(`^##\\s+(${idAlt})\\s+·`) : null;
  const lines = md.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (!headRe) continue;
    const head = lines[i].match(headRe);
    if (!head) continue;
    const id = head[1];
    let status = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (headRe.test(lines[j])) break;
      const sm = lines[j].match(/^-\s*\*\*状态\*\*：\s*(.+?)\s*$/);
      if (sm && status === null) status = stripParens(sm[1]);
    }
    result.push({ id, status });
  }
  return result;
}

function parseAcceptanceMilestoneIds(md, milestones) {
  const idAlt = milestones.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!idAlt) return [];
  const re = new RegExp(`^##\\s+(${idAlt})\\s+·`, 'gm');
  const ids = [];
  let m;
  while ((m = re.exec(md)) !== null) ids.push(m[1]);
  return ids;
}

export function validateState({ stateDir, config }) {
  if (!config) throw new Error('validateState 需要传入 config（来自 loadConfig）');
  const WORK_ID_RE = makeWorkIdRegex(config);
  const WORK_ID_PATTERN = makeWorkIdPattern(config);
  const WORK_ID_LABEL = WORK_ID_PATTERN;

  const issues = [];
  const err = (file, msg) => issues.push({ severity: 'error', file, msg });
  const warn = (file, msg) => issues.push({ severity: 'warn', file, msg });

  let activeMd; let queueMd; let roadmapMd; let cvMd;
  try {
    activeMd = readFile(join(stateDir, 'active.md'));
    queueMd = readFile(join(stateDir, 'queue.md'));
    roadmapMd = readFile(join(stateDir, 'roadmap.md'));
    cvMd = readFile(join(stateDir, 'customer-visible.md'));
  } catch (e) {
    err('state', e.message);
    return { issues, ok: false };
  }

  // A · active.md
  const activeId = findField(activeMd, 'ID');
  const activeStatusRaw = findField(activeMd, 'Status');
  const activeName = findField(activeMd, 'Name');
  if (activeId === null) err('active.md', '缺少 `- ID:` 字段');
  if (activeStatusRaw === null) err('active.md', '缺少 `- Status:` 字段');
  if (activeName === null) err('active.md', '缺少 `- Name:` 字段');

  const activeStatus = activeStatusRaw ? stripParens(activeStatusRaw) : '';
  if (activeStatusRaw && !ACTIVE_STATUSES.includes(activeStatus)) {
    err('active.md', `Status "${activeStatus}" 不在合法集 { ${ACTIVE_STATUSES.join(' | ')} }`);
  }
  const isIdleId = activeId === '—';
  const isIdleStatus = activeStatus === 'Idle';
  if (isIdleId !== isIdleStatus && activeId !== null && activeStatusRaw !== null) {
    err('active.md', `ID 与 Status 必须同时为 Idle 或同时为有效 work item（当前 ID="${activeId}" / Status="${activeStatus}"）`);
  }
  if (activeId && !isIdleId && !WORK_ID_RE.test(activeId)) {
    err('active.md', `ID "${activeId}" 不符合 ${WORK_ID_LABEL} 格式`);
  }

  // B · queue.md
  const queue = parseQueueTable(queueMd);
  const queueRows = queue ? queue.rows : [];
  if (!queue) {
    err('queue.md', '未找到以 `| Work ID |` 开头的表格');
  } else {
    const seen = new Map();
    for (const r of queueRows) {
      if (!WORK_ID_RE.test(r.workId)) {
        err('queue.md', `行 ${r.lineNo}: Work ID "${r.workId}" 不符合 ${WORK_ID_LABEL}`);
        continue;
      }
      if (seen.has(r.workId)) {
        err('queue.md', `Work ID ${r.workId} 重复（行 ${seen.get(r.workId)} 与 ${r.lineNo}）`);
      }
      seen.set(r.workId, r.lineNo);
      if (!QUEUE_STATUSES.includes(r.status)) {
        err('queue.md', `${r.workId}: Status "${r.status}" 不在合法集 { ${QUEUE_STATUSES.join(' | ')} }`);
      }
      if (r.status === 'Done') {
        const commitClean = r.commit.replace(/^`|`$/g, '');
        if (!COMMIT_HASH_RE.test(commitClean)) {
          err('queue.md', `${r.workId}: Done 状态 Commit "${r.commit}" 不符合 hex hash（7-40 位）`);
        }
        if (!ISO_DATE_RE.test(r.finishedAt)) {
          err('queue.md', `${r.workId}: Done 状态 完成日期 "${r.finishedAt}" 不符合 YYYY-MM-DD`);
        }
        if (r.spec === '—' || r.plan === '—') {
          // v5.1: L0 工单跳过 spec/plan 路径检查（L0 路径不产生 spec/plan，
          //       走 direct-fix agent；与 verify-handoff.mjs::Check 4 的 L0 兼容保持一致）
          // v5.2: receipt 目录从 work/<workId>/ 改为 work/<slugDir>/
          const receiptsDir = (config.pipeline && config.pipeline.receiptsDir) || 'receipts';
          const devRoot = dirname(stateDir);
          const slugDir = workItemSlug({ workId: r.workId, title: r.name });
          const triagePath = join(devRoot, 'work', slugDir, receiptsDir, '0-triage.json');
          // legacy fallback: 兼容 v5.1 之前生成的 work/<workId>/
          const triagePathLegacy = join(devRoot, 'work', r.workId, receiptsDir, '0-triage.json');
          let isL0 = false;
          const triageRead = existsSync(triagePath) ? triagePath : (existsSync(triagePathLegacy) ? triagePathLegacy : null);
          if (triageRead) {
            try {
              const triage = JSON.parse(readFileSync(triageRead, 'utf8'));
              if (triage && triage.level === 'L0') isL0 = true;
            } catch { /* parse fail → 视为非 L0，照样报错 */ }
          }
          if (!isL0) {
            err('queue.md', `${r.workId}: Done 状态必须有 Spec 与 Plan 路径，不能是 "—"`);
          }
        }
      }
      if (r.status === 'Planned') {
        if (r.spec !== '—' || r.plan !== '—' || r.commit !== '—' || r.finishedAt !== '—') {
          warn('queue.md', `${r.workId}: Planned 状态的 Spec/Plan/Commit/完成日期 应统一为 "—"`);
        }
      }
    }

    // 双源检查：Planned 表里有 ↔ §Planned 工单范围摘要 有对应小节
    const summaryIds = new Set(parsePlannedSummaryIds(queueMd, WORK_ID_PATTERN));
    const plannedIds = new Set(queueRows.filter((r) => r.status === 'Planned').map((r) => r.workId));
    const promotedIds = new Set(queueRows.filter((r) => r.status !== 'Planned').map((r) => r.workId));
    for (const id of plannedIds) {
      if (!summaryIds.has(id)) {
        err('queue.md', `${id}: 表里是 Planned 但 §Planned 工单范围摘要 缺 "### ${id} ·" 小节（违反 RUNBOOK §9）`);
      }
    }
    for (const id of summaryIds) {
      if (promotedIds.has(id)) {
        err('queue.md', `${id}: 已 promote（非 Planned）但 §Planned 工单范围摘要 仍残留段落，需移除避免双源（违反 RUNBOOK §9）`);
      }
      if (!plannedIds.has(id) && !promotedIds.has(id)) {
        warn('queue.md', `§Planned 摘要含 ${id}，但 work queue 表中查无此条`);
      }
    }
  }

  // C · roadmap.md
  const milestones = parseMilestones(roadmapMd, config.milestones);
  const milestoneIds = milestones.map((m) => m.id);
  for (const expected of config.milestones) {
    if (!milestoneIds.includes(expected)) {
      err('roadmap.md', `缺少里程碑二级标题 "## ${expected} ·"`);
    }
  }
  for (const m of milestones) {
    if (!m.status) err('roadmap.md', `${m.id}: 缺 \`- **状态**：\` 字段`);
    else if (!MILESTONE_STATUSES.includes(m.status)) {
      err('roadmap.md', `${m.id}: 状态 "${m.status}" 不在合法集 { ${MILESTONE_STATUSES.join(' | ')} }`);
    }
  }

  // D · customer-visible.md
  const segments = parseCvSegments(cvMd, WORK_ID_PATTERN);
  if (segments.length === 0) {
    warn('customer-visible.md', `不含任何 "## YYYY-MM-DD · <workId> Done" 段；首次启动可忽略`);
  }
  for (const seg of segments) {
    if (Number.isNaN(Date.parse(seg.date + 'T00:00:00+08:00'))) {
      err('customer-visible.md', `${seg.workId}: 日期 "${seg.date}" 非法`);
    }
  }

  // D2 · acceptance.md（仅 e2e opt-in 时校验存在性；语义质量交 roadmap-planner / verifier）
  if (config.e2e !== undefined && config.milestones.length > 0) {
    const acceptancePath = join(stateDir, 'acceptance.md');
    if (!existsSync(acceptancePath)) {
      err('acceptance.md', 'config.e2e 已启用，但缺少 state/acceptance.md');
    } else {
      const acceptanceMd = readFileSync(acceptancePath, 'utf8');
      const seen = new Set(parseAcceptanceMilestoneIds(acceptanceMd, config.milestones));
      for (const expected of config.milestones) {
        if (!seen.has(expected)) {
          err('acceptance.md', `缺少里程碑验收段 "## ${expected} ·"`);
        }
      }
    }
  }

  // E · cross-file 一致性
  const rowsById = new Map(queueRows.map((r) => [r.workId, r]));
  if (activeId && WORK_ID_RE.test(activeId)) {
    const r = rowsById.get(activeId);
    if (!r) {
      err('cross-file', `active.md ID ${activeId} 未在 queue.md 出现`);
    } else if (!['In Progress', 'Blocked'].includes(r.status)) {
      err('cross-file', `active.md 持有 ${activeId} 但 queue.md 中其 Status="${r.status}"（应为 In Progress 或 Blocked）`);
    }
  }
  if (isIdleStatus) {
    const stuck = queueRows.filter((r) => r.status === 'In Progress');
    for (const r of stuck) {
      err('cross-file', `active.md 为 Idle 但 queue.md ${r.workId} 仍 In Progress（脱钩；违反 RUNBOOK §4 "exactly one"）`);
    }
  }
  for (const seg of segments) {
    const r = rowsById.get(seg.workId);
    if (!r) err('cross-file', `customer-visible.md 已写 ${seg.workId} Done 段，但 queue.md 中查无此条`);
    else if (r.status !== 'Done') {
      err('cross-file', `customer-visible.md ${seg.workId} 写为 Done，但 queue.md 中其 Status="${r.status}"`);
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return { issues, ok: errors.length === 0 };
}

function formatIssue(it) {
  const tag = it.severity === 'error' ? '\x1b[31m[ERROR]\x1b[0m' : '\x1b[33m[WARN] \x1b[0m';
  return `${tag} ${it.file}: ${it.msg}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const devRoot = inferDevRoot();
  const stateDir = process.env.STATE_DIR || join(devRoot, 'state');
  const asJson = process.argv.includes('--json');
  let result;
  try {
    const config = await loadConfig({ devRoot });
    result = validateState({ stateDir, config });
  } catch (e) {
    console.error(`[validate-state] 致命错误: ${e.message}`);
    process.exit(2);
  }
  const { issues, ok } = result;
  if (asJson) {
    process.stdout.write(JSON.stringify({ ok, issues }, null, 2) + '\n');
  } else if (issues.length === 0) {
    console.log('[validate-state] OK · state/* 与 render-board 契约一致');
  } else {
    for (const it of issues) console.log(formatIssue(it));
    const errCount = issues.filter((i) => i.severity === 'error').length;
    const warnCount = issues.filter((i) => i.severity === 'warn').length;
    console.log(`\n[validate-state] ${errCount} error · ${warnCount} warn`);
  }
  process.exit(ok ? 0 : 1);
}
