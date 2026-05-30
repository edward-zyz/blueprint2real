# blueprint2real · 设计档案

本目录存放 skill 演进的设计稿与决策档案。**不**被 skill 运行时引用——SKILL.md / agents/ / references/ 才是 skill 实际依赖的文件。

## 文件清单

| 文件 | 说明 | 状态 |
|---|---|---|
| `pipeline-design-v5.1.html` | v5.1 流程图 + Receipt/Gate/Retry/Manager Override 全套设计 + 3 份独立 reviewer 的决策落地 | FROZEN（已实施） |
| `v5.3-autonomy-speed-design.md` | 无人值守 + 保质提速（v5.3.1 review 硬化版）。经架构/红队/简洁性 3 个 reviewer 砍到最终 3+1 项：receipt 兜底自愈（Item1）/ 单切片合并 2a+2b（Item2）/ regression 收敛（Item3）/ retro 回灌字段（Item4 轻量）。§6 记录被砍项（A1超时措辞/B1/C1/A2脚本）理由，§8 记"工单并行/DB 化"否决理由；顶部「回灌落点」表记已改文件 + direct-fix 残留老坑待办 | IMPLEMENTED（2026-05-30 已回灌） |
| `v5.3.1-优化落地清单.md` | 上面那份的**结果导向速查台账**：6 项优化（Items 1-5 + direct-fix 补修）各列「原因/方案/预期结果/诚实边界/实测验证」+ 验收口径速查表。想快速答"改了什么、预期收益多少"看这份；想知道"为什么这样设计、为什么砍那些"看 design 长篇 | IMPLEMENTED（2026-05-30 已回灌） |

## 何时读

- 想搞清"为什么 v5.1 流程图长这样 / 为什么 attempt 公式是 `> max_retry+1`" → 看 `pipeline-design-v5.1.html` 顶部"v5.1 已拍板"段
- 想看 3 个 reviewer（复杂度 / 落地 / 工程契约）的原始建议与逐条决策 → 同上
- 想看决策被拒绝的条目 + 拒绝理由（如 Gate → Check 改名被拒）→ 同上"拒绝并保留原状"段

## 何时**不**读

- 想知道"现在 skill 怎么用 / agent prompt 怎么写" → 读 `SKILL.md` 与 `agents/`
- 想知道"Receipt schema 字段" → 读 `references/receipts-schema.md`
- 想知道"完整流程图" → 读 `references/pipeline-flow.md`（设计稿是历史，references/ 是当下契约）

设计稿是"决定为什么"的档案；references/ 是"现在按什么做"的契约。冲突时以 references/ 为准。
