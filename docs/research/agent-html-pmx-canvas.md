# Agent-HTML 与 PMX Canvas：Artifacts 借鉴研究

> 研究日期：2026-08-26  
> 外部源码快照：Agent-HTML `05a16a91448e0da8ccef571ca6b0ad2c56a69181`、PMX Canvas `c0af93c5c3a9a8913d1bdb0f7dd17c6c50e89c71`。  
> 本地基线：当前工作树 `14f3ab1`；`origin/main` 为 `c4f244d`。共享 worktree 中另有 Artifact 开发线 `fix/files-images-time-sort-cursor @ 0302250`，已包含 context snapshot、semantic page context、preview refresh 和 result writeback，但尚未等同于当前 checkout。下文会分别标注“当前 checkout”和“Artifact 开发线”。

## 结论先行

我们现在的 Artifact 系统已经把“发布、索引、权限、删除/恢复、预览、下载、移动端体验”做得比较完整：

- 服务端有云端产物索引和管理契约，支持 Agent/节点路由以及跨 origin 校验（[`server/cloud_artifacts.go`](../../server/cloud_artifacts.go)、[`server/artifact_nodes.go`](../../server/artifact_nodes.go)）。
- 前端有统一的文件描述、HTML/PDF/Markdown/表格预览、响应式 sheet、焦点管理和 iframe 沙箱（[`webapp/src/widgets/chat-message.jsx`](../../webapp/src/widgets/chat-message.jsx#L1409)、[`webapp/src/widgets/chat-message.jsx`](../../webapp/src/widgets/chat-message.jsx#L2146)）。
- 但当前 checkout 的核心模型仍偏向“一个 URL/文件 = 一个 Artifact”，缺少可稳定定位的区域、可读的语义上下文和受控的结果回写。
- `origin/main`/Artifact 开发线已经补上了相当一部分后两项：`artifact-ref`、页面上下文快照、`postMessage` 请求/响应、版本化结果 writeback、幂等 receipt。新工作应以这些实现为基线，而不是再造一套协议。

最值得借鉴的不是 PMX 的“无限画布”本身，而是两项目共同体现的边界：

> Artifact = 可渲染表面 + 稳定身份/区域 + 有界上下文 + 受控交互/结果。

建议优先级：

1. **P0：把 Artifact/Region 协议正式化**，让消息卡、预览面板、Agent 上下文都引用同一个稳定 ID。
2. **P0：收敛 Artifact 开发线的上下文与 writeback 链路**，把它作为唯一受信任的交互边界。
3. **P1：引入 renderer registry 和可声明的能力策略**，让 HTML、结构化 UI、文档、图表有清晰的渲染/安全层级。
4. **P1：补齐校验、来源、版本、实时更新和历史比较**。
5. **P2：先做“可 pin/focus 的 Artifact 工作区”，暂缓完整无限画布、22 个 MCP 工具和复杂空间图谱。

## 两个项目分别带来的启发

### Agent-HTML：把“可审阅的区域”当成协议

Agent-HTML 将生成物放在一个可持久化的 source workspace 中，由 host 负责发现、构建、校验、主题和审阅；作者侧只需要遵循 headless 的 `Artifact`/`Block` 协议。[README](https://github.com/Sayhi-bzb/Agent-HTML/blob/05a16a91448e0da8ccef571ca6b0ad2c56a69181/README.md) 和 [React protocol](https://github.com/Sayhi-bzb/Agent-HTML/blob/05a16a91448e0da8ccef571ca6b0ad2c56a69181/packages/react/src/index.tsx) 的关键点：

- Artifact 有稳定标题和边界，Block 有稳定的 kebab-case `id` 与标题。
- DOM 上有机器可识别的 data attributes，host 能生成目录、滚动定位、悬浮审阅层。
- 控件变化通过结构化事件暴露，保留当前状态和最近变化，而不是让 host 读取任意 React 内部状态。
- validator 在生成物进入 host 前检查导出、Block ID、依赖边界、危险 import、inline style 等问题。[validator](https://github.com/Sayhi-bzb/Agent-HTML/blob/05a16a91448e0da8ccef571ca6b0ad2c56a69181/packages/kernel/src/validate.mjs)
- block prompt lifecycle 把 `filePath + blockId + title` 作为定向修订目标，而不是把整份页面重新塞回对话。[host surface](https://github.com/Sayhi-bzb/Agent-HTML/blob/05a16a91448e0da8ccef571ca6b0ad2c56a69181/packages/cli/src/host/artifact/artifact-surface.tsx)

对我们的直接启发：生成物不应只有 `url/title/version`；即使暂时不托管 React source，也应在 HTML 中输出稳定的 `data-catsco-artifact` 和 `data-catsco-region-id`，并在索引中带上 region 的标题、顺序和摘要。

### PMX Canvas：把“上下文和能力”放在服务端边界

PMX 是空间工作台：文件、网页、图表、HTML、差异和任务节点共存，人的 pin/布局会成为 Agent 的结构化上下文。[README](https://github.com/pskoett/pmx-canvas/blob/c0af93c5c3a9a8913d1bdb0f7dd17c6c50e89c71/Readme.md) 和 [node types](https://github.com/pskoett/pmx-canvas/blob/c0af93c5c3a9a8913d1bdb0f7dd17c6c50e89c71/docs/node-types.md) 的可借鉴部分：

- 节点是 typed model，不让每个 renderer 自己发明数据格式；从 `json-render`、`html` 到 `web-artifact` 有明确的复杂度层级。
- HTML 预览和“新标签页打开”使用同一份服务端 surface，避免 iframe/srcDoc 两套内容漂移。[html surface](https://github.com/pskoett/pmx-canvas/blob/c0af93c5c3a9a8913d1bdb0f7dd17c6c50e89c71/src/server/html-surface.ts)
- 每种节点都有有界的 Agent summary、来源/元数据和可选位置；上下文不是把原始 HTML 无限制地交给模型。[agent context](https://github.com/pskoett/pmx-canvas/blob/c0af93c5c3a9a8913d1bdb0f7dd17c6c50e89c71/src/server/agent-context.ts)
- iframe 默认 `allow-scripts`、opaque origin；AX 交互默认关闭，按节点类型设置 capability ceiling，服务端再次校验并把 sandbox 请求限制在自己的 node。[AX interaction](https://github.com/pskoett/pmx-canvas/blob/c0af93c5c3a9a8913d1bdb0f7dd17c6c50e89c71/src/server/ax-interaction.ts)
- 文件节点用 watcher 自动更新，较大文本、二进制和表格都有明确上限和降级行为。[file watcher](https://github.com/pskoett/pmx-canvas/blob/c0af93c5c3a9a8913d1bdb0f7dd17c6c50e89c71/src/server/file-watcher.ts)

对我们的直接启发：先复用“typed renderer + server trust boundary + bounded context”三件事；二维布局、自由手绘和完整 AX timeline 属于产品形态，不是 Artifact 基础协议。

### Artifact 开发线已经解决了什么

`fix/files-images-time-sort-cursor @ 0302250` 已经把最重要的上下文闭环串起来：预览绑定 Agent/Topic/Artifact/版本、页面 context snapshot、`postMessage` handshake、result delivery receipt、幂等与 stale 检查；当前预览打开时仍以约 5 秒轮询 registry 来发现新版本。因而真正的剩余缺口不是“再做一套 context”，而是把这些能力提升为公开、稳定的 Artifact/Region 协议，并减少 renderer/预览路径的分叉。

## 与当前系统的对照

| 能力 | 当前 checkout | Artifact 开发线 | 借鉴后的目标 |
| --- | --- | --- | --- |
| 发布/索引/管理 | `cloud-artifacts.index.v1`、active/deleted、delete/restore | 已保留 | 增加 Artifact/Region contract，不破坏旧字段 |
| 预览 | 按扩展名/MIME 分支；HTML、PDF、Markdown、CSV/XLSX、文本 | 增加 artifact preview binding | renderer registry + 一个 canonical surface URL |
| 身份 | `id/title/kind/url/publish_version` | `catsco.artifact-ref.v1`，按 Agent 解析精确 ID | 版本化 ArtifactRef + 稳定 RegionRef |
| 上下文 | 当前分支没有可信页面上下文协议 | `artifact-page-context`、opaque snapshot ref、严格大小/深度限制 | 只传 opaque ref；页面语义由 iframe 主动、限额、可验证地提供 |
| 交互/回写 | 当前预览主要是查看、打开、下载 | result/writeback contract、receipt、幂等、stale 检查 | 仅允许声明的 sink，服务端决定是否应用 |
| 安全 | sandbox、referrer policy、trusted URL；远程预览有不同 sandbox | 绑定 preview session 和来源 | capability 默认 deny，按 renderer/Artifact 缩小权限 |
| 主题/独立打开 | iframe 与新窗口的路径存在分支 | 已有共享 preview 方向 | 同一个服务端包装文档负责 iframe 和新页 |
| 可审阅性 | 消息卡和侧栏能看产物 | 可绑定 focus/context/writeback | region 目录、选区、定向 prompt、验证诊断 |
| 实时性/历史 | 手动刷新/本地变更事件；显示 publish version | 活跃预览约 5 秒轮询、版本刷新 handshake、快照失效 | SSE/WS 更新、版本比较、恢复和 stale banner |

## 建议的最小协议

不要先复制完整的 Agent-HTML source workspace；先给现有云产物增加一层稳定、向后兼容的元数据：

```json
{
  "contract_version": "catsco.artifact.v1",
  "id": "report-2026-08",
  "agent_uid": 42,
  "title": "课堂报告",
  "kind": "html",
  "url": "https://artifact-node.example/artifacts/report-2026-08/v3",
  "publish_version": 3,
  "regions": [
    {"id": "summary", "title": "结论摘要", "order": 1, "summary": "…"}
  ],
  "agent_summary": "…",
  "provenance": {"source_title": "课堂任务", "generated_at": "…"},
  "capabilities": {"context": true, "result_sinks": ["report.update.v1"]}
}
```

HTML 约定只需增加稳定标记，不把 CSS selector 暴露给 host：

```html
<main data-catsco-artifact="true" data-catsco-artifact-id="report-2026-08">
  <section data-catsco-region-id="summary" data-catsco-region-title="结论摘要">…</section>
</main>
```

页面上下文沿用 `origin/main` 的约束：`request_id`、精确 `source/origin`、250ms 左右超时、16KB 总上下文、24 个控件、8KB semantic JSON，并由服务端生成短时 opaque `context_ref`。结果回写沿用 `result_id + sink_id + displayed_version + expected_state_revision + receipt`，不允许 iframe 直接调用内部 API。

## 分阶段落地

### P0：协议和边界（高收益、低耦合）

1. 若目标分支尚未包含 Artifact 开发线，先合并/审计 context、snapshot、writeback；若已包含，则优先补齐 API/WS/前端契约文档、公开版本号和端到端测试。
2. 给 cloud artifact index 增加 `contract_version`、`agent_uid`、`regions`、`agent_summary`、`provenance`、`capabilities`，旧 Artifact 缺省为空即可继续预览。
3. 预览 iframe 注入稳定 Artifact/Region attributes；侧栏增加目录、当前 region、复制“针对这一块继续”的入口。
4. 将 iframe 与新标签页统一到一个服务端 surface wrapper：统一标题、主题、content height、message bridge 和 CSP/sandbox。

### P1：可发现、可诊断、可持续

1. 新增 renderer registry：`json-render`（结构化低成本）、`html`（sandbox）、`web-artifact`（需要构建的应用）以及文件/PDF fallback；每个 renderer 声明最大大小和 capability ceiling。
2. 增加生成前/发布后的 validator：检查 contract、ID、来源、依赖、资源大小、可访问性和危险能力；把诊断显示在 Artifact 侧栏。
3. 为 Artifact 更新提供 SSE/WS 事件（版本、状态、删除/恢复、失效原因），替代固定轮询；预览绑定失效时显示“有新版本，刷新/比较”。
4. 将 `source_title` 扩展为 provenance/lineage：输入文件、生成时间、模型/Agent、校验状态、依赖和关联会话；上下文摘要只取有界 sidecar，不扫描整份 HTML。
5. 以 publish version 为基础增加版本 diff、回滚/恢复和快照保留策略。

### P2：等需求证明后再做

- 无限二维画布、自由手绘、空间邻近语义。
- 完整 work/approval/steer/timeline AX 层；这些可以先接入现有聊天和 Artifact 侧栏。
- 复杂 MCP surface（全量 schema 工具、跨节点 flow materialization）。

## 不建议照搬的部分

- **不要先引入 PMX 的完整画布数据库和空间图谱。** 我们当前用户入口是会话/消息；在没有“同时比较多个产物、长期编排任务、空间记忆”证据前，复杂度和迁移成本高于收益。
- **不要把所有 Artifact 都升级成 React/Tailwind bundle。** PMX 自己也分三档；简单表格/报告用 JSON 或 HTML 更快、更易审计。
- **不要让 Artifact iframe 拥有 host 权限。** Agent-HTML 的 block event、PMX 的 nonce/capability/server validation 都说明：DOM 事件是协作信号，不是授权凭证。
- **不要依赖 CSS selector、坐标或可变文本作为身份。** 只认服务端生成的 Artifact ID、版本和稳定 Region ID。
- **不要把原始 HTML或完整交互历史放进模型上下文。** 使用摘要、选区、最近变化和 opaque snapshot；每一层都设字节、深度、数量和超时上限。

## 取舍判断（第一性原理 + Bayes）

第一性原理把问题拆成四个不可再省的动作：**显示**（render）、**指认**（identify/focus）、**理解**（bounded context）、**改变**（controlled result）。当前系统的“显示”已经足够强；缺口集中在后三个动作，因此投资应先补协议和边界，而不是先换 UI 形态。

以下是基于源码证据的主观决策置信度（不是线上测量）：

| 借鉴项 | 置信度 | 证据与原因 |
| --- | ---: | --- |
| Artifact/Region 稳定元数据 | 0.90 | Agent-HTML 的 Block 和 PMX 的 typed node 都把可定位身份作为 host/agent 协作前提；我们当前主要只有 URL。 |
| 有界语义上下文 + opaque ref | 0.95 | Artifact 开发线已实现，且两项目都把 agent-readable summary 放在边界内；收益直接、风险可测试。 |
| 版本化结果 writeback | 0.90 | Artifact 开发线已有 receipt/idempotence/stale 语义；能把“预览”变成可完成的工作流。 |
| renderer registry/能力 ceiling | 0.80 | PMX 的三档 renderer 与 capability policy 可直接解释当前扩展名分支的增长问题。 |
| 无限画布/空间上下文 | 0.30 | 只有 PMX 强依赖空间交互；对当前聊天入口尚无同等强证据，先做 focus/pin 的线性版本更符合 Occam。 |

## 建议的验收指标

- 旧 Artifact 无新元数据时，预览、下载、删除/恢复行为零回归。
- 同一 Artifact 的 iframe 与新标签页内容、版本和主题一致。
- Agent 收到的是 bounded summary/context ref，而不是原始 HTML；超限输入稳定降级并可观测。
- 过期版本、重复 result、错误 Agent/Topic、伪造 origin/source 全部被服务端拒绝。
- 用户能从消息卡在两步内定位到一个 region，并发出只针对该 region 的后续请求。
- 版本更新能通过事件触发 stale 状态，用户可比较/恢复，而不需要盲目刷新。
