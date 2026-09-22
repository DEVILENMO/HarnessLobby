# Harness Lobby CLI Skeleton

跨 harness 的终端协作大厅（Mode A 可运行骨架）。

## 像素 Logo

来自 `icon.png` 的 24×24 像素，在终端用彩色半块方块（`▀`/`▄`）拼出：

```bash
npm run icon -w @harness-lobby/cli          # 半块渲染
npm run icon:full -w @harness-lobby/cli     # 全方块背景色渲染
# 也可用：lobby icon / lobby icon --full
```

TUI 启动页也会显示同一枚像素 icon。

## 快速开始（一键）

```bash
npm install
npm run build   # 首次需要，生成各包 dist
npm run lobby
# 或在 PATH 上直接：lobby
```

一条命令会：内嵌 Lobby Server → 拉起 mock-harness → 进入 TUI。退出时一并清理。

常用旗标：

| 命令 | 说明 |
|---|---|
| `lobby` | 一键全开（默认） |
| `lobby --no-mock` | 不拉 mock-harness |
| `lobby --external` | 只连已有 Lobby |
| `lobby --port 4311` | 内嵌 server 端口 |

在 TUI 中：

```
@mock-harness 帮我把 ROS 节点改成支持 GelSight
```

会 lazy 创建 BoundSession，并看到 mock 流式回写。

## 进阶（三终端）

```bash
npm install

# 1) Lobby Server
npm run dev:server

# 2) Mock Harness Plugin
npm run dev:mock-harness

# 3) CLI TUI
npm run dev:cli
```

在 CLI 中：

```
@mock-harness 帮我把 ROS 节点改成支持 GelSight
```

会 lazy 创建 BoundSession，并看到 mock 流式回写。

## Slash 命令

| 命令 | 说明 |
|---|---|
| `/rooms` | 房间列表 |
| `/join <主题\|id>` | 切换房间 |
| `/new <主题>` | 新建房间 |
| `/members` | 成员 |
| `/harnesses` | harness 注册表 |
| `/bound` | 当前房间 bound sessions |
| `/reset <slug>` | 解绑 session |
| `/help` `/quit` | 帮助 / 退出 |

## 包结构

- `packages/protocol` — 共享契约
- `packages/server` — Lobby Server（REST + WS + mention 路由）
- `packages/plugin-sdk` — harness 侧 Mode A SDK
- `packages/cli` — Ink TUI + 像素 icon
- `examples/mock-harness` — 独立 mock 插件进程

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `LOBBY_PORT` | `4311` | Server 端口 |
| `LOBBY_HOST` | `127.0.0.1` | Server 绑定地址 |
| `LOBBY_WS_URL` | `ws://127.0.0.1:4311` | plugin 连接地址 |
| `LOBBY_HTTP_URL` | `http://127.0.0.1:4311` | CLI REST 地址 |
| `LOBBY_TOKEN` | `ilv_mock_open` | mock-harness token |
