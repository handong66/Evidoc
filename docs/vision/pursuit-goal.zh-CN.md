# Evidoc 追求目标

Evidoc 追求的不是“帮项目多写一点文档”，而是让仓库里的知识成为可验证、可审计、可被 agent 安全消费的工程资产。

第一性原理判断如下：

1. Coding agent 的输入会决定它的输出。
2. 仓库文档、AGENTS.md、CLAUDE.md、README、API 示例和架构说明已经是 agent 的事实源。
3. 如果事实源漂移，agent 不会显式报错，而是会基于旧事实生成看似合理的错误变更。
4. 因此文档漂移不是内容品控问题，而是上下文污染问题。
5. 上下文污染必须进入工程控制流，像测试、类型检查和 lint 一样被检测、解释、审查和阻断。

## 目标状态

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

- CLI 支持一键 `npx evidoc` 本地 App、`app` / `serve` GUI 入口、本地扫描、本地 Git `guard` 门禁、通用 CI recipes、仓库 index、finding explain、图谱、dashboard、patch draft、patch validate、多仓库聚合和 GitHub Action 等价入口。
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
