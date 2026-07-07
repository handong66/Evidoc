# Evidoc 中文指南：功能、用户故事和使用场景

Evidoc 是一套仓库本地的文档可信度系统。它检查 README、docs、AGENTS.md、CLAUDE.md、CI 示例、API 说明、source binding 和代码是否仍然一致，并把同一份证据提供给人、CI、Web UI 和 AI agent。

它不只是命令行扫描器。Evidoc 同时提供 CLI、本地 Web UI、Local Git Gate、GitHub Action、MCP tools、JSON reports、graph data、repair prompts、safe fixes、patch validation 和 review log。

## 先用这三个入口

```bash
npx repo-evidoc demo
npx repo-evidoc check --fail-on=review_needed
npx repo-evidoc app
```

- `demo` 打开一个内置示例，让你先看到完整 Command Center。
- `check` 扫描当前仓库，输出终端报告和 CI 可用的退出码。
- `app` 打开本地 Web UI，用浏览器查看仓库健康度、finding 证据、历史、门禁和修复入口。

## Evidoc 能做什么

| 能力 | 适合谁 | 使用入口 |
|------|--------|----------|
| CLI 扫描 | 想快速知道 README、docs、命令、路径、API 说明是否过期的维护者。 | `npx repo-evidoc check --fail-on=review_needed` |
| 本地 Web UI / Command Center | 想在浏览器里看仓库健康度、证据、历史、漂移队列、修复控制台和多仓库状态的用户。 | `npx repo-evidoc app` |
| Local Git Gate | 私有仓库、本地仓库、air-gapped 仓库、inner-source 仓库。 | `npx repo-evidoc init --yes --local-git --install-hooks` |
| GitHub Action | 想在 PR 里看到 drift 评论、annotations、changed-only 扫描和 gate 状态的团队。 | `npx repo-evidoc init --yes` |
| MCP tools | Codex、Claude Code、OpenCode、Cursor Agent 或内网 agent。 | `evidoc.agent_scan`、`evidoc.get_drift_status`、`evidoc.diagnose_drift`、`evidoc.suggest_doc_fix` |
| JSON reports 和 CI recipes | 想把结果接入 GitLab、Jenkins、Gitea、Buildkite、内部 dashboard 或平台工具的团队。 | `npx repo-evidoc recipes --target all` |
| Graph 和 evidence | 想知道文档、代码符号、API、命令、规则之间关系的工具链维护者。 | `npx repo-evidoc graph --json`、`npx repo-evidoc index --json` |
| Agent evaluation | 想比较 agent 有无 Evidoc 证据时修复质量差异的团队。 | `npx repo-evidoc agent-eval --json` |
| Repair prompts、patch drafts 和 safe fixes | 想把 finding 交给人或 agent 修，同时保留证据约束、patch draft 和 patch validation 的团队。 | `npx repo-evidoc diagnose`、`npx repo-evidoc draft --json`、`npx repo-evidoc validate --proposal <proposal-file> --json`、`npx repo-evidoc fix --safe --write --json` |
| Review log 和 runtime fingerprint | 想记录人工复核、过期时间、责任人，并避免 agent 使用旧报告的团队。 | `npx repo-evidoc guard --event manual --scope staged --json` |

## 真实用户故事

| 我是谁 | 我的场景 | Evidoc 给我什么 | 推荐入口 |
|--------|----------|-----------------|----------|
| 项目维护者 | README 里的命令、路径、API 或示例可能已经过期。 | 终端报告、具体 evidence、`review_needed` 或 `broken` 状态。 | `npx repo-evidoc check --fail-on=review_needed` |
| 使用 AI 编程的团队 | AGENTS.md、CLAUDE.md、Cursor rules、Copilot instructions 会影响 agent 输出。 | 专门的 agent instruction drift 检查，指出旧路径、旧包管理器、矛盾规则。 | `npx repo-evidoc verify --instructions --json` |
| 本地/私有仓库用户 | 代码不能上传第三方服务，也不一定使用 GitHub。 | repo-local Git hooks、本地报告、pre-commit/pre-push/manual gate。 | `npx repo-evidoc init --yes --local-git --install-hooks` |
| GitHub PR reviewer | 想在 PR 里直接看到哪些 changed docs 或 affected docs 需要处理。 | PR comment、workflow annotations、fail policy、changed-only 扫描。 | `npx repo-evidoc init --yes` |
| 想用 Web UI 的开发者 | 不想只看终端输出，希望在浏览器里筛选 finding、看历史、打开文件、生成修复提示。 | 本地 Command Center、漂移队列、修复控制台、Local Git Gate 面板、GitHub Action 生成动作。 | `npx repo-evidoc app` |
| Codex / Claude Code / OpenCode 用户 | 想让 agent 先读取当前仓库证据，再生成修复方案。 | `evidoc.agent_scan` 默认扫描包、status tool、diagnose tool、evidence-bound patch proposal。 | `npx repo-evidoc diagnose` 或 MCP tools |
| Agent workflow 维护者 | 想比较同一个 agent 在有无 Evidoc 证据时的修复结果。 | agent A/B benchmark、coverage pack、MCP default tool 信息。 | `npx repo-evidoc agent-eval --json` |
| 平台和工具链维护者 | 想把文档漂移结果接入内部平台、dashboard、CI、agent workflow。 | JSON report、runtime fingerprint、graph data、CI recipes、machine-readable index。 | `npx repo-evidoc recipes --target all` |
| 开源维护者 | 想给贡献者一个低门槛检查，减少“README 还能不能信”的 review 成本。 | `doctor`、`demo`、`check` 和可复制的 GitHub Action 配置。 | `npx repo-evidoc doctor` |
| 架构/API 维护者 | 文档引用了源代码符号、OpenAPI operation、schema 或 source binding。 | symbol/API/schema/source binding drift 检查和 graph evidence。 | `npx repo-evidoc graph --json` |
| 需要审计的团队 | 某些 drift 需要人工确认、短期 override 或到期复核。 | review log、TTL、finding 绑定、runtime fingerprint 和本地审计记录。 | `npx repo-evidoc guard --event manual --scope staged --json` |

## 写入由你选择

| 入口 | 行为 |
|------|------|
| `check`、`doctor`、`diagnose`、`verify`、`recipes`、`agent-eval`、`draft`、`validate` | 读取仓库并输出报告、提示、patch proposal 或校验结果。 |
| `app` / `serve` | 启动本地 Web UI，缺少配置时会创建 `.evidoc/config.json` 和 `.evidoc/.gitignore`。 |
| `init --yes` | 写入 `.evidoc/config.json` 和 GitHub Actions workflow。 |
| `init --local-git --install-hooks` | 写入 repo-local hooks，并设置当前仓库的 `core.hooksPath=.githooks`。 |
| `fix --safe --write --json` | 只应用确定性的 safe fixes，并输出 JSON 结果。 |

## 核心检测范围

- 文档里的命令是否仍然匹配 `package.json` 和当前包管理器。
- Markdown links、路径、source symbols、frontmatter source bindings 是否仍然存在。
- AGENTS.md、CLAUDE.md、Cursor rules、Copilot instructions 是否和仓库事实一致。
- OpenAPI operation、request schema、response schema 是否和 spec 一致。
- changed source files 是否需要对应文档覆盖。
- review log 是否仍然有效，过期 override 是否需要重新复核。

## 为什么需要 Evidoc

AI 编程工具的输入会决定它的输出。仓库文档、AGENTS.md、CLAUDE.md、README、API 示例和架构说明已经是 agent 的事实源。

如果事实源漂移，agent 会基于旧事实生成看似合理的错误变更。Evidoc 把文档可信度放进工程控制流，让文档、agent 指令、CI 和 repair workflow 使用同一份当前证据。

## 安全和控制承诺

- 普通扫描基于本地仓库证据运行，仓库内容默认留在本机。
- 外部 patch provider 是显式 opt-in；私有仓库内容默认留在本地。
- CLI、Local Git Gate、Local App、GitHub Action、MCP tools 复用同一份 core report 和 runtime fingerprint。
- GitHub 是可选入口；本地仓库和非 GitHub CI 可以使用 Local Git Gate 与 recipes。
- Finding 必须绑定具体 evidence：文档片段或 agent 指令 claim、相关代码/配置/API 证据、rule trigger 和复核原因。
- Patch draft、repair prompt、safe fix 和 review log 都绑定 finding 证据。
- MCP 写入工具需要显式授权，并且写入路径受 server `cwd` 和仓库 realpath 边界限制。
- Agent repair prompt 会要求保留 source binding、frontmatter 和 review log，不通过删除证据来绕过检查。
- 写入动作通过明确命令触发，patch proposal 先进入 review 和 validation。
