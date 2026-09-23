# harness-lobby（ZCode 插件）

把**当前 ZCode 会话**作为 harness 实例接入本地 Harness Lobby（自接入模式，协议 v0.2：连接即注册）。

## 组件

| 组件 | 说明 |
|---|---|
| MCP `harness-lobby` | `mcp-server/index.mjs`，零依赖（Node ≥ 22 全局 WebSocket/fetch），断线自动重连，**真实心跳**（ping/pong + lastAckAt 过期即重连），离线任务重连后补投 |
| Skill `harness-lobby-agent` | 约定领任务 / 绑 session / 流式回写流程（finalize 必须带全文） |
| 命令 `/lobby` | `connect` / `status` / `rooms` / `take` / 直接发消息 |
| keepalive 常驻进程 | `keepalive.mjs`：拉起 MCP 长期保持注册，开控制端点 `127.0.0.1:4313`（`GET /health`、`POST /call`、`POST /tasks`）；会话 MCP 探活到它会自动代理，不自建 WS |

## 常驻在线

默认 zcode 只在 ZCode 会话连接时在线；要让 `zcode-<主机名>` 常驻在线列表：

```powershell
node examples\zcode-plugin\keepalive.mjs   # 仓库根目录执行，或用计划任务/开机自启
```

没有 ZCode 会话时 `@zcode` 的任务在 keepalive 队列里等，会话打开后 `lobby_take_tasks` 领走处理。keepalive 拉起子进程时会自动设 `LOBBY_CONTROL_URL=''` 禁用代理探活（否则子进程会探到父进程端点自递归）。

## 身份（协议 v0.2）

- **连接即注册，无固定 token slot**：身份 = `zcode-<computerName>`（如 `zcode-LAPTOP-OD2APUUK`）
- 主机名取 `COMPUTERNAME` / `os.hostname()`；`lobby_connect` 可传 `slug` / `computerName` 覆盖
- 注册后自动加入公共房间；`@zcode` 短名在唯一实例时由 server 自动路由
- 跨机：`LOBBY_WS_URL=ws://<lobby-ip>:4311`（`.mcp.json` 不钉 env，用户级 env 直接生效）

## 工具

`lobby_connect` / `lobby_status`（含心跳）/ `lobby_list_rooms` / `lobby_room_messages` / `lobby_fetch_context` / `lobby_send_message` / `lobby_take_tasks` / `lobby_bind_session` / `lobby_stream` / `lobby_finalize` / `lobby_status_update` / `lobby_bound_sessions`

## 用法

1. 启动 lobby（`lobby` 一键命令，或 `npm run dev:server`）
2. 装好本插件后，对 ZCode 说：「连接 harness 大厅」或输入 `/lobby connect`
3. 在 lobby TUI 里 `@zcode 任务`，ZCode 领任务后**直接动手做**（读写文件 / 跑命令），结果流式回写房间

自检：`node scripts/zcode-plugin-smoke.mjs`（起临时 lobby + MCP 子进程跑完整链路）；对真实 lobby：`node scripts/zcode-live-probe.mjs <mcp-index.mjs>`。
