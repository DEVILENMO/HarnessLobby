---
feature: lobby-onecmd
status: in-progress
updated: 2026-02-15
branch: feat/lobby-onecmd
commits: 418da89..418da89
---

# lobby — 一键启动

## Report

## [S1] Problem

当前要开三个终端（`dev:server` / `dev:mock-harness` / `dev:cli`）才能玩转 Lobby。用户要和 Hermes 一样简单：敲一个 `lobby` 就全起来。

## [S2] Design

### 命令

| 入口 | 行为 |
|---|---|
| `lobby` | 默认一键：内嵌 Lobby Server + 拉起 mock-harness + 进入 TUI |
| `npx lobby` / `npm run lobby` | 同上（workspace 内） |
| `lobby icon` / `lobby help` | 沿用现有子命令 |
| `lobby --external` | 不内嵌 server，只连已有 `LOBBY_HTTP_URL` |
| `lobby --no-mock` | 一键 server+TUI，不拉 mock |
| `lobby --port <n>` | 内嵌 server 端口（默认 4311） |

### 进程模型

```
lobby (CLI 主进程)
├── LobbyServer   进程内实例（同进程 WS/REST）
├── mock-harness  子进程（plugin-sdk 真连 WS）
└── Ink TUI       前台交互
```

- 退出（`/quit`、Ctrl+C）：关 server、杀 mock 子进程，再退出。
- 端口占用：若 4311 已有 `/health`，默认自动改用该外部 server（等价 `--external`），并在 TUI 标注；仍失败则报错退出。
- mock 未装/启动失败：TUI 可用，状态区提示 mock offline。

### 包改动

- `@harness-lobby/cli`：新增 `src/onecmd.ts`；`bin` 增加 `lobby`；依赖 `@harness-lobby/server`；用 `createRequire` 解析并 spawn `@harness-lobby/mock-harness`。
- 根 `package.json`：`"lobby": "npm run lobby -w @harness-lobby/cli"`。
- README 快速开始改为先讲 `lobby` 一条命令，三终端保留为进阶。

### 错误行为

- 端口被非 Lobby 服务占用 → 明确报错，不瞎重试。
- TUI 拉起失败 → 杀子进程后退出非 0。
- 不改动 Mode A 契约与既有 `dev:*` 脚本。

## [S3] Out of Scope

- 全局 npm 发布 / 安装器
- Mode B、多 lobby、守护进程化（systemd/服务）
- 改 mock 回复内容或像素 logo

## Tasks

- [ ] T1: `lobby` 一键入口（内嵌 server + spawn mock + TUI + 清理） — acceptance: 在仓库根执行 `npm run lobby` 单命令进入 TUI，可见 mock online，可 `@mock-harness` 派活 (covers: S2)
- [ ] T2: 启动旗标与端口降级 — acceptance: `--port`/`--no-mock`/`--external` 生效；4311 被占用时能并到已有 server 或报错 (covers: S2; depends: T1)
- [ ] T3: README 一键说明 — acceptance: 快速开始以 `lobby` 为主路径 (covers: S2; depends: T1)
