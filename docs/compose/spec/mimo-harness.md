---
feature: mimo-harness
status: delivered
updated: 2026-02-15
branch: feat/mimo-harness
commits: 749413c..7bc165b
---

# MiMo Harness Plugin（Mode A）

## Report

**What was built** — `examples/mimo-harness`（`@harness-lobby/mimo-harness`）作为 Mode A 插件把 MiMo 接进 Lobby：`@mimo-code` 派活后，用 MiMoCode Capability API（`/v1/chat/completions` SSE）流式回写；每 room 绑定 `sess_mimo_<roomId>`。Server seed 增加 `mimo-code` / token `ilv_mimo_open`。缺 `MIMO_LLM_*` 时 fail-fast 并提示 `mimo llm-server issue`；`MIMO_HARNESS_MODE=echo` 可离线演示。错误路径 `finalize(partial+error)` 保留已出流式内容；SSE 尾行无换行也会 flush；`base_url` 带不带 `/v1` 均可。

**Verification** — `npm run build` PASS；`npm run typecheck` PASS；`node --import tsx scripts/mimo-llm-unit.ts` PASS（SSE flush / partial-on-error / echo-full）；`node --import tsx scripts/mimo-harness-smoke.ts` PASS（注册/bind/final/缺凭证非零退出）。首轮 review 2 critical 已修，复审确认 FIXED 且无新增 critical。真实模型链路需本机 `mimo llm-server issue` 后验证（本环境无可用 `mimo` 二进制）。

**Journey log** — 1) MiMo Desktop 扩展面是 Skill/MCP/workflow，不是 VS Code 插件；Lobby 接入件必须是独立 Mode A 进程。2) `applyFinal` 会**替换**全文，错误出口必须带上已 stream 的 partial。3) SSE 解析要在流结束时 flush decoder+残余 buf，否则丢最后一条 `data:`。4) Capability API 的 `base_url` 可能已含 `/v1`，拼 URL 要兼容。5) smoke 里等插件注册要用轮询，固定 sleep 容易误判。

## [S1] Problem

Harness Lobby 目前只有 mock-harness。需要把 **MiMo（MiMo Desktop / MiMoCode）** 接进大厅，使 `@mimo-code` 能在房间里接活、用真实模型流式回写。MiMo Desktop 自身扩展面是 Skill/MCP，不是 VS Code 式插件，因此接入件必须是独立 **Mode A plugin 进程**。

## [S2] Design

### 定位

```
Lobby Server ←WS Mode A→ mimo-harness(plugin-sdk) → Capability API /v1/chat/completions
                                                      （MiMoCode 实例已内嵌）
```

- harness profile：`slug=mimo-code`，`displayName=MiMo Code`，capabilities `["对话","读上下文摘要","流式回写"]`
- token：`ilv_mimo_open`（与 mock 同级的骨架 token，写入 server seed）
- 不直连 provider key；模型凭证只走 MiMoCode 本地 `/v1`

### 执行桥（task → 模型）

收到 `task.new` 后：

1. `status.thinking` → `status.working`
2. 组装 chat messages：system 说明「你是 Lobby 里的 harness 成员」；user = 任务文本 + 精简 context_snapshot（最近 N 条，含发言人）
3. 调 `POST ${MIMO_LLM_BASE_URL}/v1/chat/completions`，`Authorization: Bearer ${MIMO_LLM_API_KEY}`，`stream: true`
4. SSE 增量 → `message.stream`；结束 → `message.final`（全文）→ `status.idle`
5. 每个 room 首次 bind `external_session_ref=mcp_sess_<roomId>` 风格的 `sess_mimo_<roomId>`

### 配置

| 变量 | 必需 | 说明 |
|---|---|---|
| `LOBBY_WS_URL` | 是 | 默认 `ws://127.0.0.1:4311` |
| `LOBBY_TOKEN` | 否 | 默认 `ilv_mimo_open` |
| `MIMO_LLM_BASE_URL` | 是* | 来自 `mimo llm-server issue --json` 的 `base_url` |
| `MIMO_LLM_API_KEY` | 是* | 同上 `api_key` |
| `MIMO_MODEL` | 否 | 可选 `provider/model` 约束 |
| `MIMO_HARNESS_MODE` | 否 | `llm`（默认）\| `echo`（离线演示/测试） |

\* `MIMO_HARNESS_MODE=echo` 时不需要 LLM 凭证：回显任务并模拟流式，便于无 MiMo 实例时验收 Lobby 链路。

### 包布局

```
examples/mimo-harness/
  package.json          @harness-lobby/mimo-harness
  src/index.ts          connectPlugin + onTask
  src/llm.ts            SSE chat client
  src/prompt.ts         context_snapshot → messages
```

根 README 增「接入 MiMo」一节：`mimo llm-server issue --json` → 导出 env → `npm run dev:mimo-harness`（或并入 `lobby` 的可选 flag，V1 **不**默认拉起，避免抢 mock 槽位）。

### 错误行为

- 缺 `MIMO_LLM_*` 且非 echo：启动即退出码 1，打印如何 `mimo llm-server issue`
- LLM 401/404：`message.final` 写明错误码与是否需 `mimo llm-server issue/revoke`；不重试 401
- 网络失败：同上，stream 已出的部分保留 + `final` 补错误说明
- Lobby 断线：沿用 plugin-sdk outbox / 重连

## [S3] Out of Scope

- 把 MiMo Desktop 做成 VS Code 式宿主插件
- Mode B / MCP tools
- 文件系统工具、真实代码执行（仅聊天能力接入）
- 多 MiMo 账号 / 鉴权体系
- 修改 `lobby` 默认一键行为

## Tasks

- [x] T1: server seed 增加 `mimo-code` harness — acceptance: `/harnesses` 含 `slug=mimo-code` 且 token 可注册 (covers: S2)
- [x] T2: `examples/mimo-harness` LLM 流式桥 — acceptance: `MIMO_HARNESS_MODE=echo` 下注册、bind、stream、final 全通；配置 `MIMO_LLM_*` 时走 SSE chat (covers: S2; depends: T1)
- [x] T3: 错误与缺省配置 — acceptance: 缺凭证非 echo 时明确报错；LLM 401 以 final 回写错误文案 (covers: S2; depends: T2)
- [x] T4: README「接入 MiMo」 — acceptance: 文档可按步骤用 `mimo llm-server issue` 接入 (covers: S2; depends: T2)
