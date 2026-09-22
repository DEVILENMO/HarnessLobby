---
feature: harness-lobby-cli
status: delivered
updated: 2026-02-15
branch: feat/harness-lobby-cli
commits: 4c15168..7a76f0e
---

# Harness Lobby CLI Skeleton (Mode A)

## Report

**What was built** — TypeScript npm workspaces 可运行骨架：`@harness-lobby/protocol` 共享 Mode A 契约；`@harness-lobby/server` 提供 REST + WS mention 路由、`(roomId, harnessId)` BoundSession、离线 pending 补投；`@harness-lobby/plugin-sdk` 负责握手/重连/outbox/幂等 final；`examples/mock-harness` 独立进程流式回写；`@harness-lobby/cli` 为 Ink TUI（房间切换、`@`+Tab 补全、流式消息、slash 命令），启动区用 `icon.png` 采样的 24×24 彩色半块像素 logo（`npm run icon` / `icon:full`）。

**Verification** — `npm run typecheck` PASS；`npm run build` PASS；`node --import tsx scripts/critical-probes.ts` PASS（messageId 连续性、final 终态、离线挂起落库）；`node --import tsx scripts/e2e-smoke.ts` PASS（register → @ 派活 → bind → 流式 final）；`npm run icon -w @harness-lobby/cli` 输出可辨识 AR 像素画。两轮 review：首轮 6 critical 已修，复审 22a16d1..7a76f0e 确认全部 FIXED 且无新增 critical。

**Journey log** — 1) 产品形态从 Web 原型改为纯 CLI/TUI，旧 `index.html` 不在本切片接入。2) 仅 Mode A；Mode B MCP 留待下一切片。3) Review 探出 `newMessage` 虽支持自定义 id 但调用方未传，导致 stream/final 分叉——边界以 live probe 而非仅 E2E 发现。4) SDK 发送队列与幂等 final 是 Mode A 流式可靠性的前提，不能只做 happy path。5) Windows 下 PowerShell 无 heredoc，生成 `pixel-icon` 时用临时 Python 脚本落盘更稳。

## [S1] Problem

Harness Lobby 需要一个跨 harness 的统一协作入口，让用户在共享房间里 `@harness` 派活并看到流式回写。当前工作区只有 Web 原型，缺少 Claude Code / Hermes Agent 那种终端优先的产品形态，也没有可运行的 Server + Plugin 契约实现。本切片交付 **TypeScript monorepo 可运行骨架**：真实 Lobby Server（WebSocket）、CLI/TUI 客户端、Plugin SDK，以及独立 mock-harness 进程，打通 Mode A 一条完整派活链路。

## [S2] Design

### 产品形态

纯 CLI/TUI，无 Web。用户心智对齐 Claude Code：全屏对话流 + 底部输入框 + slash 命令 + 流式 token。

### 包布局（npm workspaces）

```
harness-lobby-cli/
  package.json                 # workspaces: packages/*, examples/*
  packages/protocol/           # 共享类型与消息 schema（零运行时依赖）
  packages/server/             # Lobby Server
  packages/plugin-sdk/         # harness 侧接入 SDK
  packages/cli/                # TUI 客户端
  examples/mock-harness/       # Mode A 独立插件进程
  docs/compose/spec/           # 本文件
```

包名：`@harness-lobby/protocol`、`@harness-lobby/server`、`@harness-lobby/plugin-sdk`、`@harness-lobby/cli`、`@harness-lobby/mock-harness`。

### 数据模型

与产品定义对齐（内存态即可，骨架不做数据库）：

| 实体 | 关键字段 |
|---|---|
| Harness | `id`, `slug`, `displayName`, `avatar`, `mode: 'A'`, `status: 'online'\|'offline'\|'working'`, `capabilities[]`, `authToken`, `pluginEndpoint` |
| Room | `id`, `topic`, `memberIds[]`, `createdAt` |
| Member | `id`, `type: 'human'\|'harness'`, `displayName` |
| BoundSession | `id`, `roomId`, `harnessId`, `externalSessionRef`, `createdAt` |
| Message | `id`, `roomId`, `senderId`, `content`, `mentions[]`, `parentId?`, `createdAt`, `streamState: 'streaming'\|'final'`, `state?: 'thinking'\|'working'\|'idle'` |

核心不变量：`(roomId, harnessId) → BoundSession` 一对一。首次 `@` 时 lazy 创建；同一房间复用；跨房间隔离。

### Mode A 插件契约

**注册（HTTP 或 WS 首帧均可；骨架用 WS 首帧 + 预置 token）**

```
// client → server
{ type: "register_lobby", token, profile: {
    slug, displayName, avatar?, capabilities[], protocol: "mode-a"
} }

// server → client
{ type: "register_ack", lobbyId, wsUrl, assignedRooms: string[],
  harnessId, status: "online" }
```

**运行期 · Lobby → Plugin**

```
{ type: "task.new", roomId, messageId, mentions[], taskText,
  contextSnapshot: Message[] }
{ type: "room.message", roomId, messageId, content, senderId }
```

**运行期 · Plugin → Lobby**

```
{ type: "session.bind", roomId, externalSessionRef }
{ type: "message.stream", roomId, messageId, delta }
{ type: "message.final", roomId, messageId, content }
{ type: "status.update", roomId, state: "thinking"|"working"|"idle" }
```

**生命周期**

- 重连：plugin 重发 `register_lobby`；server 恢复其 bound sessions，补发未确认任务（骨架：内存 pending 队列）。
- 多房间：单 plugin 多 room，各 room 一 session。
- 离线：目标 plugin 不在线时任务挂起，上线后 `task.new` 补齐。

### Lobby Server 行为

- `ws://127.0.0.1:4311`（端口可 `LOBBY_PORT` 覆盖）。
- 启动时 seed：人类 `you`；harness `mock-harness`（token `ilv_mock_open`）；房间「大厅」「具身智能」。
- 发消息：CLI 经 HTTP `POST /rooms/:id/messages`（骨架用 REST + WS 广播，降低 CLI 复杂度）。
- Mention 路由：解析 `@slug` → 查 registry → 对目标 plugin 发 `task.new`（带 `contextSnapshot`，默认最近 20 条）→ 回写 `status.update` / 流式消息到 room，并广播给订阅的 CLI。
- REST（CLI 用）：
  - `GET /health`
  - `GET /rooms`
  - `POST /rooms` `{ topic }`
  - `GET /rooms/:id/messages?since?`
  - `POST /rooms/:id/messages` `{ senderId, content }` → `{ messageId }`
  - `GET /rooms/:id/bound-sessions`
  - `POST /rooms/:id/reset-session` `{ harnessId }`（显式解绑，下次 @ 重建）
  - `GET /harnesses`

### Plugin SDK 行为

```ts
connect({
  url, token, profile,
  onBind(roomId, externalSessionRef) => void,
  onTask(task: TaskNew) => void | Promise<void>,
}) => {
  stream(roomId, messageId, delta): void
  finalize(roomId, messageId, content): void
  status(roomId, state): void
  bind(roomId, externalSessionRef): void
  close(): void
}
```

SDK 负责：握手、心跳、断线重连、把 `message.stream` 切片发送、保证 final 幂等。Session 如何投递给真实 harness **不进 SDK**（mock 自己定时流式即可）。

### CLI / TUI 行为

技术：Node + Ink（React 终端 UI）。单一全屏布局：

```
┌ Lobby lobby_xxx · ws · Mode A ─────────────────┐
│ # 大厅    # 具身智能                            │  ← 房间 tabs / 列表
│───────────────────────────────────────────────│
│ You  09:12                                     │
│   @mock-harness 帮我写单测                      │
│ mock-harness  09:12  working · bs_ab12         │
│   正在读取…（流式）                             │
│───────────────────────────────────────────────│
│ › 输入消息，@harness 派活…                      │  ← composer
└ /rooms /join /new /members /reset /help ───────┘
```

- slash 命令：`/rooms` `/join <topic|id>` `/new <topic>` `/members` `/harnesses` `/bound` `/reset <slug>` `/help` `/quit`
- composer 支持 `@` 自动补全房间内 harness slug（骨架：输入 `@` 后 Tab 循环补全即可）
- Enter 发送；Shift+Enter 换行（Ink `useInput` 处理）
- 流式：mock-harness 的 `message.stream` 增量渲染 + 光标闪烁
- `@offline-harness`：消息标记挂起，activity 提示重连补齐

### 像素 Logo（amendment）

以仓库根目录 `icon.png` 为源（43×43 RGBA），降采样为 **24×24** 像素网格写入 `packages/cli/src/icon-grid.ts`。CLI 用彩色方块拼出：

- **半块模式**（默认）：每终端行合并两行像素，字符 `▀`/`▄`，前景/背景各着一色，共 24×12 格。
- **全方块模式**（`harness-lobby icon --full`）：每像素两格背景色空位，共 24×24。
- TUI 启动区固定渲染半块 logo；`packages/cli/src/pixel-icon.tsx` 同时导出 Ink 组件与纯 ANSI 字符串。

验收：`npm run icon` / `npm run icon:full`（根脚本）或 `npm run icon -w @harness-lobby/cli` 输出可辨识的品红→紫→蓝渐变 AR 图形，透明像素留空。

### mock-harness 行为

- 独立进程，用 `@harness-lobby/plugin-sdk` 连接 server
- `onTask`：先 `status.thinking` → `status.working` → 按固定脚本 token 流式输出 → `message.final` → `status.idle`
- 每个 `(roomId, harnessId)` 一个 `externalSessionRef`（如 `sess_<roomId>`），首次 bind
- 回复模板含任务回声，证明 taskText 与 contextSnapshot 已送达

### 演示剧本（验收主路径）

```bash
# terminal 1
npm run dev:server
# terminal 2
npm run dev:mock-harness
# terminal 3
npm run dev:cli
```

1. CLI 启动后可见房间列表与 `mock-harness` online
2. 在「具身智能」发送 `@mock-harness 帮我把 ROS 节点改成支持 GelSight`
3. 自动创建 BoundSession，侧栏/底部可见 `bs_*` 与 `sess_*`
4. mock 流式回写，最终 `message.final` 落定
5. ` /reset mock-harness` 后再次 `@`，生成新的 BoundSession

### 错误与边界

- token 非法：register 拒绝，CLI 显示 harness offline
- 发送时 plugin 离线：消息仍进 room，`task.new` 入 pending，上线补投
- 流中断：SDK 重连后以同一 `messageId` 继续；final 后忽略后续 delta
- 空 `@` 或未知 slug：按纯文本发送，不路由

## [S3] Out of Scope

- Mode B / MCP server 与 tools
- Web UI（工作区中旧 `index.html` 原型保留不动，不接入本骨架）
- 多人权限分级、跨 lobby 联邦、任务队列服务、富消息/文件
- 真实 MiniMax Code / Claude Code 插件（仅 mock-harness）
- 数据库持久化、鉴权体系、TLS、生产部署
- Python Plugin SDK

## Tasks

- [x] T1: monorepo 脚手架与 `@harness-lobby/protocol` 类型 — acceptance: `npm install` 成功，`protocol` 可被 server/cli/sdk 引用且类型与 S2 契约一致 (covers: S2)
- [x] T2: Lobby Server（REST + WS + mention 路由 + bound session + pending 补投）— acceptance: 对 `/health`、建房、发言、`@mock` 可返回；plugin 重连能收到 pending `task.new` (covers: S2; depends: T1)
- [x] T3: Plugin SDK — acceptance: 示例代码完成 register/bind/stream/final/status；断线自动重连并重注册 (covers: S2; depends: T1)
- [x] T4: mock-harness 独立进程 — acceptance: `node examples/mock-harness` 注册成功，收到 `task.new` 后流式回写并在 room 落 final (covers: S2; depends: T2, T3)
- [x] T5: CLI TUI — acceptance: `npm run dev:cli` 可列房/进房/发消息/`@` 补全/看流式；slash 命令可用；bound session 可见 (covers: S2; depends: T2, T1)
- [x] T6: 端到端演示脚本与 README 运行说明 — acceptance: 按 README 三终端命令可复现演示剧本 1–5 步 (covers: S2; depends: T2, T3, T4, T5)
- [x] T7: icon.png 像素 logo 渲染 — acceptance: `npm run icon` / `icon:full` 打印 24×24 彩色方块 AR 图标，TUI 启动区显示同一 logo (covers: S2; depends: T5)
