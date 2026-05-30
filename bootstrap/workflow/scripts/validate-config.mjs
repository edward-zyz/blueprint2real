#!/usr/bin/env node
// validate-config · v5.2
// CLI + 库：加载并校验 workflow.config.mjs，把 ConfigError 多行字符串解析成结构化 errors。
//
// 用法：
//   node workflow/scripts/validate-config.mjs                              # 人类输出
//   node workflow/scripts/validate-config.mjs --json                       # JSON 输出
//   node workflow/scripts/validate-config.mjs --config /path/config.mjs    # 指定 config 路径
//   DEV_ROOT=/path node ...                                                # 用 env 指定 devRoot
//
// 退出码：0 = pass，1 = config 校验失败，2 = usage error / 文件不存在

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, inferDevRoot } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 解析 ConfigError.message 形如：
//   "workflow.config 校验失败:\n  - workIdPrefix 必须...\n  - workIdDigits 必须..."
function parseConfigError(msg) {
  const lines = String(msg).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- '));
  return lines.map((l) => {
    const text = l.slice(2);
    // 尝试从消息开头提取 field 名（如 "workIdPrefix 必须..."、"pipeline.maxRetry 必须..."）
    const m = text.match(/^([A-Za-z][A-Za-z0-9.]*)/);
    return { field: m ? m[1] : null, msg: text };
  });
}

export async function validateConfig({ devRoot, configPath } = {}) {
  try {
    const cfg = await loadConfig({ devRoot, configPath });
    return { ok: true, config: { ...cfg, _loadedFrom: cfg._loadedFrom }, errors: [] };
  } catch (e) {
    if (e && /校验失败/.test(e.message)) {
      return { ok: false, config: null, errors: parseConfigError(e.message) };
    }
    // 文件不存在 / import 出错等 → 上层 CLI 处理
    throw e;
  }
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--config') { opts.configPath = argv[i + 1]; i++; }
    else if (a.startsWith('--')) { /* ignore unknown */ }
  }
  return opts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv.slice(2));
  const devRoot = process.env.DEV_ROOT ? resolve(process.env.DEV_ROOT) : inferDevRoot();
  let result;
  try {
    result = await validateConfig({ devRoot, configPath: opts.configPath });
  } catch (e) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message, fatal: true }) + '\n');
    } else {
      console.error(`[validate-config] 致命错误: ${e.message}`);
    }
    process.exit(2);
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: result.ok, errors: result.errors, loadedFrom: result.config?._loadedFrom || null }) + '\n');
  } else if (result.ok) {
    console.log(`[validate-config] OK · ${result.config.workIdPrefix}-\\d{${result.config.workIdDigits}} · ${result.config.milestones.length} milestones · loaded from ${result.config._loadedFrom}`);
  } else {
    console.log(`[validate-config] FAIL · ${result.errors.length} errors:`);
    for (const err of result.errors) {
      console.log(`  - ${err.field ? `[${err.field}] ` : ''}${err.msg}`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}
