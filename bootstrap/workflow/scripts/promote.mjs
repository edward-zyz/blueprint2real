#!/usr/bin/env node
// 把 queue.md 中一条 Planned 工单 promote 到 Ready。
// 自动完成 RUNBOOK §9 描述的 4 步手工动作：
//   1) 校验前置（编号存在 / 当前 Planned / 摘要段存在 / 依赖全 Done / spec/plan 未提前生成）
//   2) 生成 b2r-process/work/<id>/spec.md + plan.md + context-pack.md stub
//   3) queue.md 表格行翻 Ready + 填 spec/plan 路径
//   4) §Planned 工单范围摘要 中删除对应小节
//   5) 跑 validate-state 兜底
//   6) 自动重新生成 BOARD.html
//
// 用法：
//   node workflow/scripts/promote.mjs <work-id>            # 实际执行
//   node workflow/scripts/promote.mjs <work-id> --dry-run  # 只展示动作，不写盘
//   node workflow/scripts/promote.mjs <work-id> --force    # 跳过依赖 Done 检查
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateState } from './validate-state.mjs';
import { renderBoard } from './render-board.mjs';
import { loadConfig, inferDevRoot, makeWorkIdRegex, makeWorkIdPattern, workItemSlug, isMainModule } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TODAY_ISO = (() => {
  const d = new Date();
  const tz = 8 * 60;
  const local = new Date(d.getTime() + (tz + d.getTimezoneOffset()) * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
})();

class PromoteError extends Error {}

function parseQueueRow(line, workIdRe) {
  if (!line.startsWith('|')) return null;
  const cells = line.split('|').slice(1, -1).map((s) => s.trim());
  if (cells.length < 8) return null;
  if (!workIdRe.test(cells[0])) return null;
  return {
    workId: cells[0],
    name: cells[1],
    status: cells[2],
    milestone: cells[3],
    spec: cells[4],
    plan: cells[5],
    commit: cells[6],
    finishedAt: cells[7],
  };
}

function findQueueRows(queueMd, workIdRe) {
  const lines = queueMd.split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const r = parseQueueRow(lines[i], workIdRe);
    if (r) rows.push({ ...r, lineIdx: i });
  }
  return rows;
}

function extractSummarySection(queueMd, workId, workIdPattern) {
  const lines = queueMd.split('\n');
  const headRe = new RegExp(`^###\\s+${workId}\\s+·\\s+(.+)$`);
  const nextHeadRe = new RegExp(`^###\\s+${workIdPattern}\\s+·`);
  let start = -1;
  let title = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headRe);
    if (m) { start = i; title = m[1].trim(); break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextHeadRe.test(lines[i]) || /^##\s+/.test(lines[i])) { end = i; break; }
  }
  let endTrimmed = end;
  while (endTrimmed - 1 > start && lines[endTrimmed - 1].trim() === '') endTrimmed--;
  const body = lines.slice(start + 1, endTrimmed).join('\n').trim();
  return { startIdx: start, endIdx: end, title, body };
}

function extractDependencies(summaryBody, workIdPattern) {
  // 摘要末尾形如 "依赖：IS-002。" 或 "依赖：IS-002 / IS-009。"
  const m = summaryBody.match(/依赖：([^\n。]+)/);
  if (!m) return [];
  const re = new RegExp(workIdPattern, 'g');
  const ids = m[1].match(re) || [];
  return [...new Set(ids)];
}

function buildSpecStub({ workId, name, milestone, summaryBody, deps, today, config }) {
  const depsBlock = deps.length > 0
    ? deps.map((d) => `  - \`${d}\` Done（提供：待补）`).join('\n')
    : '  - 无';
  const regressionList = config.regressionCommands.map((c, i) => `${i + 1}. \`${c}\``).join('\n');
  const upstreamDocs = config.docsRefs.length > 0
    ? config.docsRefs.map((p) => `\`${p}\``).join(' / ')
    : '（项目未配置 docsRefs；按需补具体路径）';

  return `# ${workId} Spec · ${name}

- 里程碑：${milestone}
- 状态：Ready
- 起草日期：${today}
- 上游：（待补：从 ${upstreamDocs} 引用具体章节）
- 前置：
${depsBlock}

## 1. 为什么做

（待 fresh thread 起草——必须追溯到上游文档中的客户价值或工程边界）

> Planned 摘要原文（promote 时从 \`../../state/queue.md\` §Planned 工单范围摘要 搬入，供起草参考；起草完成后可删此引用块）：
>
> ${summaryBody.split('\n').join('\n> ')}

## 2. 本轮只解决的边界问题

（待 fresh thread 起草——本轮**唯一**的边界问题；超出范围的留给后续工单）

## 3. 本轮不做

（待 fresh thread 起草——显式列出**不做**的事，对抗范围漂移）

## 4. 修改 / 新增文件范围

（待 fresh thread 起草——文件白名单。implementation commit 不得超出此范围）

\`\`\`
（占位）
\`\`\`

## 5. 输入输出契约

（待 fresh thread 起草）

## 6. 安全约束

（待 fresh thread 起草——按 \`../AGENT_RUNBOOK.md\` §6 红线逐条评估本轮是否触及）

## 7. 验证（targeted + regression）

Targeted：

1. （待 fresh thread 起草——本轮特有的验证用例）

Regression：

${regressionList}

## 8. 失败如何停止 / 拆分 / 回退

（待 fresh thread 起草——明确失败时的退路）

## 9. 通过后为什么可以进入下一轮

（待 fresh thread 起草——本工单产物如何成为后续工单的前置）

## 10. 验收口径（Done 的判定）

- [ ] §7 Targeted 全过
- [ ] §7 Regression 全过
- [ ] \`queue.md\` ${workId} 行 status → Done + commit hash + 完成日期
- [ ] \`active.md\` 翻回 Idle
- [ ] \`customer-visible.md\` 追加 \`## ${today} · ${workId} Done\` 段
- [ ] \`cd b2r-process && npm run validate:state\` OK
- [ ] \`cd b2r-process && npm run render:board\`
- [ ] implementation commit 仅含运行时代码（不含 \`b2r-process/state/*\` / \`b2r-process/BOARD.html\`）；handoff commit 仅含 \`b2r-process/state/*\` + \`b2r-process/BOARD.html\`

## 11. 剩余风险

（待 fresh thread 起草——仅可带入下一轮的**非**安全 / **非**密钥 / **非**审计 / **非**客户数据风险）
`;
}

function extractCvSegment(cvMd, workId, workIdPattern) {
  const lines = cvMd.split('\n');
  const headRe = new RegExp(`^##\\s+\\d{4}-\\d{2}-\\d{2}\\s+·\\s+${workId}\\s+Done\\s*$`);
  const nextHeadRe = new RegExp(`^##\\s+\\d{4}-\\d{2}-\\d{2}\\s+·\\s+${workIdPattern}\\s+Done`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headRe.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextHeadRe.test(lines[i])) { end = i; break; }
  }
  let endTrimmed = end;
  while (endTrimmed - 1 > start && lines[endTrimmed - 1].trim() === '') endTrimmed--;
  return lines.slice(start, endTrimmed).join('\n');
}

function buildContextPack({ workId, name, milestone, slugDir, summaryBody, deps, depSlugMap, depCvSegments, today, config }) {
  const specsDir = config.pipeline.specsDir || 'specs';
  const specRelFromCtx = `../../${specsDir}/${slugDir}.md`;
  const depBlock = deps.length === 0
    ? '本工单无前置依赖。'
    : deps.map((d) => {
      const seg = depCvSegments[d];
      if (!seg) {
        const depSlug = depSlugMap[d] || d;
        return `### ${d}\n\n（customer-visible.md 中查无此 Done 段；可能未 Done 或刚 promote，请回看 \`../../${specsDir}/${depSlug}.md\` §11 剩余风险 + queue.md 状态）`;
      }
      return seg.replace(/^##\s+/, '### ');
    }).join('\n\n');

  const docsList = config.docsRefs.length > 0
    ? config.docsRefs.map((p) => `\`${p}\``).join(' / ')
    : '（项目未配置 docsRefs）';

  return `# ${workId} Context Pack

> 自动生成 by \`scripts/promote.mjs\`。供 fresh thread / sub-agent 启动时**优先读此文件 + spec.md + plan.md**；完整上游文档作为按需查阅源，不必预读全文。
>
> 当此文件与 \`../../state/*.md\` 冲突时，**以 state/* 为执行事实源**。本文件是启动加速包，不是事实源。

## 1. 工单基础

- ID: ${workId}
- Name: ${name}
- 里程碑: ${milestone}
- 起草日期: ${today}
- 依赖: ${deps.length > 0 ? deps.map((d) => `\`${d}\``).join(' / ') : '（无）'}

### Planned 摘要原文

${summaryBody}

## 2. 前置工单已交付的能力（依赖摘要）

${depBlock}

## 3. RUNBOOK 必读章节（按需展开）

按 \`../../AGENT_RUNBOOK.md\` 中以下章节执行；如有需要，再回该文件完整阅读：

- **§3 固定执行链路**：promote → fresh thread → spec → spec review → plan → failing test → minimal impl → targeted verify → regression → architecture/security review → impl commit → 翻档 → render:board → handoff commit → stop
- **§4 Agent 启动检查表**：5 条前置；未达成不得实现
- **§5 必须产物**：spec / plan / tests / review / commit / state 更新
- **§6 架构红线**：命中即停
- **§7 状态更新规则**：active → queue → customer-visible → roadmap → render:board → handoff commit
- **§10.1 工作流自身改动**：本工单是运行时改动，**不**走 loop_work_flow/ 路径

## 4. 启动 Checklist（fresh thread 自查）

- [ ] 已读本文 §1-3
- [ ] 已读 \`${specRelFromCtx}\` 全文（spec）
- [ ] 已读 \`./plan.md\` 全文
- [ ] 已确认 \`../../state/active.md\` 当前 Status = Idle（未 Idle 则不得启动）
- [ ] 已确认前置依赖在 \`../../state/queue.md\` 中均为 Done（promote 时已校验，但翻一次保险）
- [ ] 已确认 spec/plan 已被人/主线 thread review 过

## 5. 反 token 浪费提示

- **不要**预读 \`customer-visible.md\` 历史所有段——本工单需要的依赖段已在本文件 §2
- **不要**预读 \`roadmap.md\` 全部里程碑——本工单里程碑已在本文件 §1
- **不要**预读项目文档（${docsList}）全文——按 spec §1 上游引用指向的具体章节查
`;
}

function buildPlanStub({ workId, name, slugDir, deps, today, config }) {
  const depsLine = deps.length > 0 ? deps.join(' / ') + ' 已 Done' : '（无依赖）';
  const regressionBlock = config.regressionCommands.join('\n');
  const specsDir = config.pipeline.specsDir || 'specs';
  const specRelFromPlan = `../../${specsDir}/${slugDir}.md`;

  return `# ${workId} Plan · ${name}

- Spec：\`${specRelFromPlan}\`
- 执行链路：\`../../AGENT_RUNBOOK.md\` §3
- 起草日期：${today}

## 0. 执行前置

1. ${depsLine}
2. \`b2r-process/state/active.md\` 为 Idle
3. 从 fresh thread 或 delegated sub-agent 启动
4. 已读 spec 全文

## 1. TDD 步骤拆分

### Step 1 · 失败测试（红）

（待 fresh thread 写——先描述测试断言，跑测试**应失败**才能进 Step 2）

### Step 2 · 最小实现（绿）

（待 fresh thread 写——只写让 Step 1 测试通过的最少代码）

### Step 3 · Regression

\`\`\`bash
${regressionBlock}
\`\`\`

全部退出码 0 才能进 commit。

## 2. Architecture & Security Review 检查点

按 \`../../AGENT_RUNBOOK.md\` §6 逐条评估（占位列表，待项目沉淀后补红线条目）：

| 红线 | 本轮是否触及 | 检查方法 |
|---|---|---|
| （待 §6 沉淀） | — | — |

## 3. Commit 范围

### Implementation commit

仅包含：（待 fresh thread 填具体路径，必须落在 spec §4 范围内）

Commit message：

\`\`\`
feat(<scope>): <一句概括>（${workId}）

<2-3 行说明：为什么做、本轮交付什么、什么不做>
spec: b2r-process/${specsDir}/${slugDir}.md
plan: b2r-process/work/${slugDir}/plan.md
\`\`\`

### Handoff commit

仅包含：

- \`b2r-process/state/active.md\` → Idle
- \`b2r-process/state/queue.md\`：${workId} 行 status → Done + commit hash + 完成日期
- \`b2r-process/state/customer-visible.md\` 追加 \`## ${today} · ${workId} Done\` 段
- \`b2r-process/BOARD.html\`（由 \`render:board\` 自动重生成）

Commit message：\`chore(state): ${workId} Done · 翻档\`

## 4. 状态翻档动作

1. \`queue.md\`：${workId} 行 status \`Ready\` → \`Done\`，commit hash 与日期写入。
2. \`active.md\`：整文件重写为 Idle。
3. \`customer-visible.md\`：追加段落（含「客户/产品可感知变化」+「Internal-only 变化」两条 bullet）。
4. \`roadmap.md\`：是否翻档？（待评估）
5. 跑 \`cd b2r-process && npm run validate:state\`（兜底）。
6. 跑 \`cd b2r-process && npm run render:board\`。

## 5. 验证命令清单

\`\`\`bash
${regressionBlock}
git status
\`\`\`

全部退出码 0 才能进 commit。

## 6. 失败 / 拆分 / 回退预案

（待 fresh thread 填——本工单特有的失败点与处理）

## 7. 估时

（待 fresh thread 估——单次 fresh thread 应 ≤4 小时；超出触发拆分）
`;
}

function rewriteQueueMd({ queueMd, workId, specRelPath, planRelPath, workIdRe, workIdPattern }) {
  const lines = queueMd.split('\n');
  let tableHit = false;
  for (let i = 0; i < lines.length; i++) {
    const r = parseQueueRow(lines[i], workIdRe);
    if (!r || r.workId !== workId) continue;
    if (r.status !== 'Planned') {
      throw new PromoteError(`${workId} 当前 Status="${r.status}"，必须为 Planned 才能 promote`);
    }
    lines[i] = `| ${workId} | ${r.name} | Ready | ${r.milestone} | \`${specRelPath}\` | \`${planRelPath}\` | — | — |`;
    tableHit = true;
    break;
  }
  if (!tableHit) throw new PromoteError(`${workId} 不在 queue.md 表中`);

  const section = extractSummarySection(lines.join('\n'), workId, workIdPattern);
  if (!section) {
    throw new PromoteError(`§Planned 工单范围摘要 中缺 "### ${workId} ·" 段，无法 promote`);
  }
  const beforeStart = lines.slice(0, section.startIdx);
  let afterEnd = lines.slice(section.endIdx);
  while (beforeStart.length > 0 && beforeStart[beforeStart.length - 1].trim() === '' &&
    (beforeStart.length >= 2 && beforeStart[beforeStart.length - 2].trim() === '')) {
    beforeStart.pop();
  }
  while (afterEnd.length > 0 && afterEnd[0].trim() === '') afterEnd.shift();
  const joined = [...beforeStart];
  if (afterEnd.length > 0) {
    if (joined.length > 0 && joined[joined.length - 1].trim() !== '') joined.push('');
    joined.push(...afterEnd);
  }
  let out = joined.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

export async function promote({ stateDir, workDir, workId, config, dryRun = false, force = false, today = TODAY_ISO, boardPath = null }) {
  if (!config) throw new Error('promote 需要传入 config（来自 loadConfig）');
  const WORK_ID_RE = makeWorkIdRegex(config);
  const WORK_ID_PATTERN = makeWorkIdPattern(config);

  if (!WORK_ID_RE.test(workId)) {
    throw new PromoteError(`workId "${workId}" 不符合 ${config.workIdPrefix}-\\d{${config.workIdDigits}} 格式`);
  }

  const queuePath = join(stateDir, 'queue.md');
  if (!existsSync(queuePath)) throw new PromoteError(`未找到 ${queuePath}`);
  const queueMd = readFileSync(queuePath, 'utf8');

  const rows = findQueueRows(queueMd, WORK_ID_RE);
  const row = rows.find((r) => r.workId === workId);
  if (!row) throw new PromoteError(`${workId} 不在 queue.md 表中`);
  if (row.status !== 'Planned') {
    throw new PromoteError(`${workId} 当前 Status="${row.status}"，必须为 Planned 才能 promote`);
  }

  const summary = extractSummarySection(queueMd, workId, WORK_ID_PATTERN);
  if (!summary) {
    throw new PromoteError(`§Planned 工单范围摘要 中缺 "### ${workId} ·" 段`);
  }

  const deps = extractDependencies(summary.body, WORK_ID_PATTERN);
  if (!force) {
    const unmetDeps = [];
    for (const dep of deps) {
      const d = rows.find((r) => r.workId === dep);
      if (!d) unmetDeps.push(`${dep}（不存在）`);
      else if (d.status !== 'Done') unmetDeps.push(`${dep}（Status=${d.status}）`);
    }
    if (unmetDeps.length > 0) {
      throw new PromoteError(`前置依赖未 Done：${unmetDeps.join(' / ')}（如需强制 promote，加 --force）`);
    }
  }

  const slugDir = workItemSlug({ workId, title: row.name });
  const specsDir = config.pipeline.specsDir || 'specs';
  const specsRoot = join(stateDir, '..', specsDir);

  const workSubdir = join(workDir, slugDir);
  const specPath = join(specsRoot, `${slugDir}.md`);
  const planPath = join(workSubdir, 'plan.md');
  const contextPackPath = join(workSubdir, 'context-pack.md');
  if (existsSync(specPath) || existsSync(planPath) || existsSync(contextPackPath)) {
    throw new PromoteError(`${specPath} 或 ${workSubdir}/{plan,context-pack}.md 已存在，promote 拒绝覆盖`);
  }

  const specRelPath = `../${specsDir}/${slugDir}.md`;
  const planRelPath = `../work/${slugDir}/plan.md`;

  const depSlugMap = {};
  for (const d of deps) {
    const depRow = rows.find((r) => r.workId === d);
    if (depRow) depSlugMap[d] = workItemSlug({ workId: d, title: depRow.name });
  }

  const specText = buildSpecStub({ workId, name: row.name, milestone: row.milestone, summaryBody: summary.body, deps, today, config });
  const planText = buildPlanStub({ workId, name: row.name, slugDir, deps, today, config });
  const newQueueMd = rewriteQueueMd({ queueMd, workId, specRelPath, planRelPath, workIdRe: WORK_ID_RE, workIdPattern: WORK_ID_PATTERN });

  const cvPath = join(stateDir, 'customer-visible.md');
  const cvMd = existsSync(cvPath) ? readFileSync(cvPath, 'utf8') : '';
  const depCvSegments = {};
  for (const d of deps) {
    const seg = extractCvSegment(cvMd, d, WORK_ID_PATTERN);
    if (seg) depCvSegments[d] = seg;
  }
  const contextPackText = buildContextPack({
    workId, name: row.name, milestone: row.milestone, slugDir, summaryBody: summary.body,
    deps, depSlugMap, depCvSegments, today, config,
  });

  const resolvedBoardPath = boardPath || join(stateDir, '..', 'BOARD.html');

  const dryRunSummary = {
    workId,
    slugDir,
    name: row.name,
    milestone: row.milestone,
    depsResolved: deps,
    willWrite: [
      { path: specPath, bytes: specText.length },
      { path: planPath, bytes: planText.length },
      { path: contextPackPath, bytes: contextPackText.length },
      { path: queuePath, bytes: newQueueMd.length, action: 'rewrite' },
      { path: resolvedBoardPath, action: 'rerender' },
    ],
  };

  if (dryRun) {
    return { ok: true, dryRun: true, summary: dryRunSummary };
  }

  mkdirSync(specsRoot, { recursive: true });
  mkdirSync(workSubdir, { recursive: true });
  writeFileSync(specPath, specText);
  writeFileSync(planPath, planText);
  writeFileSync(contextPackPath, contextPackText);
  writeFileSync(queuePath, newQueueMd);

  const validation = validateState({ stateDir, config });
  if (!validation.ok) {
    throw new PromoteError(
      `promote 写盘成功但 validate-state 报错（请手工修复）：\n${validation.issues
        .filter((i) => i.severity === 'error')
        .map((i) => `  - ${i.file}: ${i.msg}`)
        .join('\n')}`,
    );
  }

  let boardResult = null;
  try {
    boardResult = await renderBoard({ stateDir, outPath: resolvedBoardPath, config });
  } catch (e) {
    console.error(`[promote] 警告：自动 render-board 失败 (${e.message})；请手工跑 npm run render:board`);
  }

  return { ok: true, dryRun: false, summary: dryRunSummary, validation, board: boardResult };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const workId = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  if (!workId) {
    console.error('用法: node workflow/scripts/promote.mjs <work-id> [--dry-run] [--force]');
    process.exit(2);
  }
  const devRoot = inferDevRoot();
  const stateDir = process.env.STATE_DIR || join(devRoot, 'state');
  const workDir = process.env.WORK_DIR || join(devRoot, 'work');
  try {
    const config = await loadConfig({ devRoot });
    const r = await promote({ stateDir, workDir, workId, config, dryRun, force });
    if (dryRun) {
      console.log(`[promote] DRY-RUN · ${workId}`);
      console.log(`  name        : ${r.summary.name}`);
      console.log(`  milestone   : ${r.summary.milestone}`);
      console.log(`  deps        : ${r.summary.depsResolved.join(' / ') || '（无）'}`);
      console.log(`  will write  :`);
      for (const w of r.summary.willWrite) {
        console.log(`    - ${w.path} (${w.bytes} bytes${w.action ? ` · ${w.action}` : ''})`);
      }
    } else {
      console.log(`[promote] OK · ${workId} → Ready`);
      console.log(`  spec: ${r.summary.willWrite[0].path}`);
      console.log(`  plan: ${r.summary.willWrite[1].path}`);
      console.log('\n下一步：');
      console.log('  1. 起草 spec/plan（fresh thread 或 sub-agent 完成 §1-11 填空）');
      console.log('  2. spec/plan review 通过后，把 active.md 翻为 In Progress 持有此工单');
      console.log('  3. 按 RUNBOOK §3 链路推进');
    }
    process.exit(0);
  } catch (e) {
    if (e instanceof PromoteError) {
      console.error(`[promote] ERROR: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
