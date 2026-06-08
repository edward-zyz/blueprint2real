#!/usr/bin/env node
// 工作流初始化器。读 workflow/templates/*，按 CLI 参数代入 config 字段，
// 在目标目录生成 state/config 文件；--bootstrap 模式还把完整 workflow/ 子树复制过去。
//
// === 普通模式（默认）===
// 假设目标目录已有 workflow/ 子树，只生成 state/* + config + AGENT_RUNBOOK：
//   - workflow.config.mjs
//   - AGENT_RUNBOOK.md
//   - state/active.md / queue.md / roadmap.md / customer-visible.md / retro.md
//
// === Bootstrap 模式（--bootstrap）===
// 给"完全空白"的新项目用：除生成上述文件外，还把 init.mjs 自己所在的整棵
// workflow/ 子树（scripts/ + templates/ + package.json）复制到目标目录，
// 并生成根 package.json（含 npm script 别名）。这样新项目可以直接
// `cd <target>/workflow && npm install`，然后 `npm run validate:state` 等命令立刻可用。
//
// 默认目录名（v5.1+）：b2r-process/
//   - bootstrap 模式无 --target 时默认 = <cwd>/b2r-process
//   - 普通模式无 --target 时默认 = workflow/ 的父目录（in-place 升级）
//
// 用法：
//   # 普通 init（已有 workflow/）：
//   node workflow/scripts/init.mjs --prefix APP --milestones M0,M1,M2 --project demo-app
//
//   # Bootstrap 完整新项目（从 skill bundle 调用）：
//   node /path/to/blueprint2real/bootstrap/workflow/scripts/init.mjs \
//        --bootstrap --prefix XX --milestones M0,M1,M2 --project newapp --target ./b2r-process
//
// 参数：
//   --bootstrap             完整 bootstrap 模式（额外复制 workflow/ 子树 + 生成 <target>/package.json）
//   --prefix <STR>          工单编号前缀，大写字母（必填）
//   --digits <N>            编号位数，1-6（默认 3）
//   --milestones <a,b,c>    里程碑列表，逗号分隔；空字符串表示不用里程碑
//   --project <STR>         项目名（默认 'project'）
//   --board-title <STR>     BOARD 标题文案（默认 "<project> · BOARD"）
//   --docs <a,b,c>          docsRefs 列表，逗号分隔（默认 '../CLAUDE.md,../docs/'）
//   --regression <a;b;c>    regressionCommands 列表，分号分隔（默认见 config.mjs::defaults）
//   --target <DIR>          目标目录（bootstrap 默认 <cwd>/b2r-process；普通默认 workflow/ 父目录）
//   --force                 允许覆盖已存在的文件
//   --dry-run               只打印将写入的路径
//
// 退出码：0 成功，1 校验失败 / 文件冲突，2 参数错误

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaults, isMainModule } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');
const WORKFLOW_DIR = resolve(__dirname, '..');  // workflow/ 自己所在目录（bootstrap 复制源）

class InitError extends Error {}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--bootstrap') opts.bootstrap = true;
    else if (a === '--upgrade') opts.upgrade = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        throw new InitError(`参数 --${key} 缺少值`);
      }
      opts[key] = val;
      i++;
    } else {
      throw new InitError(`未知参数: ${a}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`用法: node workflow/scripts/init.mjs --prefix IS [--milestones M0,M1,M2] [其它选项]

参数：
  --bootstrap             完整 bootstrap：额外复制 workflow/ 子树 + 生成 <target>/package.json
  --prefix <STR>          工单编号前缀，大写字母（必填）
  --digits <N>            编号位数，1-6（默认 3）
  --milestones <a,b,c>    里程碑列表，逗号分隔；空字符串表示不用里程碑
  --project <STR>         项目名（默认 'project'）
  --board-title <STR>     BOARD 标题文案（默认 "<project> · BOARD"）
  --docs <a,b,c>          docsRefs 列表，逗号分隔（默认 '../CLAUDE.md,../docs/'）
  --regression <a;b;c>    regressionCommands 列表，分号分隔（默认见 config.mjs::defaults）
  --target <DIR>          目标目录（bootstrap 默认 <cwd>/b2r-process；普通默认 workflow/ 父目录）
  --force                 允许覆盖已存在的文件
  --dry-run               只打印将写入的路径，不真写盘

示例:
  # 普通 init（已有 workflow/）：
  node workflow/scripts/init.mjs --prefix APP --milestones M0,M1,M2 --project demo-app

  # 完整 bootstrap（新项目首次使用，默认 target = <cwd>/b2r-process）：
  node /path/to/blueprint2real/bootstrap/workflow/scripts/init.mjs \\
       --bootstrap --prefix XX --milestones M0,M1,M2 --project newapp
`);
}

function fillTemplate(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new InitError(`模板变量 ${key} 未定义`);
    return vars[key];
  });
}

function buildMilestoneSections(milestones) {
  if (milestones.length === 0) {
    return '> 本项目当前未配置里程碑。如需要，在 `workflow.config.mjs` 的 `milestones` 字段添加，并在本文件补对应的 `## <里程碑> · …` 段。';
  }
  return milestones.map((m, i) => {
    const hint = i === 0 ? '通常是基础设施 / 契约层落地'
      : i === milestones.length - 1 ? '通常是规模化 / 多客户'
      : '通常是首批客户可感知价值';
    return `## ${m} · （待命名）

- **状态**：Planned
- **目标**：（待 owner 填写——${m} ${hint}）
- **退出条件**：（待 owner 填写——具备什么才算 ${m} 完成）`;
  }).join('\n\n');
}

function buildAcceptanceSections(milestones) {
  if (milestones.length === 0) {
    return '> 本项目当前未配置里程碑。启用 E2E 验收前，请先在 `workflow.config.mjs` 添加 `milestones`，并在本文件补对应验收段。';
  }
  return milestones.map((m) => `## ${m} · （待命名）

### 旅程 J1：<客户从 X 进入，完成 Y>
- 验收标准：<可观测的成功判据，业务语言>
- 交付范围收敛：以 \`customer-visible.md\` 中 ${m} 已 Done 工单为准，避免验未交付功能。`).join('\n\n');
}

function buildDocsRefsBullets(docsRefs) {
  if (docsRefs.length === 0) return '- （项目未配置文档引用路径）';
  return docsRefs.map((p) => `- \`${p}\``).join('\n');
}

function buildConfigFromOpts(opts) {
  if (!opts.prefix) {
    throw new InitError('缺少必填参数 --prefix');
  }
  const workIdPrefix = String(opts.prefix);
  const workIdDigits = opts.digits ? Number(opts.digits) : defaults.workIdDigits;

  let milestones;
  if (opts.milestones === undefined) {
    milestones = [...defaults.milestones];
  } else if (opts.milestones === '') {
    milestones = [];
  } else {
    milestones = String(opts.milestones).split(',').map((s) => s.trim()).filter(Boolean);
  }

  const projectName = String(opts.project || defaults.projectName);
  const boardTitle = String(opts['board-title'] || `${projectName} · BOARD`);

  let docsRefs;
  if (opts.docs === undefined) {
    docsRefs = [...defaults.docsRefs];
  } else if (opts.docs === '') {
    docsRefs = [];
  } else {
    docsRefs = String(opts.docs).split(',').map((s) => s.trim()).filter(Boolean);
  }

  let regressionCommands;
  if (opts.regression === undefined) {
    regressionCommands = [...defaults.regressionCommands];
  } else if (opts.regression === '') {
    regressionCommands = [];
  } else {
    regressionCommands = String(opts.regression).split(';').map((s) => s.trim()).filter(Boolean);
  }

  return {
    workIdPrefix,
    workIdDigits,
    milestones,
    projectName,
    boardTitle,
    docsRefs,
    regressionCommands,
  };
}

export function planInit({ config, targetDir, bootstrap = false }) {
  const firstWorkIdSuffix = String(1).padStart(config.workIdDigits, '0');
  const numberMask = 'N'.repeat(config.workIdDigits); // 用于 "PREFIX-NNN" 这种 "any digits" 占位
  const milestonesSlash = config.milestones.length > 0 ? config.milestones.join(' / ') : '（无）';

  // v5.1+: skillRoot 让 dev-package.json npm script 指向 skill bundle（而不是复制
  // workflow/ 到 target）。用绝对路径避免 /tmp -> /private/tmp 这类 symlink cwd 场景
  // 把相对路径解析到错误位置。生成的 script 以 ${B2R_HOME:-<skillRoot>} 包裹：B2R_HOME
  // 可在用户级 / 迁移安装时覆盖，实现 runtime（b2r-process 状态）与 skill 定义解耦。
  const skillRootRel = resolve(WORKFLOW_DIR, '..', '..').split(sep).join('/');

  const vars = {
    workIdPrefix: config.workIdPrefix,
    workIdDigits: String(config.workIdDigits),
    workIdNumberMask: numberMask,
    firstWorkIdSuffix,
    projectName: config.projectName,
    boardTitle: config.boardTitle,
    milestonesSlash,
    milestonesJson: JSON.stringify(config.milestones),
    docsRefsJson: JSON.stringify(config.docsRefs, null, 2).replace(/\n/g, '\n  '),
    regressionCommandsJson: JSON.stringify(config.regressionCommands, null, 2).replace(/\n/g, '\n  '),
    docsRefsBullets: buildDocsRefsBullets(config.docsRefs),
    milestoneSections: buildMilestoneSections(config.milestones),
    acceptanceSections: buildAcceptanceSections(config.milestones),
    skillRoot: skillRootRel,
  };

  const items = [
    {
      out: join(targetDir, 'workflow.config.mjs'),
      tmpl: join(TEMPLATES_DIR, 'workflow.config.mjs.tmpl'),
    },
    {
      out: join(targetDir, 'AGENT_RUNBOOK.md'),
      tmpl: join(TEMPLATES_DIR, 'AGENT_RUNBOOK.md.tmpl'),
    },
    {
      out: join(targetDir, 'state', 'active.md'),
      tmpl: join(TEMPLATES_DIR, 'state', 'active.md'),
      raw: true, // 不需要变量替换
    },
    {
      out: join(targetDir, 'state', 'queue.md'),
      tmpl: join(TEMPLATES_DIR, 'state', 'queue.md.tmpl'),
    },
    {
      out: join(targetDir, 'state', 'roadmap.md'),
      tmpl: join(TEMPLATES_DIR, 'state', 'roadmap.md.tmpl'),
    },
    {
      out: join(targetDir, 'state', 'customer-visible.md'),
      tmpl: join(TEMPLATES_DIR, 'state', 'customer-visible.md.tmpl'),
    },
    {
      out: join(targetDir, 'state', 'acceptance.md'),
      tmpl: join(TEMPLATES_DIR, 'state', 'acceptance.md.tmpl'),
    },
    {
      out: join(targetDir, 'state', 'retro.md'),
      tmpl: join(TEMPLATES_DIR, 'state', 'retro.md.tmpl'),
    },
  ];

  // Bootstrap 模式（v5.1+ thin 架构）：只生成 <target>/package.json
  // npm script 通过相对路径指向 skill bundle 的 scripts/，不再复制 workflow/ 子树到 target。
  // 单一权威源 = skill bundle 的 workflow/，target 完全干净（只放 config + state + work + BOARD）。
  if (bootstrap) {
    items.push({
      out: join(targetDir, 'package.json'),
      tmpl: join(TEMPLATES_DIR, 'dev-package.json.tmpl'),
    });
  }

  return items.map((it) => {
    if (!existsSync(it.tmpl)) throw new InitError(`模板缺失: ${it.tmpl}`);
    const content = it.raw
      ? readFileSync(it.tmpl, 'utf8')
      : fillTemplate(readFileSync(it.tmpl, 'utf8'), vars);
    return { ...it, content };
  });
}

// === v5.4 --upgrade(thin 架构:不复制脚本,只修 alias + version 标记 + 回填 state) ===

// 用与 dev-package.json.tmpl 同款的 thin 调用串构造 alias 命令。
function aliasCmd(scriptFile, skillRoot) {
  if (scriptFile === 'init.mjs') return `node "\${B2R_HOME:-${skillRoot}}/bootstrap/workflow/scripts/init.mjs"`;
  return `DEV_ROOT="$PWD" node "\${B2R_HOME:-${skillRoot}}/bootstrap/workflow/scripts/${scriptFile}"`;
}

// alias 名 → 脚本文件名。值在运行时由 aliasCmd 构造(依赖 skillRoot)。
export const REQUIRED_ALIASES = {
  'validate:state': 'validate-state.mjs',
  'validate:config': 'validate-config.mjs',
  'validate:pipeline': 'validate-pipeline-status.mjs',
  'promote': 'promote.mjs',
  'start': 'start.mjs',
  'deps:graph': 'render-dependencies.mjs',
  'lint:redlines': 'lint-redlines.mjs',
  'verify:handoff': 'verify-handoff.mjs',
  'milestone:status': 'milestone-status.mjs',
  'e2e-group:status': 'e2e-group-status.mjs',
  'render:board': 'render-board.mjs',
  'regression:diff': 'regression-diff.mjs',
};

// 只补缺失 alias,不覆盖已有(用户可能定制过)。返回 { scripts, added }。
export function mergeAliases(existing = {}, skillRoot, required = REQUIRED_ALIASES) {
  const out = { ...existing };
  let added = 0;
  for (const [name, file] of Object.entries(required)) {
    if (!(name in out)) { out[name] = aliasCmd(file, skillRoot); added++; }
  }
  return { scripts: out, added };
}

export function extractDoneIds(queueMd) {
  const ids = [];
  const re = /^\|\s*([A-Z][A-Z0-9]*-[\w-]+)\s*\|([^\n]*)$/gm;
  let m;
  while ((m = re.exec(queueMd)) !== null) if (/\bDone\b/.test(m[2])) ids.push(m[1]);
  return ids;
}

export function runUpgrade({ targetDir, skillRoot = resolve(WORKFLOW_DIR, '..', '..') }) {
  if (!existsSync(resolve(targetDir, 'workflow.config.mjs'))) {
    throw new InitError(`--upgrade 目标不是 b2r devRoot(无 workflow.config.mjs): ${targetDir}`);
  }
  const versionSrc = resolve(WORKFLOW_DIR, 'VERSION');
  const version = existsSync(versionSrc) ? readFileSync(versionSrc, 'utf8').trim() : '';
  // ① 补 package.json alias(thin:指向 bundle,不复制脚本)
  const pkgPath = resolve(targetDir, 'package.json');
  let added = 0;
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const r = mergeAliases(pkg.scripts || {}, skillRoot);
    added = r.added; pkg.scripts = r.scripts;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
  // ② 写漂移标记
  if (version) writeFileSync(resolve(targetDir, '.b2r-version'), version + '\n');
  // ③ 首次回填 state 文件(grandfather Done ids + 空 flaky 基线)
  const gfPath = resolve(targetDir, 'state', 'receipt-grandfather.json');
  let gfCount = 0;
  if (!existsSync(gfPath) && existsSync(resolve(targetDir, 'state', 'queue.md'))) {
    const ids = extractDoneIds(readFileSync(resolve(targetDir, 'state', 'queue.md'), 'utf8'));
    writeFileSync(gfPath, JSON.stringify({ ids }, null, 2) + '\n');
    gfCount = ids.length;
  }
  const flakyPath = resolve(targetDir, 'state', 'flaky-baseline.json');
  if (!existsSync(flakyPath) && existsSync(resolve(targetDir, 'state'))) {
    writeFileSync(flakyPath, JSON.stringify({ suites: [] }, null, 2) + '\n');
  }
  return { version, added, gfCount };
}

export async function runInit({ argv = process.argv.slice(2) } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (e instanceof InitError) {
      console.error(`[init] ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // --upgrade:thin 升级,不走 buildConfigFromOpts(不需要 --prefix)
  if (opts.upgrade) {
    const targetDir = opts.target ? resolve(opts.target) : resolve(WORKFLOW_DIR, '..', '..');
    let r;
    try {
      r = runUpgrade({ targetDir });
    } catch (e) {
      if (e instanceof InitError) { console.error(`[init] ${e.message}`); process.exit(1); }
      throw e;
    }
    console.log(`[upgrade] thin · .b2r-version ${r.version} · 新增 ${r.added} alias · 祖父豁免回填 ${r.gfCount} 条 · scripts 走 bundle 未复制`);
    return r;
  }

  let config;
  try {
    config = buildConfigFromOpts(opts);
  } catch (e) {
    if (e instanceof InitError) {
      console.error(`[init] ${e.message}\n`);
      printHelp();
      process.exit(2);
    }
    throw e;
  }

  // 默认 target：
  //   - bootstrap 模式无 --target → <cwd>/b2r-process（避免误把 skill 自身的 bootstrap/ 当 target）
  //   - 普通模式无 --target → workflow/ 的父目录（in-place 升级）
  let targetDir;
  if (opts.target) {
    targetDir = resolve(opts.target);
  } else if (opts.bootstrap) {
    targetDir = resolve(process.cwd(), 'b2r-process');
  } else {
    targetDir = resolve(__dirname, '..', '..');
  }
  let items;
  try {
    items = planInit({ config, targetDir, bootstrap: !!opts.bootstrap });
  } catch (e) {
    if (e instanceof InitError) {
      console.error(`[init] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  // 冲突检查
  if (!opts.force) {
    const conflicts = items.filter((it) => existsSync(it.out));
    if (conflicts.length > 0) {
      console.error(`[init] 拒绝覆盖以下已存在的文件（如确认覆盖加 --force）:`);
      for (const c of conflicts) console.error(`  - ${c.out}`);
      process.exit(1);
    }
  }

  if (opts.dryRun) {
    console.log(`[init] DRY-RUN · 将写入 ${items.length} 个文件到 ${targetDir}`);
    for (const it of items) console.log(`  - ${it.out} (${it.content.length} bytes)`);
    return { ok: true, dryRun: true, items };
  }

  for (const it of items) {
    mkdirSync(dirname(it.out), { recursive: true });
    writeFileSync(it.out, it.content);
  }
  // v5.2+: 预创建空的 work/ 与 specs/ 目录（promote 时 lazy mkdir 兜底，这里只是让骨架可见）
  mkdirSync(join(targetDir, 'work'), { recursive: true });
  const specsDirName = (config.pipeline && config.pipeline.specsDir) || 'specs';
  mkdirSync(join(targetDir, specsDirName), { recursive: true });

  const bootstrapMode = !!opts.bootstrap;
  const label = bootstrapMode ? 'init --bootstrap' : 'init';
  console.log(`[${label}] OK · 写入 ${items.length} 个文件到 ${targetDir}`);
  for (const it of items) console.log(`  - ${it.out}`);
  console.log(`\n下一步：`);
  console.log(`  1. cd ${targetDir} && 检查 workflow.config.mjs 内容`);
  if (bootstrapMode) {
    console.log(`  2. (一次性) cd ${WORKFLOW_DIR} && npm install   # 给 skill bundle 装 marked 依赖`);
  }
  console.log(`  ${bootstrapMode ? 3 : 2}. 跑 cd ${targetDir} && npm run validate:state && npm run render:board`);
  console.log(`  ${bootstrapMode ? 4 : 3}. 编辑 state/roadmap.md 里程碑细节，开始第一个 ${config.workIdPrefix}-${String(1).padStart(config.workIdDigits, '0')} 工单`);
  return { ok: true, dryRun: false, items };
}

if (isMainModule(import.meta.url)) {
  await runInit();
}
