# 让 Artifact 具备 AG-UI 效果

研究日期：2026-08-26

## 先纠正一个概念

AG-UI 不是“生成一个 UI 的格式”，而是 Agent 与前端之间的双向、事件驱动运行时协议。[官方介绍](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/introduction.mdx) 明确把两者分开：A2UI、MCP-UI、Open-JSON-UI 负责描述/生成组件，AG-UI 负责把 Agent、状态、工具调用和用户交互连接起来。[Generative UI 说明](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/generative-ui-specs.mdx)

因此我们的目标应定义为：

> Artifact 不再只是 Agent 生成后供人查看的 HTML，而是一个拥有自己的状态、工具和中断处理能力的 AG-UI client surface。

## AG-UI 的最小运行模型

官方协议的核心抽象是：前端提交 `RunAgentInput`，Agent 返回有序的 `BaseEvent` 流；传输可以是 SSE、WebSocket 或其他方式。[Architecture](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/architecture.mdx)

| AG-UI 事件 | Artifact 中的表现 |
| --- | --- |
| `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR` | surface 显示运行中、完成、失败状态 |
| `TEXT_MESSAGE_*` | 聊天区或 Artifact 内的流式说明文字 |
| `TOOL_CALL_START/ARGS/END/RESULT` | Agent 驱动的按钮、筛选、提交、刷新等动作 |
| `STATE_SNAPSHOT` | 完整替换 Artifact 的共享状态 |
| `STATE_DELTA` | 用 RFC 6902 JSON Patch 增量更新状态 |
| `ACTIVITY_SNAPSHOT/DELTA` | 计划、检索进度、校验结果等结构化活动 |
| `RUN_FINISHED(outcome=interrupt)` | Artifact 内联审批、补充信息、编辑后继续 |
| `CUSTOM` | Artifact 专属事件，必须经过命名空间和 schema 校验 |

状态机制是关键：AG-UI 要求 snapshot 建立基线、delta 做增量，前端发现序列分歧时重新请求 snapshot。[State management](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/state.mdx)

## 我们现在差在哪里

当前 checkout 的 WebSocket 已有消息、`stream_delta`、`tool_use`、`tool_result` 和 `runtime_plan`，但它们是 CatsCo 私有消息类型，不是可复用的 AG-UI event stream：

- [`MsgServerData`](../../server/datamodel.go) 只有聊天数据字段，没有标准 `runId`、`messageId`、`toolCallId`、state revision 或 event type。
- [`webapp/src/api.js`](../../webapp/src/api.js) 能广播 WebSocket 消息，但没有 AG-UI event reducer、snapshot/delta 重同步或 tool result continuation。
- 当前 Artifact preview 的 [`postMessage` bridge](../../webapp/src/widgets/chat-message.jsx) 主要做 page context 和结果 writeback，属于一次性请求/响应，不是持续事件流。
- Artifact 开发线 `fix/files-images-time-sort-cursor @ 0302250` 已经有 context snapshot、preview session、writeback 幂等和 stale 检查，这是很好的安全基座，但仍缺少 Artifact-scoped 的连续 AG-UI stream。

## 推荐架构：Artifact AG-UI Bridge

```text
Agent runtime
    │  AG-UI events (existing WebSocket first, SSE later)
    ▼
CatsCo AG-UI router
    │  validates topic / agent / artifact / version / session
    ├── Chat event store + message UI
    └── Artifact session bridge
            │  nonce + exact origin + bounded postMessage
            ▼
       Artifact iframe runtime
            ├── state snapshot / JSON Patch reducer
            ├── activity and run status
            ├── declared frontend tools
            └── interrupt / approval UI
```

### 1. 事件使用官方形状，路由信息放在受控 metadata

不要发明 `catsco_state_update`、`catsco_tool_start` 等平行协议。直接采用 AG-UI 事件名和字段，在 `metadata.catsco_artifact` 放路由信息：

```json
{
  "type": "STATE_DELTA",
  "delta": [
    {"op": "replace", "path": "/rows/0/status", "value": "approved"}
  ],
  "metadata": {
    "catsco_artifact": {
      "contract_version": "catsco.artifact-agui.v1",
      "artifact_id": "lesson-report",
      "agent_uid": 440,
      "publish_version": 3,
      "preview_session": "aps_…",
      "region_id": "review-table"
    }
  }
}
```

服务端必须重新解析并绑定这些字段，不能信任 iframe 或 Agent 自己声明的 URL。没有合法绑定的事件只能进入聊天调试流，不能进入 Artifact。

### 2. Artifact runtime 是一个小型 AG-UI client

在 HTML/React Artifact 中提供一个很薄的运行时，而不是把完整 host SDK 暴露给 iframe：

```js
const artifact = createCatscoArtifactRuntime({
  artifactId: 'lesson-report',
  regionId: 'review-table',
});

artifact.onState((state) => render(state));
artifact.onActivity((activity) => renderProgress(activity));
artifact.registerTool({
  name: 'approve_row',
  parameters: { /* JSON Schema */ },
  execute: async (args) => updateLocalSelection(args),
});
```

runtime 只通过 nonce-tagged `postMessage` 与 parent 通讯：

- parent → iframe：AG-UI event、theme、focus、interrupt；
- iframe → parent：声明的 tool call、用户输入、state intent、receipt；
- iframe 不直接获得 CatsCo cookie、内部 API、任意 URL 或 host 方法。

沙箱细节要特别注意：`allow-scripts` 且不带 `allow-same-origin` 的 iframe 可能以 opaque origin (`event.origin === "null"`) 运行，不能把 origin 字符串当作唯一身份。应同时校验 `event.source === 绑定的 frame.contentWindow`、一次性/短时 nonce、Artifact/版本/session 绑定；有真实 origin 时再做 exact-origin 校验。这样不需要为了通信而扩大 sandbox 权限。

### 3. 让 Artifact state 成为共享状态，而不是 HTML 内部变量

建议每个 Artifact session 维护：

```ts
type ArtifactAGUIState = {
  artifactId: string;
  publishVersion: number;
  revision: number;
  data: unknown;
  selection?: unknown;
  activity?: Record<string, unknown>;
  pendingInterrupts?: string[];
};
```

状态更新要求：

- 初次打开或重连发送 `STATE_SNAPSHOT`；
- 正常更新发送 `STATE_DELTA`；
- 每个 event 带 `runId`/`sequence`，重复事件幂等；
- patch 失败、版本过期或序列断裂时，Artifact 请求 snapshot；
- 状态上限、JSON 深度、数组长度和 patch 数量沿用现有 context 限制。

### 4. Tool call 才是“AG-UI 感”的核心

AG-UI 的工具由前端定义并通过 `RunAgentInput.tools` 传给 Agent，参数使用 JSON Schema；Agent 再通过 `TOOL_CALL_START → ARGS → END` 请求执行。[官方 Tools](https://docs.ag-ui.com/concepts/tools)

对 Artifact 的映射：

1. Artifact manifest 声明少量工具，例如 `filter_rows`、`select_record`、`request_approval`、`submit_answer`。
2. Host 根据当前用户、Agent、版本和 capability policy 过滤工具后，才传给 Agent。
3. Agent 调用工具时，Artifact 显示“正在执行/等待确认”，而不是静默改变页面。
4. Artifact 执行本地 UI 行为，或请求用户确认，再把 `ToolMessage`/`TOOL_CALL_RESULT` 返回到同一个 run/thread。
5. 破坏性操作必须走 interrupt/resume，而不是把按钮点击伪装成普通 writeback。

### 5. Human-in-the-loop 要做成 inline interrupt

AG-UI 的 interrupt 会结束当前 run，前端展示 `reason/message/responseSchema`，用户解决或取消后通过 `RunAgentInput.resume[]` 开始下一段运行。[Interrupts](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/interrupts.mdx)

在 Artifact 里，审批应该出现在触发它的 region 旁边：

- `pending`：控件锁定，显示 Agent 请求和影响范围；
- `resolved`：发送结构化 payload，恢复 Agent；
- `cancelled/expired`：保持页面可读，清除待处理动作；
- 重连后从 server snapshot 恢复，而不是依赖浏览器内存。

## 生成式 UI 怎么放进来

如果用户说的“AG-UI 效果”还包括 Agent 临时生成表单、筛选器、审批卡或数据视图，那么需要在 AG-UI 之上选一个 UI spec：

- **短期推荐**：定义受限的 `catsco.artifact-ui.v1` JSON schema，使用现有 React 组件渲染；事件通过 AG-UI `CUSTOM` 或工具调用传输。
- **兼容路线**：评估 A2UI/Open-JSON-UI/MCP-UI，先接入 schema renderer，再决定是否允许 HTML/React bundle。
- **不要**把模型返回的任意 HTML 直接插入 iframe；AG-UI 官方的生成 UI 草案也把“生成描述/数据/输出 schema”和“实际 UI 生成”分成两步。[Draft](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/drafts/generative-ui.mdx)

## 最小可交付切片

### Slice 1：事件桥（先让一个 Demo 活起来）

- 增加 `server/agui_protocol.go` 和 TypeScript `agui-events.js`，实现官方核心事件的 schema/校验。
- 在现有 WebSocket 顶层增加非持久化 `agui` envelope，先支持 `RUN_*`、`STATE_*`、`ACTIVITY_*`、`TOOL_CALL_*`、`CUSTOM`。
- 为 Artifact preview session 增加 event router，把目标事件转给当前 iframe。
- 新增一个教学报告 Artifact：Agent 改变表格状态、更新进度、请求一次审批，页面无需刷新。

### Slice 2：工具与恢复

- Artifact manifest/工具注册和 capability filter。
- Tool result / interrupt resume 的 WS 路由和幂等存储。
- 重连后的 `STATE_SNAPSHOT`、sequence gap 检测和 stale preview 处理。

### Slice 3：真正的生成式 UI

- `artifact-ui.v1` schema + schema discovery/validation。
- 表单、选择器、表格、图表、审批卡等安全 renderer。
- 将 schema 事件与 Artifact region 绑定，支持定向更新而不是重建整页。

## 验收标准

一个 Artifact Demo 至少应能做到：

1. 用户打开产物后，Agent 发出的状态变化在 250ms 级别内更新页面，不需要轮询或刷新。
2. Agent 可调用 Artifact 声明的前端工具，参数显示、权限校验、结果回传完整可追踪。
3. Artifact 内的审批/编辑会暂停并恢复同一个 Agent run，而不是新开一条无上下文消息。
4. 断线重连后页面从 snapshot 恢复，delta 不重复、不乱序、不污染其他 Artifact。
5. 同一个 event 既能被聊天 UI 观察，也能按 metadata 精确路由到 Artifact region。
6. 未声明的工具、错误 Agent/Topic/Artifact/版本、伪造 origin/source 和超限 payload 全部拒绝。

## 取舍结论

第一阶段不需要无限画布，也不需要把所有 HTML 变成 React。最小闭环是：

> AG-UI 标准事件流 + Artifact-scoped state store + 声明式 frontend tools + inline interrupt + 安全 iframe bridge。

这比当前“预览 + context snapshot + result writeback”多了一层持续运行时，但可以复用 Artifact 开发线已有的 preview session、opaque context ref、版本绑定和幂等 receipt。
