// 工作流配置加载器。
//
// 项目特有的值（编号前缀 / 里程碑 / 文档引用路径 / regression 命令 / BOARD 文案）
// 集中到 workflow.config.mjs，由本模块加载 + 提供 fallback default。
//
// 查找顺序：
//   1. 环境变量 WORKFLOW_CONFIG（绝对路径，CI / 测试用）
//   2. <devRoot>/workflow.config.mjs（工作流默认位置；devRoot = workflow/ 的父目录）
//   3. defaults（内置兜底，让脚本在 config 文件缺失时仍能跑）
//
// 任何脚本都应该走 `await loadConfig({ devRoot })` 而不是自行 import config 文件。

import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// === 默认值 ===

export const defaults = Object.freeze({
  // 工单编号
  workIdPrefix: 'WORK',
  workIdDigits: 3,

  // 里程碑（数组顺序 = 显示顺序；空数组表示项目不用里程碑）
  milestones: ['M0', 'M1', 'M2'],

  // 品牌文本（BOARD HTML / RUNBOOK / promote stub 用）
  projectName: 'project',
  boardTitle: 'BOARD · 项目状态作战大屏',

  // RUNBOOK §4 启动检查 + sub-agent boot template 中"项目文档"引用
  docsRefs: ['../CLAUDE.md', '../docs/'],

  // promote.mjs 生成的 spec/plan stub 中嵌入的 regression 命令
  // 每条独立运行，全部退出码 0 才算 regression 通过
  regressionCommands: [
    'npm test',
    'cd dev && npm test',
    'cd dev && npm run validate:state',
    'cd dev && npm run render:board',
  ],

  // blueprint2real skill 的 pipeline 行为参数（v5.1 新增）
  // 跨项目可调，blueprint2real skill 在派 sub-agent 时读这些值填充 prompt 占位
  pipeline: {
    // Gate fail 后自动 retry 上限（默认 1 = 最多重试 1 次，attempt > 2 升级 Manager Override）
    maxRetry: 1,
    // 累计 N 条 retro 条目主动 surface 给用户做体系反思
    retroSurfaceThreshold: 3,
    // work/<id>_<slug>/ 下 receipt 子目录名
    receiptsDir: 'receipts',
    // 长程 Spec 资产目录（v5.2+：spec.md 沉淀到 <devRoot>/<specsDir>/<id>_<slug>.md，
    // 与 work/<id>_<slug>/plan.md 分开存放，便于查阅）
    specsDir: 'specs',
  },
});

// === Schema 校验 ===

class ConfigError extends Error {}

function validate(config) {
  const errs = [];
  if (typeof config.workIdPrefix !== 'string' || !/^[A-Z][A-Z0-9]*$/.test(config.workIdPrefix)) {
    errs.push(`workIdPrefix 必须是大写字母开头的 ASCII 字符串（当前: ${JSON.stringify(config.workIdPrefix)}）`);
  }
  if (!Number.isInteger(config.workIdDigits) || config.workIdDigits < 1 || config.workIdDigits > 6) {
    errs.push(`workIdDigits 必须是 1-6 的整数（当前: ${JSON.stringify(config.workIdDigits)}）`);
  }
  if (!Array.isArray(config.milestones)) {
    errs.push(`milestones 必须是数组`);
  } else {
    for (const m of config.milestones) {
      if (typeof m !== 'string' || !m.trim()) errs.push(`milestone "${m}" 非法（须为非空字符串）`);
    }
  }
  if (typeof config.projectName !== 'string' || !config.projectName) errs.push('projectName 必须是非空字符串');
  if (typeof config.boardTitle !== 'string' || !config.boardTitle) errs.push('boardTitle 必须是非空字符串');
  if (!Array.isArray(config.docsRefs)) errs.push('docsRefs 必须是数组');
  if (!Array.isArray(config.regressionCommands)) errs.push('regressionCommands 必须是数组');

  // pipeline (v5.1 新增；缺省时由 defaults 填补)
  if (config.pipeline) {
    const p = config.pipeline;
    if (!Number.isInteger(p.maxRetry) || p.maxRetry < 0 || p.maxRetry > 5) {
      errs.push(`pipeline.maxRetry 必须是 0-5 的整数（当前: ${JSON.stringify(p.maxRetry)}）`);
    }
    if (!Number.isInteger(p.retroSurfaceThreshold) || p.retroSurfaceThreshold < 1) {
      errs.push(`pipeline.retroSurfaceThreshold 必须是正整数（当前: ${JSON.stringify(p.retroSurfaceThreshold)}）`);
    }
    if (typeof p.receiptsDir !== 'string' || !p.receiptsDir.trim() || /[\\/]/.test(p.receiptsDir)) {
      errs.push(`pipeline.receiptsDir 必须是非空且不含路径分隔符的字符串（当前: ${JSON.stringify(p.receiptsDir)}）`);
    }
    if (p.specsDir !== undefined) {
      if (typeof p.specsDir !== 'string' || !p.specsDir.trim() || /[\\/]/.test(p.specsDir)) {
        errs.push(`pipeline.specsDir 必须是非空且不含路径分隔符的字符串（当前: ${JSON.stringify(p.specsDir)}）`);
      }
    }
  } else {
    errs.push('pipeline 段必须存在（提示：从 defaults 合并；若手动覆盖时请保留全部三个字段或留空走 defaults）');
  }

  if (errs.length > 0) {
    throw new ConfigError(`workflow.config 校验失败:\n  - ${errs.join('\n  - ')}`);
  }
  return config;
}

// === 派生工具：根据 prefix + digits 生成 regex / 模板字符串 ===

export function makeWorkIdRegex({ workIdPrefix, workIdDigits }) {
  return new RegExp(`^${workIdPrefix}-\\d{${workIdDigits}}$`);
}

export function makeWorkIdPattern({ workIdPrefix, workIdDigits }) {
  // 用于 regex 中嵌入（不带 ^$ 锚点）
  return `${workIdPrefix}-\\d{${workIdDigits}}`;
}

export function makeWorkIdLoosePattern({ workIdPrefix }) {
  // 解析 customer-visible.md 等场景：编号可能在文中匹配，digits 不严格
  return `${workIdPrefix}-\\d+`;
}

export function formatWorkId({ workIdPrefix, workIdDigits }, n) {
  return `${workIdPrefix}-${String(n).padStart(workIdDigits, '0')}`;
}

// v5.2+: 把工单标题转成文件名安全的 slug
// 规则：
//   - 非法字符 / : ? * < > | " \ → 去掉
//   - 空白（含中文空格）→ -
//   - 连续 - → 单个 -
//   - 首尾 - 去掉
//   - 保留中文 / ASCII 字母数字
//   - 长度上限 80 字符（防 filesystem name too long）
export function slugifyTitle(title) {
  if (typeof title !== 'string') return '';
  let s = title.trim();
  // 去掉 filesystem 非法字符
  s = s.replace(/[\/:?*<>|"\\]/g, '');
  // 空白（含中文空格 　）→ -
  s = s.replace(/[\s　]+/g, '-');
  // 标点 . , ; ! ? 等替换为 - （保留可读性，避免文件名歧义）
  s = s.replace(/[，。；、！？]/g, '-');
  // 连续 - → 单个 -
  s = s.replace(/-+/g, '-');
  // 首尾 - 去掉
  s = s.replace(/^-+|-+$/g, '');
  // 长度上限
  if (s.length > 80) s = s.slice(0, 80).replace(/-+$/, '');
  return s;
}

// v5.2+: 工单目录/文件命名 helper
// workItemSlug({ workId, title }) = "IS-001_RUNBOOK-加-Manager-Override-接手段"
export function workItemSlug({ workId, title }) {
  const slug = slugifyTitle(title);
  if (!slug) return workId;  // 标题为空时退化为单纯 workId（罕见）
  return `${workId}_${slug}`;
}

// === Loader ===

export async function loadConfig({ devRoot, configPath } = {}) {
  const candidates = [];
  if (process.env.WORKFLOW_CONFIG) candidates.push(resolve(process.env.WORKFLOW_CONFIG));
  if (configPath) candidates.push(resolve(configPath));
  if (devRoot) candidates.push(join(resolve(devRoot), 'workflow.config.mjs'));

  let loaded = null;
  let loadedFrom = '<defaults>';
  for (const p of candidates) {
    if (existsSync(p)) {
      const mod = await import(pathToFileURL(p).href);
      loaded = mod.default || mod.config || mod;
      loadedFrom = p;
      break;
    }
  }

  const merged = mergeConfig(defaults, loaded || {});
  validate(merged);
  return Object.freeze({ ...merged, _loadedFrom: loadedFrom });
}

// 同步版（少数测试用例用得上；脚本主路径走 loadConfig async 版）
export function loadConfigSync({ override = {} } = {}) {
  const merged = mergeConfig(defaults, override);
  validate(merged);
  return Object.freeze({ ...merged, _loadedFrom: '<inline>' });
}

// pipeline 段是 object，需要深合并；其它顶层字段浅覆盖即可
function mergeConfig(base, override) {
  const out = { ...base, ...override };
  if (base.pipeline || override.pipeline) {
    out.pipeline = { ...(base.pipeline || {}), ...(override.pipeline || {}) };
  }
  return out;
}

// === devRoot 推断助手（脚本顶部直接用） ===

export function inferDevRoot() {
  // 优先级：
  //   1. process.env.DEV_ROOT（v5.1+：让 b2r-process/ 不复制 workflow/ 时通过 env 注入实际工作目录）
  //   2. __dirname/../..（workflow/scripts/ 的爷爷目录；只在脚本被复制到 target 时正确）
  if (process.env.DEV_ROOT) return resolve(process.env.DEV_ROOT);
  return resolve(__dirname, '..', '..');
}
