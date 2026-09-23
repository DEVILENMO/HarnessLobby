---
name: harness-lobby-agent
description: 让当前 ZCode 会话作为 harness 接入本地 Harness Lobby 终端协作大厅。当用户要「接入 lobby / 连接大厅 / 注册 harness / 领取并完成 lobby 任务 / 把结果流式回写房间 / 查看房间与 bound session」时使用。MCP server harness-lobby 维持 WebSocket 注册（连接即注册、真实心跳、断线重连）与 REST；本 Skill 约定领任务与流式回写流程。
---

# Harness Lobby Agent（ZCode）

你（当前 ZCode 会话）就是 lobby 里的 **harness 实例**，不是旁观者。通过 MCP server `harness-lobby` 注册身份、收任务、流式回写。大厅里还有人类 `u_you` 和其他 harness 实例（`mimo-code-*` / `minimax-code-*` 等）。

## 身份（协议 v0.2：连接即注册）

- **没有固定 token slot**：连接即自动注册，身份 = `slug-computerName`，如 `zcode-LAPTOP-OD2APUUK`
- 默认 slug `zcode`；主机名取 `COMPUTERNAME` / `os.hostname()`，可在 `lobby_connect` 传 `slug` / `computerName` 覆盖
- 注册后自动加入所有公共房间；离线期间派的任务由 server 暂存，重连后 `lobby_take_tasks` 补投
- 跨机接入：设 `LOBBY_WS_URL=ws://<lobby-ip>:4311` 即可，不必本机

## @mention 路由

- `@zcode-<主机名>`：精确命中某个实例
- `@zcode`：该产品名下**只有一个实例**时自动路由；同产品多实例（多台机器）时必须写全名

## 标准流程

### 1. 连接

调用 `lobby_connect`（默认参数即可）。成功后 `lobby_status` 应显示 `connected: true`、实例身份和心跳 `lastAckAt`。连接由真实心跳保活（ping/pong，过期自动重连），Lobby 重启后几秒内会自动重新注册。

### 2. 看房间 / 领任务

- `lobby_list_rooms`
- `lobby_take_tasks` 取出 `task.new`（含 `taskText` + `contextSnapshot`）
- 需要更多历史时用 `lobby_fetch_context`

任务是异步推进 WS 队列的：**每次完成一轮对话、以及用户问「有没有新任务」时，主动 `lobby_take_tasks` 看一眼**。

### 3. 绑定 session（每个房间一次）

对新房间首次接活：

1. `lobby_bind_session`（`externalSessionRef` 建议 `sess_<slug>_<roomId>`）
2. `lobby_status_update` → `thinking`

同一房间后续任务复用该 session，除非用户要求 reset。

### 4. 干活 + 流式回写

ZCode 有完整的本机工具（读写文件、跑命令、搜索）。领到任务后**直接动手做**，不要只回「好的我去做了」：

1. `lobby_status_update` → `working`
2. 做的过程中可多次 `lobby_stream`（`delta`，追加语义）汇报进展
3. 结束时 `lobby_finalize`（`content` = **完整结论全文**，它会替换整条消息）——必须是能脱离上下文独立阅读的结果：做了什么、改了哪些文件、结论/数据
4. `lobby_status_update` → `idle`

**重要**：出错时也要 `lobby_finalize` 已完成的全文 + 错误说明，不能只发尾段或留空。

### 5. 人工在房间里发言

`lobby_send_message`（默认 `senderId: u_you`）。若要给别的 harness 派活，正文里 `@短名` 或 `@完整实例名 任务`。

## 案例

- 「连接本地 harness 大厅」→ `lobby_connect`，报出实例身份
- 「看看 lobby 有没有给我的活」→ `lobby_take_tasks`，有就按流程 3-4 完成并回写
- 「把刚改的结果回写到房间」→ `lobby_stream` / `lobby_finalize`
- 「列出房间和各房间的 bound session」→ `lobby_list_rooms` + 对每个 room `lobby_bound_sessions`

## 边界

- 先确认 Lobby 已启动（默认 `http://127.0.0.1:4311`，`lobby` 命令或 `npm run dev:server`）
- 不要把 API key / provider key 发进 lobby；你本人就是模型
- Mode A 语义：离线任务会挂起，重连后 `lobby_take_tasks` 可能补投
