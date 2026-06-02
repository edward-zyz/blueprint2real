#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { loadConfig, inferDevRoot, makeWorkIdRegex, makeWorkIdLoosePattern } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILES = ['active.md', 'queue.md', 'roadmap.md', 'customer-visible.md'];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// "Idle" / "Ready" / "In Progress" / "Blocked" / "Done" / "Planned" / "Contract Done" / "Demo Ready" / "Production Ready"
function statusClass(raw) {
  if (!raw) return 'st-idle';
  const s = String(raw).trim();
  if (/^Idle/i.test(s) || s === '—') return 'st-idle';
  if (/^Ready$/i.test(s)) return 'st-ready';
  if (/^In Progress/i.test(s)) return 'st-progress';
  if (/^Blocked/i.test(s)) return 'st-blocked';
  if (/^Done/i.test(s)) return 'st-done';
  if (/^Planned/i.test(s)) return 'st-planned';
  if (/^Contract Done/i.test(s)) return 'st-contract';
  if (/^Demo Ready/i.test(s)) return 'st-demo';
  if (/^Production Ready/i.test(s)) return 'st-prod';
  return 'st-idle';
}

function parseActive(md) {
  const get = (key) => {
    const m = md.match(new RegExp('^-\\s*' + key + ':\\s*(.+)$', 'm'));
    return m ? m[1].trim() : '—';
  };
  return {
    id: get('ID'),
    name: get('Name'),
    status: get('Status'),
    started: get('Started'),
    blockers: get('Blockers'),
    nextCheckpoint: get('Next checkpoint'),
    lastCommit: get('Last commit'),
  };
}

function activeIsIdle(md) {
  const m = md.match(/^-\s*Status:\s*(.+)$/m);
  if (!m) return false;
  return /^Idle/i.test(m[1].trim());
}

// 提取 active.md 的 `## 当前状态` 段
function extractCurrentStatusSection(md) {
  const m = md.match(/^##\s+当前状态\s*\n([\s\S]*?)(?=^##\s|\n*$)/m);
  return m ? m[1].trim() : '';
}

function parseMilestones(md, milestones) {
  if (!milestones || milestones.length === 0) return [];
  const idAlt = milestones.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const headRe = new RegExp(`^##\\s+(${idAlt})\\s+·\\s+(.+?)\\s*$`);
  const lines = md.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(headRe);
    if (!head) continue;
    let status = '—';
    let diff = '';
    const stopRe = new RegExp(`^##\\s+(${idAlt})\\s+·`);
    for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
      if (stopRe.test(lines[j])) break;
      const sm = lines[j].match(/^-\s*\*\*状态\*\*：\s*(.+?)\s*$/);
      if (sm && status === '—') status = sm[1].split(/[（(]/)[0].trim();
      const dm = lines[j].match(/^-\s*\*\*差量\*\*：\s*(.+?)\s*$/);
      if (dm && !diff) diff = dm[1].trim();
    }
    result.push({ id: head[1], title: head[2], status, diff });
  }
  return result;
}

function countReadyInQueue(md, workIdLoosePattern) {
  const re = new RegExp(`^\\|\\s*${workIdLoosePattern}\\s*\\|[^\\n]*\\|\\s*Ready\\s*\\|`, 'gm');
  const rows = md.match(re) || [];
  return rows.length;
}

// 解析 queue.md 表，按里程碑分组统计 done/total，并返回总 Planned 数。
function parseQueueStats(md, workIdRe) {
  const byMilestone = {};
  let plannedCount = 0;
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 8) continue;
    if (!workIdRe.test(cells[0])) continue;
    const status = cells[2];
    const milestone = cells[3];
    if (!byMilestone[milestone]) byMilestone[milestone] = { done: 0, total: 0 };
    byMilestone[milestone].total += 1;
    if (status === 'Done') byMilestone[milestone].done += 1;
    if (status === 'Planned') plannedCount += 1;
  }
  return { byMilestone, plannedCount };
}

function lastShipment(cvSegments, workIdLoosePattern) {
  if (!cvSegments[0]) return null;
  const re = new RegExp(`^##\\s+(\\d{4}-\\d{2}-\\d{2})\\s+·\\s+(${workIdLoosePattern})\\s+Done`);
  const m = cvSegments[0].match(re);
  if (!m) return null;
  const date = m[1];
  const ms = Date.parse(date + 'T00:00:00+08:00');
  if (Number.isNaN(ms)) return { date, id: m[2], days: null };
  const days = Math.max(0, Math.floor((Date.now() - ms) / 86400000));
  return { date, id: m[2], days };
}

function nowStamp() {
  const d = new Date();
  const tz = 8 * 60;
  const local = new Date(d.getTime() + (tz + d.getTimezoneOffset()) * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())} UTC+8`;
}

function renderKpi({ active, readyCount, milestones, shipment, queueStats, pipeline }) {
  const currentMs = milestones.find((m) => /Contract Done|In Progress|Demo Ready/i.test(m.status))
    || milestones.find((m) => !/Production Ready/i.test(m.status))
    || milestones[0]
    || { id: '—', status: '—' };

  const msStat = queueStats?.byMilestone?.[currentMs.id];
  const plannedCount = queueStats?.plannedCount ?? 0;

  let activeSub;
  if (active.id && active.id !== '—') {
    activeSub = active.name;
  } else if (shipment && plannedCount > 0) {
    activeSub = `上轮 ${shipment.id} · backlog ${plannedCount} Planned`;
  } else if (shipment) {
    activeSub = `上轮 ${shipment.id}`;
  } else if (plannedCount > 0) {
    activeSub = `backlog ${plannedCount} Planned`;
  } else {
    activeSub = '（无 active）';
  }

  let msSub = currentMs.status;
  if (msStat && msStat.total > 0) {
    const pct = Math.round((msStat.done / msStat.total) * 100);
    msSub = `${currentMs.status} · ${msStat.done}/${msStat.total} done (${pct}%)`;
  }

  const cards = [
    {
      label: 'ACTIVE WORK ITEM',
      cls: statusClass(active.status),
      value: active.id && active.id !== '—' ? active.id : 'Idle',
      sub: activeSub,
      pill: active.status,
    },
    {
      label: 'READY QUEUE',
      cls: readyCount > 0 ? 'st-ready' : 'st-idle',
      value: String(readyCount),
      sub: readyCount > 0 ? '等待 Pick Up' : (plannedCount > 0 ? `${plannedCount} Planned 待 promote` : '队列为空'),
      pill: readyCount > 0 ? 'Ready' : 'Empty',
    },
    {
      label: 'CURRENT MILESTONE',
      cls: statusClass(currentMs.status),
      value: currentMs.id,
      sub: msSub,
      pill: currentMs.status,
    },
    {
      label: 'LAST SHIPMENT',
      cls: shipment ? 'st-done' : 'st-idle',
      value: shipment ? (shipment.days === 0 ? '今天' : `${shipment.days}d`) : '—',
      sub: shipment ? `${shipment.id} · ${shipment.date}` : '尚无 Done 记录',
      pill: shipment ? 'Done' : 'None',
    },
  ];

  // v5.1: BLOCKED 卡，仅在 pipeline 存在且 blockedCount > 0 时插入（避免 idle 项目显示无意义卡片）
  if (pipeline && pipeline.blockedCount > 0) {
    cards.push({
      label: 'BLOCKED',
      cls: 'st-blocked',
      value: String(pipeline.blockedCount),
      sub: 'awaiting Manager Override',
      pill: 'Action Required',
    });
  }

  return `<div class="kpi-row">${cards.map((c) => `
    <div class="kpi ${c.cls}">
      <div class="kpi-label">${escapeHtml(c.label)}</div>
      <div class="kpi-value">${escapeHtml(c.value)}</div>
      <div class="kpi-sub">${escapeHtml(c.sub)}</div>
      <div class="kpi-pill"><span class="led"></span>${escapeHtml(c.pill)}</div>
    </div>`).join('')}</div>`;
}

// v5.1: 扫描 b2r-process/work/*/receipts/pipeline-status.json 聚合工单清单
// 容错：缺目录 / parse 失败 / 字段缺失 都返回有效 item，不抛错。
function scanPipelineStatus(devRoot, receiptsDir = 'receipts') {
  const workDir = join(devRoot, 'work');
  if (!existsSync(workDir)) return { items: [], blockedCount: 0, stale: 0 };
  const items = [];
  let stale = 0;
  let workIds;
  try {
    workIds = readdirSync(workDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return { items: [], blockedCount: 0, stale: 0 };
  }
  for (const id of workIds) {
    const psPath = join(workDir, id, receiptsDir, 'pipeline-status.json');
    if (!existsSync(psPath)) continue;
    try {
      const obj = JSON.parse(readFileSync(psPath, 'utf8'));
      items.push({
        workId: String(obj.workId || id),
        level: String(obj.level || '—'),
        status: String(obj.status || 'unknown'),
        currentStage: String(obj.current_stage || '—'),
        currentAttempt: Number(obj.current_attempt ?? 1),
        maxRetry: Number(obj.max_retry ?? 1),
        blockedReason: obj.blocked_reason || null,
        escalationPending: !!(obj.escalation_pack && obj.escalation_pack !== null),
      });
    } catch {
      stale++;
      items.push({ workId: id, level: '—', status: 'stale', currentStage: '—', currentAttempt: 1, maxRetry: 1, blockedReason: 'pipeline-status.json parse failed', escalationPending: false });
    }
  }
  const blockedCount = items.filter((i) => i.status === 'blocked' || i.escalationPending).length;
  return { items, blockedCount, stale };
}

function renderPipelinePanel(pipeline) {
  if (!pipeline || pipeline.items.length === 0) return '';
  const rows = pipeline.items.map((i) => {
    const noteParts = [];
    if (i.status === 'blocked') noteParts.push('<span class="pipe-blocked">awaiting Manager</span>');
    if (i.escalationPending) noteParts.push('<span class="pipe-blocked">escalation pending</span>');
    if (i.currentAttempt > 1) noteParts.push(`retry ${i.currentAttempt - 1}/${i.maxRetry}`);
    if (i.status === 'stale') noteParts.push('<span class="pipe-blocked">stale json</span>');
    const note = noteParts.length ? noteParts.join(' · ') : '<span class="muted">—</span>';
    const statusCls = (i.status === 'blocked' || i.escalationPending) ? 'st-blocked' : (i.status === 'done' ? 'st-done' : 'st-progress');
    return `<tr class="${statusCls}">
      <td><code>${escapeHtml(i.workId)}</code></td>
      <td>${escapeHtml(i.level)}</td>
      <td>${escapeHtml(i.status)}</td>
      <td>${escapeHtml(i.currentStage)}</td>
      <td>${note}</td>
    </tr>`;
  }).join('');
  return `<section class="panel">
    <div class="panel-head"><span class="tag">[05]</span><h2>Pipeline Status · 工单清单</h2></div>
    <div class="panel-body">
      <table class="pipe-tbl">
        <thead><tr><th>Work ID</th><th>Level</th><th>Status</th><th>Stage</th><th>Note</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function renderMilestoneStrip(milestones) {
  if (milestones.length === 0) return '';
  return `<div class="ms-strip">${milestones.map((m) => `
    <div class="ms-card ${statusClass(m.status)}">
      <div class="ms-head"><span class="led"></span><span class="ms-id">${escapeHtml(m.id)}</span><span class="ms-status">${escapeHtml(m.status)}</span></div>
      <div class="ms-title">${escapeHtml(m.title)}</div>
      <div class="ms-diff">${m.diff ? escapeHtml(m.diff) : '<span class="muted">（无差量描述）</span>'}</div>
    </div>`).join('')}</div>`;
}

const TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__BOARD_TITLE__</title>
  <style>
    /* 视觉体系：作战大屏模式（暗色） */
    :root {
      --brand: #E31837;
      --brand-glow: #FF4D5E;
      --bg: #0B0F1A;
      --bg-grid: rgba(120, 140, 180, 0.04);
      --surface: #141B2D;
      --surface-2: #1B2438;
      --border: #252D40;
      --border-strong: #344058;
      --text: #E8ECF4;
      --text-2: #9CA3B4;
      --text-3: #6B7385;
      --success: #36D399;
      --warning: #FFC857;
      --error: #FF5566;
      --info: #57A6F5;
      --idle: #6B7385;
      --radius: 6px;
      --radius-lg: 8px;
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
    * { box-sizing: border-box; }
    html { font-feature-settings: "tnum" 1, "lnum" 1; }
    body {
      font-family: Inter, "Noto Sans SC", "Source Han Sans SC", "PingFang SC",
        -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background:
        linear-gradient(0deg, var(--bg-grid) 1px, transparent 1px) 0 0 / 100% 48px,
        linear-gradient(90deg, var(--bg-grid) 1px, transparent 1px) 0 0 / 48px 100%,
        var(--bg);
      color: var(--text);
      margin: 0;
      padding: 0 0 64px;
      line-height: 1.55;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }
    .mono {
      font-family: "JetBrains Mono", "Fira Code", ui-monospace, Menlo, Consolas, monospace;
      letter-spacing: 0;
    }
    /* === Command Bar (top) === */
    .cmd-bar {
      position: sticky; top: 0; z-index: 50;
      background: linear-gradient(180deg, rgba(11,15,26,0.96), rgba(11,15,26,0.88));
      backdrop-filter: blur(6px);
      border-bottom: 1px solid var(--border);
    }
    .cmd-bar::before {
      content: ""; display: block; height: 3px; background: var(--brand);
    }
    .cmd-bar-inner {
      max-width: 1440px; margin: 0 auto;
      padding: 14px 32px;
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    }
    .cmd-title {
      font-size: 13px; font-weight: 600;
      letter-spacing: 0.16em; color: var(--text);
      display: flex; align-items: center; gap: 10px;
    }
    .cmd-title .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--brand); box-shadow: 0 0 0 3px rgba(227,24,55,0.25);
      animation: pulse 1.8s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 3px rgba(227,24,55,0.25); }
      50% { box-shadow: 0 0 0 6px rgba(227,24,55,0.05); }
    }
    .cmd-subtitle {
      font-size: 12px; color: var(--text-3); letter-spacing: 0.08em;
    }
    .cmd-spacer { flex: 1; }
    .cmd-meta {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 11px; color: var(--text-2);
      letter-spacing: 0.04em;
    }
    .cmd-meta b { color: var(--text); font-weight: 500; }

    /* === Main container === */
    .wrap { max-width: 1440px; margin: 0 auto; padding: 24px 32px 0; }

    /* === KPI row === */
    .kpi-row {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
      margin-bottom: 24px;
    }
    .kpi {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 16px 14px 20px;
      position: relative;
      overflow: hidden;
    }
    .kpi::before {
      content: ""; position: absolute; left: 0; top: 0; bottom: 0;
      width: 3px; background: var(--idle);
    }
    .kpi.st-progress::before, .kpi.st-blocked::before { background: var(--error); }
    .kpi.st-ready::before, .kpi.st-contract::before, .kpi.st-info::before { background: var(--info); }
    .kpi.st-demo::before { background: var(--warning); }
    .kpi.st-prod::before, .kpi.st-done::before { background: var(--success); }
    .kpi.st-planned::before, .kpi.st-idle::before { background: var(--idle); }
    .kpi-label {
      font-size: 10px; font-weight: 600; letter-spacing: 0.12em;
      color: var(--text-3); text-transform: uppercase;
      margin-bottom: 8px;
    }
    .kpi-value {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 26px; font-weight: 600;
      color: var(--text);
      line-height: 1.1; letter-spacing: -0.01em;
      margin-bottom: 4px;
    }
    .kpi-sub { font-size: 12px; color: var(--text-2); margin-bottom: 8px; }
    .kpi-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 8px 2px 6px;
      border-radius: 999px;
      font-size: 11px; font-weight: 500;
      background: rgba(108,115,133,0.12);
      color: var(--text-2);
      border: 1px solid var(--border);
    }
    .led {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--idle);
      box-shadow: 0 0 0 0 transparent;
    }
    .st-progress .led { background: var(--error); animation: led-pulse 1.4s ease-in-out infinite; }
    .st-progress .kpi-pill { color: var(--error); border-color: rgba(255,85,102,0.35); background: rgba(255,85,102,0.08); }
    .st-blocked .led { background: var(--error); }
    .st-blocked .kpi-pill { color: var(--error); border-color: rgba(255,85,102,0.35); background: rgba(255,85,102,0.08); }
    .st-ready .led { background: var(--info); }
    .st-ready .kpi-pill { color: var(--info); border-color: rgba(87,166,245,0.35); background: rgba(87,166,245,0.08); }
    .st-contract .led { background: var(--info); }
    .st-contract .kpi-pill { color: var(--info); border-color: rgba(87,166,245,0.35); background: rgba(87,166,245,0.08); }
    .st-demo .led { background: var(--warning); }
    .st-demo .kpi-pill { color: var(--warning); border-color: rgba(255,200,87,0.35); background: rgba(255,200,87,0.08); }
    .st-prod .led, .st-done .led { background: var(--success); }
    .st-prod .kpi-pill, .st-done .kpi-pill { color: var(--success); border-color: rgba(54,211,153,0.35); background: rgba(54,211,153,0.08); }
    .st-planned .led, .st-idle .led { background: var(--idle); }
    @keyframes led-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255,85,102,0.5); }
      50% { box-shadow: 0 0 0 6px rgba(255,85,102,0); }
    }

    /* === Panels === */
    .panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      margin-bottom: 16px;
      overflow: hidden;
    }
    .panel-head {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      background: var(--surface-2);
    }
    .panel-head h2 {
      font-size: 13px; font-weight: 600;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text); margin: 0;
    }
    .panel-head .tag {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 10px; color: var(--brand-glow);
      letter-spacing: 0.06em;
    }
    .panel-body { padding: 20px 24px; }

    /* === Hero (current active) === */
    .hero {
      border-left: 4px solid var(--brand);
    }
    .hero-active-head {
      display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap;
      margin-bottom: 4px;
    }
    .hero-active-id {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 24px; font-weight: 600; color: var(--text);
      letter-spacing: -0.01em;
    }
    .hero-active-name { font-size: 18px; color: var(--text-2); }

    /* === Milestone strip === */
    .ms-strip {
      display: grid; grid-template-columns: repeat(__MILESTONE_COUNT__, 1fr); gap: 12px;
      margin-bottom: 16px;
    }
    .ms-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 16px;
      position: relative;
    }
    .ms-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .ms-id {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 16px; font-weight: 600; color: var(--text);
    }
    .ms-status {
      margin-left: auto;
      font-size: 10px; font-weight: 600;
      letter-spacing: 0.1em; text-transform: uppercase;
      padding: 2px 8px; border-radius: 999px;
      background: rgba(108,115,133,0.12); color: var(--text-2);
      border: 1px solid var(--border);
    }
    .ms-card.st-contract .ms-status { color: var(--info); border-color: rgba(87,166,245,0.35); background: rgba(87,166,245,0.08); }
    .ms-card.st-demo .ms-status { color: var(--warning); border-color: rgba(255,200,87,0.35); background: rgba(255,200,87,0.08); }
    .ms-card.st-prod .ms-status, .ms-card.st-done .ms-status { color: var(--success); border-color: rgba(54,211,153,0.35); background: rgba(54,211,153,0.08); }
    .ms-card.st-progress .ms-status, .ms-card.st-blocked .ms-status { color: var(--error); border-color: rgba(255,85,102,0.35); background: rgba(255,85,102,0.08); }
    .ms-title { font-size: 13px; color: var(--text); margin-bottom: 6px; }
    .ms-diff { font-size: 12px; color: var(--text-2); line-height: 1.5; }
    .muted { color: var(--text-3); }

    /* === v5.1 Pipeline Status panel === */
    .pipe-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
    .pipe-tbl thead th {
      text-align: left; padding: 8px 10px;
      color: var(--text-3); font-size: 11px; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase;
      border-bottom: 1px solid var(--border);
    }
    .pipe-tbl tbody td { padding: 8px 10px; border-bottom: 1px solid rgba(108,115,133,0.12); color: var(--text); }
    .pipe-tbl tbody tr.st-blocked td { background: rgba(255,85,102,0.05); }
    .pipe-tbl tbody tr.st-done td { color: var(--text-2); }
    .pipe-blocked { color: var(--error); font-weight: 600; }

    /* === Generic content (markdown) === */
    .md h1 { font-size: 22px; margin: 20px 0 8px; color: var(--text); }
    .md h2 { font-size: 16px; margin: 18px 0 8px; color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 6px; }
    .md h3 { font-size: 14px; margin: 14px 0 6px; color: var(--text-2); font-weight: 600; }
    .md p { margin: 6px 0; color: var(--text); }
    .md ul, .md ol { padding-left: 20px; margin: 6px 0; }
    .md li { margin: 3px 0; color: var(--text); }
    .md li::marker { color: var(--text-3); }
    .md strong { color: var(--text); }
    .md em { color: var(--text-2); }
    .md a { color: var(--brand-glow); text-decoration: none; border-bottom: 1px dashed transparent; }
    .md a:hover { border-bottom-color: var(--brand-glow); }
    .md code {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      background: rgba(120,140,180,0.08);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 12.5px;
      color: var(--brand-glow);
      border: 1px solid var(--border);
    }
    .md pre {
      background: var(--bg);
      border: 1px solid var(--border);
      padding: 12px 16px;
      border-radius: var(--radius);
      overflow-x: auto; font-size: 12.5px;
    }
    .md pre code { background: transparent; border: 0; padding: 0; color: var(--text); }
    .md hr { border: 0; border-top: 1px solid var(--border); margin: 16px 0; }
    .md blockquote {
      margin: 8px 0; padding: 8px 14px;
      border-left: 3px solid var(--border-strong);
      background: rgba(120,140,180,0.04);
      color: var(--text-2); font-size: 13px;
    }
    .md table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12.5px; }
    .md th, .md td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    .md th {
      background: var(--bg); color: var(--text-3);
      font-weight: 500; font-size: 11px; letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .md tr:hover td { background: rgba(120,140,180,0.03); }

    /* === Customer-visible timeline === */
    .cv-item { padding: 12px 0; border-bottom: 1px dashed var(--border); }
    .cv-item:last-child { border-bottom: 0; }

    /* === Details/Queue === */
    details.panel summary {
      cursor: pointer;
      display: flex; align-items: center; gap: 10px;
      padding: 14px 20px;
      border-bottom: 1px solid transparent;
      background: var(--surface-2);
      list-style: none;
      font-size: 13px; font-weight: 600;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text);
    }
    details.panel summary::-webkit-details-marker { display: none; }
    details.panel summary::before {
      content: "▸"; color: var(--brand-glow);
      transition: transform 150ms ease-out;
      font-size: 14px;
    }
    details.panel[open] summary::before { transform: rotate(90deg); }
    details.panel[open] summary { border-bottom-color: var(--border); }
    details.panel .panel-body { padding: 20px 24px; }

    /* === Responsive === */
    @media (max-width: 1024px) {
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .ms-strip { grid-template-columns: 1fr; }
    }
    @media (max-width: 640px) {
      .cmd-bar-inner, .wrap { padding-left: 16px; padding-right: 16px; }
      .kpi-row { grid-template-columns: 1fr; }
      .panel-body { padding: 16px; }
      .hero-active-id { font-size: 20px; }
    }
  </style>
</head>
<body>
  <header class="cmd-bar">
    <div class="cmd-bar-inner">
      <div class="cmd-title"><span class="dot" aria-hidden="true"></span>__BRAND__</div>
      <div class="cmd-subtitle">__SUBTITLE__</div>
      <div class="cmd-spacer"></div>
      <div class="cmd-meta">RENDERED <b>__RENDERED_STAMP__</b> · SOURCE <b>state/*.md</b></div>
    </div>
  </header>

  <main class="wrap">
    __KPI__

    <section class="panel hero">
      <div class="panel-head"><span class="tag">[01]</span><h2>当前在做</h2></div>
      <div class="panel-body md">__HERO__</div>
    </section>

    <section class="panel">
      <div class="panel-head"><span class="tag">[02]</span><h2>里程碑 · __MILESTONE_HEADING__</h2></div>
      <div class="panel-body">
        __MILESTONE_STRIP__
        <div class="md">__ROADMAP__</div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><span class="tag">[03]</span><h2>最近 5 条客户可感知变化</h2></div>
      <div class="panel-body md">__RECENT_CV__</div>
    </section>

    <details class="panel">
      <summary><span class="tag">[04]</span>完整 Work Queue</summary>
      <div class="panel-body md">__QUEUE__</div>
    </details>

    __PIPELINE_PANEL__
  </main>
</body>
</html>
`;

export async function renderBoard({ stateDir, outPath, config }) {
  if (!config) throw new Error('renderBoard 需要传入 config（来自 loadConfig）');
  const WORK_ID_LOOSE = makeWorkIdLoosePattern(config); // 如 "IS-(?:\\d{6}-\\d{6}-[0-9a-z]{2}|\\d+)"
  const WORK_ID_STRICT = makeWorkIdRegex(config);

  for (const f of STATE_FILES) {
    if (!existsSync(join(stateDir, f))) {
      throw new Error(`缺少 state 文件: ${join(stateDir, f)}`);
    }
  }

  const active = readFileSync(join(stateDir, 'active.md'), 'utf8');
  const queue = readFileSync(join(stateDir, 'queue.md'), 'utf8');
  const roadmap = readFileSync(join(stateDir, 'roadmap.md'), 'utf8');
  const cv = readFileSync(join(stateDir, 'customer-visible.md'), 'utf8');

  // 段落顺序按 (日期 desc, workId desc) 排序，确保 cvSegments[0] 始终是最新一轮 Done。
  const splitRe = new RegExp(`^## (?=\\d{4}-\\d{2}-\\d{2} · ${WORK_ID_LOOSE} Done)`, 'm');
  const filterRe = new RegExp(`^\\d{4}-\\d{2}-\\d{2} · ${WORK_ID_LOOSE} Done`);
  const sortRe = new RegExp(`^##\\s+(\\d{4}-\\d{2}-\\d{2})\\s+·\\s+(${WORK_ID_LOOSE})`);
  const cvSegments = cv.split(splitRe)
    .filter((s) => filterRe.test(s))
    .map((s) => `## ${s}`)
    .sort((a, b) => {
      const pa = a.match(sortRe);
      const pb = b.match(sortRe);
      if (!pa || !pb) return 0;
      if (pa[1] !== pb[1]) return pb[1].localeCompare(pa[1]);
      return pb[2].localeCompare(pa[2]);
    });

  if (cvSegments.length === 0) {
    console.warn(`[render-board] warning: customer-visible.md 不含任何 Done 段，HERO 上一轮出产将留空。`);
  }

  const activeIdRe = new RegExp(`^-\\s*ID:\\s*(${WORK_ID_LOOSE})`, 'm');
  const activeIdMatch = active.match(activeIdRe);
  const activeId = activeIdMatch ? activeIdMatch[1] : null;
  const isIdle = activeIsIdle(active);

  let heroHtml;
  if (isIdle) {
    const activeFieldsRaw = parseActive(active);
    const lastCommit = activeFieldsRaw.lastCommit && activeFieldsRaw.lastCommit !== '—'
      ? activeFieldsRaw.lastCommit
      : null;
    const currentStatus = extractCurrentStatusSection(active);
    const parts = [];
    parts.push(`<p class="muted"><strong>当前无 active work item</strong>·等待下一轮 promote / 启动${lastCommit ? `·Last commit: <code>${escapeHtml(lastCommit)}</code>` : ''}</p>`);
    if (currentStatus) parts.push(`<h3>上一轮成果总结</h3>${marked.parse(currentStatus)}`);
    if (cvSegments[0]) parts.push(`<h3>上一轮客户可感知变化</h3>${marked.parse(cvSegments[0])}`);
    heroHtml = parts.join('');
  } else {
    heroHtml = marked.parse(active) +
      (cvSegments[0] ? `<h3>上一轮出产</h3>${marked.parse(cvSegments[0])}` : '');
  }

  if (activeId) {
    if (!heroHtml.includes(activeId)) {
      throw new Error(`HERO 渲染后未找到 active ID ${activeId}，渲染异常`);
    }
  }

  const recentCvHtml = cvSegments.slice(0, 5).map((s) => `<div class="cv-item">${marked.parse(s)}</div>`).join('') ||
    '<p class="muted">（暂无客户可感知变化记录）</p>';

  const activeFields = parseActive(active);
  const milestones = parseMilestones(roadmap, config.milestones);
  const readyCount = countReadyInQueue(queue, WORK_ID_LOOSE);
  const queueStats = parseQueueStats(queue, WORK_ID_STRICT);
  const shipment = lastShipment(cvSegments, WORK_ID_LOOSE);

  // v5.1: 扫 work/*/receipts/pipeline-status.json
  const devRoot = dirname(stateDir);
  const receiptsDir = config.pipeline?.receiptsDir || 'receipts';
  const pipeline = scanPipelineStatus(devRoot, receiptsDir);

  const kpiHtml = renderKpi({ active: activeFields, readyCount, milestones, shipment, queueStats, pipeline });
  const msStripHtml = renderMilestoneStrip(milestones);
  const pipelinePanelHtml = renderPipelinePanel(pipeline);

  const brand = `${config.projectName.toUpperCase()} · BOARD`;
  const milestoneHeading = config.milestones.length > 0 ? config.milestones.join(' / ') : '（未配置里程碑）';
  const milestoneCount = Math.max(1, Math.min(6, config.milestones.length || 1));

  const html = TEMPLATE
    .replaceAll('__BOARD_TITLE__', escapeHtml(config.boardTitle))
    .replaceAll('__BRAND__', escapeHtml(brand))
    .replaceAll('__SUBTITLE__', escapeHtml(config.boardTitle))
    .replaceAll('__MILESTONE_HEADING__', escapeHtml(milestoneHeading))
    .replaceAll('__MILESTONE_COUNT__', String(milestoneCount))
    .replace('__KPI__', kpiHtml)
    .replace('__HERO__', heroHtml)
    .replace('__MILESTONE_STRIP__', msStripHtml)
    .replace('__ROADMAP__', marked.parse(roadmap))
    .replace('__RECENT_CV__', recentCvHtml)
    .replace('__QUEUE__', marked.parse(queue))
    .replace('__PIPELINE_PANEL__', pipelinePanelHtml)
    .replace('__RENDERED_STAMP__', nowStamp());

  writeFileSync(outPath, html);
  return { activeId, cvCount: cvSegments.length, outPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const devRoot = inferDevRoot();
  const stateDir = process.env.STATE_DIR || join(devRoot, 'state');
  const outPath = process.env.BOARD_OUT || join(devRoot, 'BOARD.html');
  try {
    const config = await loadConfig({ devRoot });
    const { activeId, cvCount, outPath: o } = await renderBoard({ stateDir, outPath, config });
    console.log(`[render-board] OK · active=${activeId} · cv-segments=${cvCount} · out=${o}`);
  } catch (err) {
    console.error(`[render-board] ERROR: ${err.message}`);
    process.exit(1);
  }
}
