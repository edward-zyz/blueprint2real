#!/usr/bin/env node
// flake 基线 diff(O17)。把测试失败套件清单分成「相对基线新增(new,需举证)」与「基线内(known,预存 flake)」。
// 收敛回归只看 new 组,根治「每工单人肉减基线」浪费。
//
// 用法:
//   node workflow/scripts/regression-diff.mjs --failures "a.test.js,b.test.js"
//   node workflow/scripts/regression-diff.mjs --failures "..." --json
//   node workflow/scripts/regression-diff.mjs --add "x.test.js" --reason "port-race"
//
// MVP:不解析 jest/vitest 原始输出;主线从测试输出提取失败套件名以 --failures 传入。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule, inferDevRoot } from './config.mjs';

export function diffFailures(failures, baseline) {
  const known = new Set((baseline.suites || []).map((s) => s.name));
  return {
    new: failures.filter((f) => !known.has(f)),
    known: failures.filter((f) => known.has(f)),
  };
}

export function addToBaseline(baseline, name, reason, recordedAt) {
  const suites = (baseline.suites || []).slice();
  if (!suites.some((s) => s.name === name)) suites.push({ name, reason, recorded_at: recordedAt });
  return { ...baseline, suites };
}

function loadBaseline(stateDir) {
  const p = join(stateDir, 'flaky-baseline.json');
  if (!existsSync(p)) return { suites: [] };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { suites: [] }; }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const devRoot = inferDevRoot();
  const stateDir = process.env.STATE_DIR || join(devRoot, 'state');
  const baseline = loadBaseline(stateDir);

  const addName = get('--add');
  if (addName) {
    const reason = get('--reason') || 'unspecified';
    // recorded_at 由调用方注入(脚本环境禁用裸 new Date);未注入则留空。
    const recordedAt = process.env.NOW_ISO || '';
    const next = addToBaseline(baseline, addName, reason, recordedAt);
    writeFileSync(join(stateDir, 'flaky-baseline.json'), JSON.stringify(next, null, 2) + '\n');
    console.log(`[regression-diff] 已登记 flake: ${addName}（${reason}）· 基线共 ${next.suites.length} 条`);
    process.exit(0);
  }

  const failuresArg = get('--failures') || '';
  const failures = failuresArg.split(',').map((s) => s.trim()).filter(Boolean);
  const r = diffFailures(failures, baseline);
  if (asJson) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    console.log(`[regression-diff] new(需举证): ${r.new.join(', ') || '无'}`);
    console.log(`[regression-diff] known(预存 flake): ${r.known.join(', ') || '无'}`);
  }
  process.exit(r.new.length === 0 ? 0 : 1);
}
