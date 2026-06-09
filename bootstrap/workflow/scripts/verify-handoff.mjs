#!/usr/bin/env node
// 主线 thread 收到 sub-agent return 后跑一遍：交叉验证工单是否真的按
// RUNBOOK §3 / §7 翻档完整。是 gate:handoff 的核心。
//
// 检查项（按 RUNBOOK §7 状态更新规则）：
//   1. queue.md 中 <work-id> status = Done + commit hash 合法 + 完成日期合法
//   2. active.md Status = Idle（exactly-one 复位）
//   3. customer-visible.md 末尾有 ## YYYY-MM-DD · <work-id> Done 段（含两条 bullet）
//   4. b2r-process/work/<work-id>/{spec,plan}.md 已存在（L0 工单跳过——读 0-triage.json.level）
//   5. BOARD.html 的 mtime 比所有 state/*.md 都新（说明已 render:board）
//   6. validate-state 整体通过（兜底）
//   7. v5.1: pipeline-status.json status=done 且 escalation_pack=null（如 receipt 目录存在）
//   8. v5.5: UI 工单（work/<id>/ui/ 有 mockup 且 config.ui 已配置）必须有 3.5-ui-fidelity.json
//      且 verdict=PASS，或带显式 deferred_to_backlog / env-blocked 证据——render-diff 与测试绿并列必要
//
// 用法：
//   node workflow/scripts/verify-handoff.mjs <work-id>
//   node workflow/scripts/verify-handoff.mjs <work-id> --json
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateState } from './validate-state.mjs';
import { loadConfig, inferDevRoot, makeWorkIdRegex, makeWorkIdPattern, workItemSlug, isMainModule } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMIT_HASH_RE = /^[0-9a-f]{7,40}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseQueueRow(workId, queueMd) {
  const lines = queueMd.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 8 || cells[0] !== workId) continue;
    return {
      workId: cells[0], name: cells[1], status: cells[2], milestone: cells[3],
      spec: cells[4], plan: cells[5], commit: cells[6], finishedAt: cells[7],
    };
  }
  return null;
}

function findField(md, key) {
  const m = md.match(new RegExp('^-\\s*' + key + ':\\s*(.+)$', 'm'));
  return m ? m[1].trim() : null;
}

// v5.5: 工单是否产出过 mockup。约定：mockup 是 work/<slug>/ui/ 下的 depth-1 文件
// （如 survey-list.html、_chrome.css）；render-diff 截图落在子目录 impl-shots/。
// depth-1 有任意常规文件 → 这是一条出过设计 mockup 的 UI 工单。
function hasMockups(uiDir) {
  if (!existsSync(uiDir)) return false;
  try {
    return readdirSync(uiDir, { withFileTypes: true }).some((e) => e.isFile());
  } catch {
    return false;
  }
}

function findCvSegment(cvMd, workId, workIdPattern) {
  const lines = cvMd.split('\n');
  // v5.1: Done 后允许任意尾随内容（如 "Done（L0 trivial · Manager Override accept-override）"）
  // 用 \b word boundary 防止误匹配 "Done123" 这种连写
  const headRe = new RegExp(`^##\\s+(\\d{4}-\\d{2}-\\d{2})\\s+·\\s+${workId}\\s+Done\\b.*$`);
  const nextHeadRe = new RegExp(`^##\\s+\\d{4}-\\d{2}-\\d{2}\\s+·\\s+${workIdPattern}\\s+Done`);
  let start = -1;
  let date = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headRe);
    if (m) { start = i; date = m[1]; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextHeadRe.test(lines[i])) { end = i; break; }
  }
  const body = lines.slice(start + 1, end).join('\n');
  const bullets = (body.match(/^\s*-\s+/gm) || []).length;
  return { date, body, bulletCount: bullets };
}

export function verifyHandoff({ stateDir, workDir, boardPath, workId, config }) {
  if (!config) throw new Error('verifyHandoff 需要传入 config');
  const WORK_ID_RE = makeWorkIdRegex(config);
  const WORK_ID_PATTERN = makeWorkIdPattern(config);
  const WORK_ID_LABEL = WORK_ID_PATTERN;

  const checks = [];
  const pass = (name, detail) => checks.push({ name, ok: true, detail });
  const fail = (name, detail) => checks.push({ name, ok: false, detail });

  if (!WORK_ID_RE.test(workId)) {
    fail('workId 格式', `"${workId}" 不符合 ${WORK_ID_LABEL}`);
    return { ok: false, checks };
  }

  // v5.2: 先读 queue.md，从 row.name 推 slugDir，再算 workSubdir
  const queuePath = join(stateDir, 'queue.md');
  if (!existsSync(queuePath)) {
    fail('queue.md 存在', `${queuePath} 不存在`);
    return { ok: false, checks };
  }
  const queueMd = readFileSync(queuePath, 'utf8');
  const row = parseQueueRow(workId, queueMd);

  // 推断 slugDir：能从 row.name 算出新结构目录；legacy 项目（v5.1 之前）退化到 work/<workId>/
  const receiptsDir = config.pipeline?.receiptsDir || 'receipts';
  const specsDir = config.pipeline?.specsDir || 'specs';
  const devRoot = dirname(stateDir);
  const slugDir = row ? workItemSlug({ workId, title: row.name }) : workId;
  const workSubdirNew = join(workDir, slugDir);
  const workSubdirLegacy = join(workDir, workId);
  const workSubdir = existsSync(workSubdirNew) ? workSubdirNew
    : (existsSync(workSubdirLegacy) ? workSubdirLegacy : workSubdirNew);
  const triagePath = join(workSubdir, receiptsDir, '0-triage.json');
  let level = null;
  if (existsSync(triagePath)) {
    try {
      const triage = JSON.parse(readFileSync(triagePath, 'utf8'));
      if (typeof triage.level === 'string') level = triage.level;
    } catch { /* parse fail → 视为无 level */ }
  }

  // Check 1: queue.md（继续后续 row 检查）
  if (!row) {
    fail('queue.md 含工单行', `${workId} 不在 queue.md 表中`);
  } else {
    if (row.status !== 'Done') fail('queue Status', `${workId} Status="${row.status}"，应为 Done`);
    else pass('queue Status', 'Done');
    const commit = row.commit.replace(/^`|`$/g, '');
    if (!COMMIT_HASH_RE.test(commit)) fail('queue commit hash', `"${row.commit}" 不符合 hex hash（7-40 位）`);
    else pass('queue commit hash', commit);
    if (!ISO_DATE_RE.test(row.finishedAt)) fail('queue 完成日期', `"${row.finishedAt}" 不符合 YYYY-MM-DD`);
    else pass('queue 完成日期', row.finishedAt);
    if (row.spec === '—' || row.plan === '—') {
      // v5.1: L0 工单跳过 spec/plan 路径检查（与 validate-state.mjs / Check 4 保持一致）
      if (level === 'L0') {
        pass('queue spec/plan 路径', '(L0 跳过 — direct-fix 路径无 spec/plan)');
      } else {
        fail('queue spec/plan 路径', '不能为 "—"');
      }
    } else {
      pass('queue spec/plan 路径', `${row.spec} / ${row.plan}`);
    }
  }

  // Check 2: active.md 翻 Idle
  const activePath = join(stateDir, 'active.md');
  if (!existsSync(activePath)) fail('active.md 存在', `${activePath} 不存在`);
  else {
    const activeMd = readFileSync(activePath, 'utf8');
    const statusRaw = findField(activeMd, 'Status');
    const status = statusRaw ? statusRaw.split(/[（(]/)[0].trim() : '';
    const id = findField(activeMd, 'ID');
    if (status === 'Idle' && id === '—') pass('active.md 翻 Idle', 'Status=Idle / ID=—');
    else fail('active.md 翻 Idle', `当前 Status="${status}" / ID="${id}"，应为 Idle / —`);
  }

  // Check 3: customer-visible.md 含 Done 段
  const cvPath = join(stateDir, 'customer-visible.md');
  if (!existsSync(cvPath)) fail('customer-visible.md 存在', `${cvPath} 不存在`);
  else {
    const cvMd = readFileSync(cvPath, 'utf8');
    const seg = findCvSegment(cvMd, workId, WORK_ID_PATTERN);
    if (!seg) fail('customer-visible 段', `未找到 "## YYYY-MM-DD · ${workId} Done" 段`);
    else {
      pass('customer-visible 段', `${seg.date} · ${seg.bulletCount} bullets`);
      if (seg.bulletCount < 2) fail('customer-visible bullet 数', `仅 ${seg.bulletCount} 条，应有 ≥2 条（客户可感知 / Internal-only）`);
    }
  }

  // Check 4: spec (specs/<slugDir>.md) + plan (work/<slugDir>/plan.md) 存在
  // v5.1: L0 工单跳过——L0 路径不产生 spec/plan，只有 0-triage.json + 5-handoff.json
  // v5.2: spec 上移到 specs/<slugDir>.md；plan 留在 work/<slugDir>/plan.md
  // 兼容 v5.1 之前的 work/<workId>/{spec,plan}.md legacy 结构
  if (level === 'L0') {
    pass('spec 文件存在', '(L0 跳过 — direct-fix 路径无 spec)');
    pass('plan 文件存在', '(L0 跳过 — direct-fix 路径无 plan)');
  } else {
    const specPathNew = join(devRoot, specsDir, `${slugDir}.md`);
    const specPathLegacy = join(workSubdir, 'spec.md');
    const specPath = existsSync(specPathNew) ? specPathNew
      : (existsSync(specPathLegacy) ? specPathLegacy : specPathNew);
    if (!existsSync(specPath)) fail('spec 文件存在', `${specPathNew}（也未在 legacy ${specPathLegacy} 中找到）`);
    else pass('spec 文件存在', specPath);

    const planPath = join(workSubdir, 'plan.md');
    if (!existsSync(planPath)) fail('plan 文件存在', planPath);
    else pass('plan 文件存在', planPath);
  }

  // Check 5: BOARD.html mtime 比 state/*.md 都新
  if (!existsSync(boardPath)) fail('BOARD.html 存在', boardPath);
  else {
    const boardMtime = statSync(boardPath).mtimeMs;
    const stateFiles = ['active.md', 'queue.md', 'roadmap.md', 'customer-visible.md'];
    const stale = [];
    for (const f of stateFiles) {
      const p = join(stateDir, f);
      if (!existsSync(p)) continue;
      const stMtime = statSync(p).mtimeMs;
      if (stMtime > boardMtime) stale.push(`${f} (Δ=${Math.round((stMtime - boardMtime) / 1000)}s)`);
    }
    if (stale.length > 0) fail('BOARD.html 已 render', `state 文件比 BOARD 新：${stale.join(', ')}（请跑 npm run render:board）`);
    else pass('BOARD.html 已 render', `mtime ≥ 所有 state/*.md`);
  }

  // Check 6: validate-state 兜底
  const v = validateState({ stateDir, config });
  if (!v.ok) {
    const errs = v.issues.filter((i) => i.severity === 'error').map((i) => `${i.file}: ${i.msg}`);
    fail('validate-state 兜底', errs.join(' | '));
  } else {
    pass('validate-state 兜底', `${v.issues.length} warning, 0 error`);
  }

  // Check 7 (v5.1): pipeline-status.json status=done + no pending escalation
  const psPath = join(workSubdir, receiptsDir, 'pipeline-status.json');
  if (!existsSync(psPath)) {
    // pipeline-status.json 不存在视为"未走过 b2r pipeline"——legacy 工单兼容，通过
    pass('pipeline-status.json', '(不存在 — legacy 工单兼容跳过)');
  } else {
    try {
      const ps = JSON.parse(readFileSync(psPath, 'utf8'));
      if (ps.status !== 'done') {
        fail('pipeline-status.json', `status="${ps.status}"，handoff 时应为 "done"`);
      } else if (ps.escalation_pack && ps.escalation_pack !== null) {
        fail('pipeline-status.json', `仍含 pending escalation_pack；Manager Override 必须先 resolve`);
      } else {
        pass('pipeline-status.json', `status=done · no pending escalation`);
      }
    } catch (err) {
      fail('pipeline-status.json', `parse failed: ${err.message}`);
    }
  }

  // Check 8 (v5.5): UI 还原度硬闸——有 mockup 的工单必须过 render-diff 闸
  // render-diff 通过与测试绿是并列必要条件，杜绝「测试绿但屏幕上不像」一路绿到 handoff。
  // 仅当 config.ui 已配置且本工单产出过 mockup 时强制；纯后端/CLI（无 config.ui 或无 mockup）跳过，零成本。
  if (level === 'L0') {
    pass('UI fidelity 闸', '(L0 跳过 — direct-fix 路径无 UI 设计线)');
  } else if (!config.ui) {
    pass('UI fidelity 闸', '(config.ui 未配置 — 非 UI 项目跳过)');
  } else if (!hasMockups(join(workSubdir, 'ui'))) {
    pass('UI fidelity 闸', '(本工单无 work/<id>/ui/ mockup — 非 UI 工单跳过)');
  } else {
    const fidPath = join(workSubdir, receiptsDir, '3.5-ui-fidelity.json');
    if (!existsSync(fidPath)) {
      fail('UI fidelity 闸', `${fidPath} 不存在；有 mockup 的工单必须过 Stage 3.5 render-diff 闸（实现页截图 ↔ mockup 并排比对），或显式登记 backlog 顺延`);
    } else {
      try {
        const fid = JSON.parse(readFileSync(fidPath, 'utf8'));
        const verdict = fid.reviewer_verdict;
        const deferred = fid.deferred_to_backlog === true && typeof fid.backlog_ref === 'string' && fid.backlog_ref.trim();
        const envBlocked = fid.reason_category === 'env-blocked' && typeof fid.blocked_evidence === 'string' && fid.blocked_evidence.trim();
        if (verdict === 'PASS') {
          pass('UI fidelity 闸', 'render-diff PASS');
        } else if (deferred) {
          pass('UI fidelity 闸', `差异显式顺延 backlog（${fid.backlog_ref}）`);
        } else if (envBlocked) {
          pass('UI fidelity 闸', `env-blocked（截图取不到，已 surface 环境前置缺口）`);
        } else {
          fail('UI fidelity 闸', `reviewer_verdict="${verdict}"（非 PASS）且无显式 deferred_to_backlog / env-blocked 证据；render-diff 差异未收口，不许 Done`);
        }
      } catch (err) {
        fail('UI fidelity 闸', `3.5-ui-fidelity.json parse failed: ${err.message}`);
      }
    }
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const workId = args.find((a) => !a.startsWith('--'));
  const asJson = args.includes('--json');
  if (!workId) {
    console.error('用法: node workflow/scripts/verify-handoff.mjs <work-id> [--json]');
    process.exit(2);
  }
  const devRoot = inferDevRoot();
  const stateDir = process.env.STATE_DIR || join(devRoot, 'state');
  const workDir = process.env.WORK_DIR || join(devRoot, 'work');
  const boardPath = process.env.BOARD_PATH || join(devRoot, 'BOARD.html');
  const config = await loadConfig({ devRoot });
  const { ok, checks } = verifyHandoff({ stateDir, workDir, boardPath, workId, config });
  if (asJson) {
    process.stdout.write(JSON.stringify({ ok, workId, checks }, null, 2) + '\n');
  } else {
    console.log(`[verify-handoff] ${workId}`);
    for (const c of checks) {
      const tag = c.ok ? '\x1b[32m  ✓\x1b[0m' : '\x1b[31m  ✗\x1b[0m';
      console.log(`${tag} ${c.name}: ${c.detail}`);
    }
    console.log('');
    if (ok) console.log(`[verify-handoff] OK · ${workId} 已正确 handoff`);
    else {
      const failed = checks.filter((c) => !c.ok).length;
      console.log(`[verify-handoff] FAIL · ${failed} 项未通过；handoff 未完成，请按 RUNBOOK §7 翻档`);
    }
  }
  process.exit(ok ? 0 : 1);
}
