# Evidoc 用户故事

如果你不知道 Evidoc 能帮你做什么，先看这一页。

Evidoc 用来检查仓库里的 README、文档、AGENTS.md、CLAUDE.md、CI 示例、API 说明和代码是否已经不一致。它不是帮你多写文档，而是在合并、发布或交给 AI agent 之前，告诉你哪些仓库知识已经不可信。

## 先用这三个命令

```bash
npx repo-evidoc demo
npx repo-evidoc check --fail-on=review_needed
npx repo-evidoc app
```

这三个命令分别对应：看一个示例、扫描当前仓库、打开本地 Web UI。

## 我是谁，应该用哪个命令？

| 你是谁 | 你遇到的问题 | Evidoc 帮你看到什么 | 先运行 |
|--------|--------------|---------------------|--------|
| 维护者 | README 里的命令、路径、API 或示例可能已经过期。 | 哪些文档需要人工复核，哪些检查结果会挡住合并。 | `npx repo-evidoc check --fail-on=review_needed` |
| 使用 AI 编程的团队 | AGENTS.md、CLAUDE.md、Cursor rules 或 Copilot instructions 可能误导 agent。 | agent 指令是否和当前包管理器、路径、脚本、代码结构一致。 | `npx repo-evidoc verify --instructions --json` |
| 私有、本地-only 或 air-gapped 仓库用户 | 不想把源码上传到第三方服务，也不一定能用 GitHub Actions。 | 本地扫描结果、本地 Git gate 结果，以及 `.evidoc/reports/` 里的审计记录。 | `npx repo-evidoc init --yes --local-git --install-hooks` |
| GitHub PR reviewer | 希望 PR 评论直接指出本次改动影响了哪些文档。 | PR 评论、CI 检查状态、需要复核的文档片段和修复入口。 | `npx repo-evidoc init --yes` |
| Codex、Claude Code、OpenCode 用户 | 想让 agent 基于当前证据修文档，而不是凭旧 README 记忆猜。 | 带证据的修复提示、当前扫描指纹和具体不一致证据。 | `npx repo-evidoc diagnose` |
| 平台和工具链维护者 | 想把文档漂移结果接入内部 dashboard、CI、MCP 或 agent。 | JSON report、MCP tools、graph data、runtime fingerprint 和通用 CI recipes。 | `npx repo-evidoc recipes --target all` |
| 开源维护者 | 希望贡献者先做低门槛检查，再请求 review。 | 环境诊断、常见配置问题和最小扫描路径。 | `npx repo-evidoc doctor` |

## Evidoc 会不会改我的仓库？

- `check`、`doctor`、`diagnose`、`verify` 默认只读。
- `app` 可能在缺少配置时创建 `.evidoc/config.json` 和 `.evidoc/.gitignore`。
- `init`、`init --local-git --install-hooks`、`fix --safe --write` 是显式写入命令。
- 普通扫描默认不会调用外部 agent provider，也不会上传仓库内容。

## Evidoc 不是什么

- 不是默认自动修复、自动提交或自动合并的工具。
- 不是默认把私有代码交给 LLM 的工具。
- 不是只服务 GitHub 的工具；本地仓库可以用 Local Git Gate，其他 CI 可以用 recipes。
- 不是把 LLM 判断包装成确定性事实的工具；finding 必须有仓库证据。

如果你只是想判断自己该不该用 Evidoc，读到这里就够了。下面是给维护者、集成者和贡献者看的产品边界。

## 为什么需要 Evidoc

AI 编程工具的输入会决定它的输出。仓库文档、AGENTS.md、CLAUDE.md、README、API 示例和架构说明已经是 agent 的事实源。

如果事实源漂移，agent 不会显式报错，而是会基于旧事实生成看似合理的错误变更。因此文档漂移不是内容品控问题，而是上下文污染问题。上下文污染需要进入工程控制流，像测试、类型检查和 lint 一样被检测、解释、审查和阻断。

## 产品边界和目标状态

Evidoc 的完整目标状态是一个 repo-local、open-source-first 的文档漂移控制平面：

- CLI 可以在任意仓库一键启动本地 GUI，也可以只读扫描并输出证据报告。
- Local App 可以自动初始化配置、扫描当前或多个本地仓库，并在中英双语 Command Center 中展示红黄绿健康状态、finding 证据、文件入口、历史、本地 Git 门禁状态、漂移队列、修复控制台、本地 Git 门禁启用动作和 GitHub Action 生成动作。
- Local Git Gate 可以在没有 GitHub、不能上传 GitHub 或不适合启用 GitHub Actions 的仓库中，用 repo-local Git hook 和本地报告阻断漂移。
- GitHub Action 可以在 PR 中给出 advisory 或 gate。
- MCP server 可以让 Codex、Claude Code、OpenCode、Cursor Agent 或内网自研 agent 查询当前仓库文档健康度。Codex、Claude Code、OpenCode 是首批重点适配入口，不是协议上限。
- Agent Runtime Contract 可以把 CLI、本地 Git hook、MCP、Local App 和 agent skill 的结果收口成同一份事实：事件、模式、scope、baseline、可选 baselineCommit、状态、generatedAt/scannedAt、changedFileFingerprints 和 fingerprint。
  aggregate `runtime.fingerprint` 会纳入 event、mode、scope、baseline、受影响文档、changed files、changed-file fingerprints 和 finding fingerprints，但忽略单纯的时间戳变化。
  对话里的提醒先用 changedFiles 与内容指纹拒绝旧报告，旧报告才回退时间戳，再按 finding fingerprint 去重，避免同一漂移被多个入口重复刷屏。
- Graph layer 可以连接文档、代码符号、配置、API spec、命令、测试、ADR 和 agent instruction。
- Evidence pack 可以把每个 finding 解释到具体文档片段、代码变更和规则。
- Patch agent 可以基于证据生成可审查 diff，并由 validator 检查 patch 是否忠于证据。
- Review log 可以记录人类确认、override、过期时间和责任人。

## 完成定义

当前阶段的“全部完成”不是商业化 SaaS，也不是把所有可能的检测器一次性穷尽；它指选定产品面的端到端能力都已成为真实、可运行、可测试的代码路径：

- CLI 支持一键 `npx repo-evidoc` 本地 App、`app` / `serve` GUI 入口、本地扫描、本地 Git `guard` 门禁、通用 CI recipes、仓库 index、finding explain、图谱、dashboard、patch draft、patch validate、多仓库聚合和 GitHub Action 等价入口。
- Local App 支持自动配置、系统文件夹选择、扫描历史、中英双语本地 Command Center、多仓库状态、本地 Git 门禁面板、staged/unstaged 变更、受影响文档、最近一次本地门禁结果的 gate baseline、baseline commit、runtime status、fingerprint 与 freshness、一键启用 Local Git Gate、一键生成 GitHub Action、打开 finding 文件入口、漂移队列、修复控制台和 watch refresh。
- GitHub Action 是真实 composite action，可以在 CI 中安装、构建并运行 Evidoc。
- MCP server 提供 JSON-RPC `initialize`、`tools/list`、`tools/call`，默认只读；`evidoc.agent_scan`、`evidoc.get_drift_status`、`evidoc.diagnose_drift` 和 `evidoc.suggest_doc_fix` 都复用 core scan 与 Agent Runtime Contract；patch draft/validate 属于只读工具，review-log 写入必须显式授权，并且所有 `root` 都必须落在 MCP server 的 `cwd` 边界内。
- Core detector 覆盖路径、Markdown link、包管理器/script、`npx` 包管理器漂移、OpenAPI operation、单向 request/response schema、source symbol、frontmatter source、changed-source 文档覆盖策略、review TTL。
- Core 提供统一 path-safety 原语，读路径、patch 写入、Local App 打开文件和 MCP review log 写入都必须通过真实路径边界检查。
- Frontmatter 支持 source binding 解析、验证、序列化和 backfill。
- Graph layer 输出 document/source/symbol/API/rule 节点和 evidence 边。
- Patcher 支持确定性 diff、LLM evidence request、patch response validator。
- Review log 支持 append-only JSONL、过期判断和 finding 绑定。
- Dashboard 可以输出静态 HTML 报告和本地 Command Center 界面。
- Release pipeline 能在 GitHub Actions 里 build/test/self-scan，并为 tag 生成 package artifacts；本地 `release:smoke:npx` 必须从当前源码重新打包，不能复用陈旧 tarball；每个 workspace 包在 publish 前必须验证构建产物存在。

这一定义刻意排除了默认云端上传、默认自动修改仓库、默认调用 LLM、默认 npm publish。后续增强可以继续扩大 detector 集合和 provider 集成，但不能破坏上述安全边界。

## 开源定位

当前项目按开源项目建设，暂不按商业 SaaS 建设。不做默认云端上传，不做付费转化漏斗，不把组织 dashboard 放在首要路径。

这不等于缩小产品目标。实施会按可验证纵切推进，但每条纵切都必须接入最终架构，不允许做一个以后要扔掉的 MVP。

## 产品红线

- 不默认修改用户仓库。
- 不默认静默修改全局 Git 配置；本地 hook 只使用 repo-local `core.hooksPath`，且必须由用户显式启用或选择 `--install-hooks`。
- 不默认执行文档中的 shell 命令。
- 不默认把私有代码交给 LLM。
- 不把 LLM 判断伪装成确定性事实。
- 不输出没有证据的 finding。
- 不让 agent 为了通过检查删除 source binding、frontmatter 或 review log。
- 不让本地 GUI 对未添加、未 realpath 归一化或不存在的仓库 root 执行扫描、打开文件、脚手架或 CI 写入动作。
- 不让本地 GUI 接受跨站浏览器写请求或无限制请求体。
- 不让路径、patch proposal、review-log finding id 通过 `..`、绝对路径、换行、NUL 或 symlink 逃出仓库边界。
- 不让 MCP `allowWrites=true` 变成任意本机路径写入权限；写工具仍必须限制在 server `cwd` 内。
- 不让 GitHub Action safe auto-fix 把 `..`、绝对路径、drive separator、空段、NUL、LF、CR 或 realpath 逃逸路径交给 `git add`。
- 不把本地仓库绝对路径发送给外部 LLM patch provider。
- 不让不同入口各自发明漂移判断；CLI、MCP、Local App、Git hook 和 agent skill 必须复用同一个 core report 和 runtime fingerprint。
- 不把旧构建产物当成当前版本的发布验证证据。
- 不开发、发布或规划独立安装应用；GitHub 集成边界止于用户显式添加的 GitHub Action，非 GitHub 仓库走 Local Git Gate 和通用本地 CLI recipes。
