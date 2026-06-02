#!/usr/bin/env node
// validate-pipeline-status · v5.1
//
// 校验 b2r-process/work/<id>/<receiptsDir>/pipeline-status.json 的 schema。
// 由 blueprint2real skill 维护，确保主线 thread 与 sub-agent 之间的
// pipeline 状态契约不静默漂移。
//
// 用法：
//   node workflow/scripts/validate-pipeline-status.mjs                  # 扫所有工单
//   node workflow/scripts/validate-pipeline-status.mjs IS-009           # 单工单
//   node workflow/scripts/validate-pipeline-status.mjs --json
//
// 退出码：
//   0 = 全部通过
//   1 = 至少 1 个工单 fail
//   2 = usage error

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, inferDevRoot, isMainModule } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALID_LEVELS = ['L0', 'L1', 'L2', 'L3'];
const VALID_STATUSES = ['in_progress', 'blocked', 'done'];
const VALID_STAGES = [
  '0-triage', '1-planner', '1.5-ui-anchor', '2.0-ui-design', '2a-spec', '2b-plan', '2c-review',
  '3-impl', '4-arch', '5-handoff',
];

function validatePipelineStatus(obj, workId, source) {
  const errs = [];

  const must = (cond, msg) => { if (!cond) errs.push(msg); };

  must(typeof obj === 'object' && obj !== null, 'pipeline-status.json 必须是对象');
  if (errs.length > 0) return { workId, source, ok: false, errors: errs };

  must(obj.workId === workId, `workId 字段 "${obj.workId}" 与目录名 "${workId}" 不一致`);
  must(VALID_LEVELS.includes(obj.level), `level 必须是 ${VALID_LEVELS.join('/')}; 当前 "${obj.level}"`);
  must(typeof obj.started_at === 'string' && obj.started_at.length > 0, 'started_at 必须是非空字符串');
  must(VALID_STAGES.includes(obj.current_stage), `current_stage 必须是 ${VALID_STAGES.join('/')}; 当前 "${obj.current_stage}"`);
  must(Number.isInteger(obj.current_attempt) && obj.current_attempt >= 1, `current_attempt 必须是 ≥1 的整数（v5.1 从 1 起算）`);
  must(Number.isInteger(obj.max_retry) && obj.max_retry >= 0, `max_retry 必须是 ≥0 的整数`);
  must(VALID_STATUSES.includes(obj.status), `status 必须是 ${VALID_STATUSES.join('/')}; 当前 "${obj.status}"`);
  must(obj.blocked_reason === null || typeof obj.blocked_reason === 'string', 'blocked_reason 必须是 string 或 null');
  must(obj.escalation_pack === null || typeof obj.escalation_pack === 'object', 'escalation_pack 必须是 object 或 null');
  must(Number.isInteger(obj.manager_override_count) && obj.manager_override_count >= 0, 'manager_override_count 必须是 ≥0 的整数');
  must(obj.last_feedback === null || typeof obj.last_feedback === 'object', 'last_feedback 必须是 object 或 null');

  // 语义交叉：blocked status 必须有 blocked_reason 或 escalation_pack
  if (obj.status === 'blocked') {
    must(
      (obj.blocked_reason && obj.blocked_reason.trim().length > 0) || (obj.escalation_pack !== null),
      'status=blocked 时必须填 blocked_reason 或 escalation_pack 其一'
    );
  }

  // done 状态不应有 pending escalation
  if (obj.status === 'done') {
    must(obj.escalation_pack === null, 'status=done 时 escalation_pack 必须为 null（pending 表示 Manager Override 未 resolve）');
  }

  // attempt 上限校验
  must(obj.current_attempt <= obj.max_retry + 1, `current_attempt (${obj.current_attempt}) 超出 max_retry+1 (${obj.max_retry + 1})——应触发 Manager Override`);

  return { workId, source, ok: errs.length === 0, errors: errs };
}

// v5.2: 从目录名提取 workId（slug 结构：`IS-001_<title-slug>` → `IS-001`；legacy：`IS-001` → `IS-001`）
function dirNameToWorkId(name) {
  const i = name.indexOf('_');
  return i === -1 ? name : name.slice(0, i);
}

export function scanAll({ devRoot, receiptsDir }) {
  const workDir = join(devRoot, 'work');
  if (!existsSync(workDir)) return [];
  const dirs = readdirSync(workDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const results = [];
  for (const id of dirs) {
    const psPath = join(workDir, id, receiptsDir, 'pipeline-status.json');
    if (!existsSync(psPath)) continue;
    const workId = dirNameToWorkId(id);
    let obj;
    try {
      obj = JSON.parse(readFileSync(psPath, 'utf8'));
    } catch (err) {
      results.push({ workId, source: psPath, ok: false, errors: [`JSON parse failed: ${err.message}`] });
      continue;
    }
    results.push(validatePipelineStatus(obj, workId, psPath));
  }
  return results;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const single = args.find((a) => !a.startsWith('--'));
  // 支持 DEV_ROOT 环境变量覆盖（用于 fixture / eval 测试）
  const devRoot = process.env.DEV_ROOT || inferDevRoot();
  const config = await loadConfig({ devRoot });
  const receiptsDir = config.pipeline?.receiptsDir || 'receipts';

  let results;
  if (single) {
    // 支持两种调用：传 workId（IS-001）→ 自动按 slug 前缀查找；或传完整目录名（IS-001_<slug>）
    const workDir = join(devRoot, 'work');
    let dirName = single;
    let psPath = join(workDir, dirName, receiptsDir, 'pipeline-status.json');
    if (!existsSync(psPath) && existsSync(workDir)) {
      const match = readdirSync(workDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .find((n) => n === single || n.startsWith(`${single}_`));
      if (match) {
        dirName = match;
        psPath = join(workDir, dirName, receiptsDir, 'pipeline-status.json');
      }
    }
    if (!existsSync(psPath)) {
      console.error(`[validate-pipeline-status] 不存在: ${psPath}`);
      process.exit(2);
    }
    const workId = dirNameToWorkId(dirName);
    try {
      const obj = JSON.parse(readFileSync(psPath, 'utf8'));
      results = [validatePipelineStatus(obj, workId, psPath)];
    } catch (err) {
      results = [{ workId, source: psPath, ok: false, errors: [`JSON parse failed: ${err.message}`] }];
    }
  } else {
    results = scanAll({ devRoot, receiptsDir });
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  if (asJson) {
    process.stdout.write(JSON.stringify({ ok: failCount === 0, total: results.length, results }, null, 2) + '\n');
  } else {
    if (results.length === 0) {
      console.log('[validate-pipeline-status] no pipeline-status.json found (新项目或所有工单未走过 b2r pipeline)');
    } else {
      for (const r of results) {
        if (r.ok) {
          console.log(`\x1b[32m  ✓\x1b[0m ${r.workId}`);
        } else {
          console.log(`\x1b[31m  ✗\x1b[0m ${r.workId}`);
          for (const e of r.errors) console.log(`     - ${e}`);
        }
      }
      console.log('');
      console.log(`[validate-pipeline-status] ${okCount}/${results.length} pass${failCount ? `, ${failCount} fail` : ''}`);
    }
  }

  process.exit(failCount === 0 ? 0 : 1);
}
