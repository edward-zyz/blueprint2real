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

import { existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// symlink-safe 的 "本模块是否被直接 node 执行" 判定。
// 旧写法 `import.meta.url === \`file://${process.argv[1]}\`` 在两种情况下会误判为 false，
// 导致脚本被直接运行时 main 块整个被跳过（exit 0、零输出、零副作用）：
//   1. 软链安装：argv[1] 是软链路径，import.meta.url 是 Node 解析软链后的真实路径，两者不等。
//   2. 路径含空格 / 非 ASCII：`file://` 字符串直拼未做 URL 编码。
// realpathSync 解开软链 + pathToFileURL 正确编码，两侧统一到真实路径的 file URL 再比。
export function isMainModule(importMetaUrl, invokedPath = process.argv[1]) {
  if (!invokedPath) return false;
  let real;
  try { real = realpathSync(invokedPath); } catch { real = invokedPath; }
  return importMetaUrl === pathToFileURL(real).href;
}

// === 默认值 ===

export const defaults = Object.freeze({
  // 工单编号
  workIdPrefix: 'WORK',
  workIdDigits: 3,
  idScheme: 'sequential',

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
  if (!['sequential', 'timestamp'].includes(config.idScheme)) {
    errs.push(`idScheme 必须是 "sequential" 或 "timestamp"（当前: ${JSON.stringify(config.idScheme)}）`);
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

  // Optional UI design lane. Missing `ui` means disabled. `designRefs` is optional:
  // when absent/empty, ui-designer must actively discover or synthesize an anchor.
  if (config.ui !== undefined) {
    const ui = config.ui;
    if (!ui || typeof ui !== 'object' || Array.isArray(ui)) {
      errs.push(`ui 必须是对象（当前: ${JSON.stringify(ui)}）`);
    } else {
      if (typeof ui.designSkill !== 'string' || !ui.designSkill.trim()) {
        errs.push(`ui.designSkill 必须是非空字符串（当前: ${JSON.stringify(ui.designSkill)}）`);
      }
      if (ui.designRefs !== undefined && (!Array.isArray(ui.designRefs) || ui.designRefs.some((p) => typeof p !== 'string' || !p.trim()))) {
        errs.push(`ui.designRefs 必须是字符串数组且元素非空；可缺省或空数组以启用自动发现（当前: ${JSON.stringify(ui.designRefs)}）`);
      }
      if (!Array.isArray(ui.uiPaths) || ui.uiPaths.some((p) => typeof p !== 'string' || !p.trim())) {
        errs.push(`ui.uiPaths 必须是非空字符串数组（当前: ${JSON.stringify(ui.uiPaths)}）`);
      }
      if (typeof ui.anchorPath !== 'string' || !ui.anchorPath.trim()) {
        errs.push(`ui.anchorPath 必须是非空字符串（当前: ${JSON.stringify(ui.anchorPath)}）`);
      } else {
        const normalized = ui.anchorPath.replace(/\\/g, '/');
        if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
          errs.push(`ui.anchorPath 不得是绝对路径或包含路径越界 ".."（当前: ${JSON.stringify(ui.anchorPath)}）`);
        }
      }
    }
  }

  // Optional milestone-level E2E acceptance lane. Missing `e2e` means disabled,
  // which lets library / CLI-only projects keep the per-ticket pipeline only.
  if (config.e2e !== undefined) {
    const e2e = config.e2e;
    if (!e2e || typeof e2e !== 'object' || Array.isArray(e2e)) {
      errs.push(`e2e 必须是对象（当前: ${JSON.stringify(e2e)}）`);
    } else {
      if (typeof e2e.verifySkill !== 'string' || !e2e.verifySkill.trim()) {
        errs.push(`e2e.verifySkill 必须是非空字符串（当前: ${JSON.stringify(e2e.verifySkill)}）`);
      }
      if (e2e.launch !== undefined && typeof e2e.launch !== 'string') {
        errs.push(`e2e.launch 必须是字符串或缺省（当前: ${JSON.stringify(e2e.launch)}）`);
      }
      if (!Array.isArray(e2e.e2eCommands) || e2e.e2eCommands.some((cmd) => typeof cmd !== 'string' || !cmd.trim())) {
        errs.push(`e2e.e2eCommands 必须是非空字符串数组（当前: ${JSON.stringify(e2e.e2eCommands)}）`);
      }
      if (typeof e2e.reportsDir !== 'string' || !e2e.reportsDir.trim()) {
        errs.push(`e2e.reportsDir 必须是非空字符串（当前: ${JSON.stringify(e2e.reportsDir)}）`);
      } else {
        const normalized = e2e.reportsDir.replace(/\\/g, '/');
        if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
          errs.push(`e2e.reportsDir 不得是绝对路径或包含路径越界 ".."（当前: ${JSON.stringify(e2e.reportsDir)}）`);
        }
      }
      if (!Number.isInteger(e2e.maxRerun) || e2e.maxRerun < 0 || e2e.maxRerun > 10) {
        errs.push(`e2e.maxRerun 必须是 0-10 的整数（当前: ${JSON.stringify(e2e.maxRerun)}）`);
      }
      if (e2e.unit !== undefined && !['milestone', 'group', 'both'].includes(e2e.unit)) {
        errs.push(`e2e.unit 必须是 "milestone" / "group" / "both"（当前: ${JSON.stringify(e2e.unit)}）`);
      }
    }
  }

  if (errs.length > 0) {
    throw new ConfigError(`workflow.config 校验失败:\n  - ${errs.join('\n  - ')}`);
  }
  return config;
}

// === 派生工具：根据 prefix + digits 生成 regex / 模板字符串 ===

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function timestampBodyPattern() {
  return '\\d{6}-\\d{6}-[0-9a-z]{2}';
}

export function makeWorkIdRegex({ workIdPrefix, workIdDigits }) {
  return new RegExp(`^${makeWorkIdPattern({ workIdPrefix, workIdDigits })}$`);
}

export function makeWorkIdPattern({ workIdPrefix, workIdDigits }) {
  // 用于 regex 中嵌入（不带 ^$ 锚点）
  const prefix = escapeRegExp(workIdPrefix);
  return `${prefix}-(?:${timestampBodyPattern()}|\\d{${workIdDigits},})`;
}

export function makeWorkIdLoosePattern({ workIdPrefix }) {
  // 解析 customer-visible.md 等场景：编号可能在文中匹配，digits 不严格
  const prefix = escapeRegExp(workIdPrefix);
  return `${prefix}-(?:${timestampBodyPattern()}|\\d+)`;
}

export function formatWorkId({ workIdPrefix, workIdDigits }, n) {
  return `${workIdPrefix}-${String(n).padStart(workIdDigits, '0')}`;
}

function formatLocalTimestamp(now) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) throw new Error(`now 不是合法 Date（当前: ${JSON.stringify(now)}）`);
  const pad = (n) => String(n).padStart(2, '0');
  return [
    String(d.getFullYear()).slice(-2),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
  ].join('') + '-' + [
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

function randomBase36Suffix(random) {
  const pick = () => {
    const raw = Number(random());
    const idx = Math.max(0, Math.min(BASE36.length - 1, Math.floor(raw * BASE36.length)));
    return BASE36[idx];
  };
  return `${pick()}${pick()}`;
}

export function mintWorkId(config, existingIds = [], now = new Date(), random = Math.random) {
  if (!config) throw new Error('mintWorkId 需要传入 config');
  const existing = new Set([...existingIds].map((id) => String(id)));
  const scheme = config.idScheme || 'sequential';

  if (scheme === 'sequential') {
    const re = new RegExp(`^${escapeRegExp(config.workIdPrefix)}-(\\d{${config.workIdDigits},})$`);
    let max = 0;
    for (const id of existing) {
      const m = id.match(re);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return formatWorkId(config, max + 1);
  }

  if (scheme === 'timestamp') {
    const stem = `${config.workIdPrefix}-${formatLocalTimestamp(now)}`;
    for (let attempt = 0; attempt < 4096; attempt++) {
      const candidate = `${stem}-${randomBase36Suffix(random)}`;
      if (!existing.has(candidate)) return candidate;
    }
    throw new Error(`mintWorkId 无法为 ${stem} 找到未占用尾缀`);
  }

  throw new Error(`未知 idScheme: ${scheme}`);
}

// per-submission E2E 单位编号：一次 b2r 提交 mint 的一批工单共享一个 group id。
// 形如 EG-260602-190312（本地时间戳，秒级）；同秒二次提交碰撞时追加 2 位 base36 尾缀去重
// （与 mintWorkId timestamp scheme 同构，防无人值守/CI 连发撞号）。
export function mintGroupId(now = new Date(), existingIds = [], random = Math.random) {
  const existing = new Set([...existingIds].map((id) => String(id)));
  const stem = `EG-${formatLocalTimestamp(now)}`;
  if (!existing.has(stem)) return stem;
  for (let attempt = 0; attempt < 4096; attempt++) {
    const candidate = `${stem}-${randomBase36Suffix(random)}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`mintGroupId 无法为 ${stem} 找到未占用尾缀`);
}

// v5.2+: 把工单标题转成文件名安全的 slug
// 规则：
//   - 非法字符 / : ? * < > | " \ → 去掉
//   - 其余非「字母 / 数字 / _」一律归一为分隔符 -（含空白、括号、标点、运算符，ASCII + 全角）
//   - 连续 - → 单个 -
//   - 首尾 - 去掉
//   - 保留所有 Unicode 字母（中文 / 带变音符拉丁 / 假名 / 谚文…）+ 数字 + _
//   - 长度上限 80 字符（防 filesystem name too long）
//
// 为什么是白名单而非逐个列黑名单（v5.3 回灌 IS-003/033/035 复发债）：
//   历史上标题含 ` + ` 或中文括号（）时 slug 不稳定——promote 与 verify-handoff 各自重算，
//   产出不一致（一个吞 +、一个留 -+-），导致 verify「spec/plan 文件存在」FAIL，需手工 git mv。
//   二者现已共用本函数（promote.mjs / verify-handoff.mjs 同 import workItemSlug），一处治本；
//   但若仍按黑名单逐个补特殊字符，总会漏。关键坑：`+` 是 regex 元字符，一旦漏进 slug，
//   下游任何拿 slug 拼 regex / grep 的地方都会炸。改用 `\p{L}\p{N}_` 白名单后，slug 只可能含
//   [字母 数字 _ -]，既文件名安全、又 regex 安全，标题用什么标点都稳定。
export function slugifyTitle(title) {
  if (typeof title !== 'string') return '';
  let s = title.trim();
  // 去掉 filesystem 非法字符（这些直接消失，不留分隔符，如 "C:" → "C"）
  s = s.replace(/[\/:?*<>|"\\]/g, '');
  // 其余一切非「Unicode 字母 / 数字 / 下划线」归一为分隔符 -
  // （空白含全角空格、() （） [] 【】、+ & . , ; ! ? 等标点运算符、emoji 等都落这）
  s = s.replace(/[^\p{L}\p{N}_]+/gu, '-');
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
  if (base.ui || override.ui) {
    out.ui = { ...(base.ui || {}), ...(override.ui || {}) };
    if (out.ui.designRefs === undefined) out.ui.designRefs = [];
  }
  if (base.e2e || override.e2e) {
    out.e2e = { ...(base.e2e || {}), ...(override.e2e || {}) };
    if (out.e2e.launch === undefined) out.e2e.launch = '';
    if (out.e2e.reportsDir === undefined) out.e2e.reportsDir = 'e2e';
    if (out.e2e.maxRerun === undefined) out.e2e.maxRerun = 2;
    if (out.e2e.unit === undefined) out.e2e.unit = 'milestone';
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
