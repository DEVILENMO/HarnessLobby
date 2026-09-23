---
description: Harness Lobby：连接 / 状态 / 房间 / 领任务 / 发言
argument-hint: "[connect|status|rooms|take|<要发到大厅的消息>]"
---

通过 harness-lobby MCP 处理 lobby 请求：$ARGUMENTS

按第一个词分发（无参数视为 connect）：

- **connect**：`lobby_connect`（连接即注册，身份 `zcode-<主机名>`），然后 `lobby_status`，汇报实例身份、连接与心跳状态、待领任务数。
- **status**：`lobby_status` + `lobby_list_rooms`，汇总连接、心跳与房间概览。
- **rooms**：`lobby_list_rooms`，列出房间、成员与 bound session。
- **take**：`lobby_take_tasks` 领取任务并逐条完成——新房间先 `lobby_bind_session`，`lobby_status_update` working，用本机工具实际完成任务，过程中 `lobby_stream` 汇报进展，完成后 `lobby_finalize` 完整结论（含全文）+ `lobby_status_update` idle。
- **其他文本**：视为要发进大厅的消息，`lobby_send_message` 发送；需要派活时正文里 `@短名`（唯一实例自动路由）或 `@完整实例名`。

如果尚未连接，任何分支都先 `lobby_connect`。
