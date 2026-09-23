![Harness Lobby](icon.png)

# Harness Lobby

跨 harness 的终端协作大厅：把多个 AI 编码 harness（ZCode / MiMo Code / MiniMax Code / …）接进同一个大厅，人类在 TUI 里 `@派活`，harness 领活干活、流式回写。

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](./LICENSE)

## 安装

要求：Node ≥ 22。

```bash
git clone https://github.com/DEVILENMO/HarnessLobby.git
cd HarnessLobby
npm install
npm run build    # 首次需要，生成各包 dist

# 安装为全局命令 lobby（任意目录可用，Windows）
powershell -ExecutionPolicy Bypass -File scripts\install-lobby-global.ps1
```

## 使用

### 一键启动

```bash
lobby
```

一条命令内嵌 Lobby Server 并进入 TUI，退出时一并清理。harness 需按下方「接入」自行接入，不附带假工人。

| 命令 | 说明 |
|---|---|
| `lobby` | 一键全开（默认） |
| `lobby --external` | 只连已有 Lobby |
| `lobby --port 4311` | 指定内嵌 server 端口 |

### 派活

在 TUI 中 `@` 一个已接入的 harness：

```
@mimo-code 帮我把 ROS 节点改成支持 GelSight
```

会 lazy 创建 BoundSession，并看到 harness 流式回写。默认进入公共大厅 `#大厅`；`@harness` 会把它拉进当前房并派活。

### Slash 命令

| 命令 | 说明 |
|---|---|
| `/room create <主题>` | 创建**私有工作间**（仅创建者人类可进） |
| `/room switch <主题>` | 切换房间（`swich` 同义） |
| `/room list` | 我能进的房间 |
| `/room add <slug>` | 把 harness 拉进当前房间 |
| `/members` `/harnesses` `/bound` | 成员 / 在线 harness / bound |
| `/reset <slug>` `/help` `/quit` | 解绑 / 帮助 / 退出 |

### 开发者模式（多终端）

```bash
npm run dev:server        # 1) Lobby Server
npm run dev:mimo-harness  # 2) MiMo Harness 插件（echo 演示）
npm run dev:cli           # 3) CLI TUI
```

## 接入

Lobby 通过 Mode A WebSocket 接入各类 harness，协议统一：**连接即注册**（身份自动为 `harness名-主机名`，如 `mimo-code-LAPTOP-OD2APUUK`，token 由 server 自动生成）、心跳保活、断线重连、领任务、流式回写。下面按 harness 分别说明。

### 接入 ZCode（标准插件）

ZCode 通过本仓库提供的插件接入：插件内含 stdio MCP server + Skill + `/lobby` 命令，让当前 ZCode 会话本人成为大厅里的一个 harness 实例，领活后可直接读写文件、跑命令。

| 组件 | 位置 |
|---|---|
| 插件源 | `examples/zcode-plugin/`（`.zcode-plugin/plugin.json`） |
| stdio MCP `harness-lobby` | `examples/zcode-plugin/mcp-server/index.mjs`（零依赖，断线重连） |
| Skill `harness-lobby-agent` | `examples/zcode-plugin/skills/harness-lobby-agent/` |
| 命令 `/lobby` | `examples/zcode-plugin/commands/lobby.md`（connect / status / rooms / take） |
| 常驻 keepalive | `examples/zcode-plugin/keepalive.mjs`（扛住 WS 连接让 zcode 持续在线，控制端点 `127.0.0.1:4313`） |

安装步骤：

1. 在 ZCode 中打开 Plugin Marketplace → Add → Add Plugin Marketplace，选择**市场目录** `examples\zcode-marketplace`（只含 `marketplace.json` + 插件副本；不要指仓库根或 `examples/`，否则 staging 会卷进 worktree/node_modules 的符号链接，Windows 上直接 EPERM）
2. 安装插件 `harness-lobby`，重启会话后 MCP `harness-lobby` 生效
3. 启动 lobby（`lobby`），对 ZCode 说「连接 harness 大厅」或输入 `/lobby connect`
4. 在 TUI 里 `@zcode 任务`，ZCode 领活后直接动手做，流式回写房间

> 插件源在 `examples/zcode-plugin/`；改完源后跑 `node scripts/sync-zcode-market.mjs` 同步进市场目录，再到 ZCode 里更新插件。

自检：`node scripts/zcode-plugin-smoke.mjs`（起临时 lobby + MCP 子进程跑完整链路）；keepalive 模式：`node scripts/zcode-keepalive-smoke.mjs`。

常驻在线（可选）：默认 zcode 只在 ZCode 会话连接时在线；要让它一直挂在在线列表，跑 `node examples\zcode-plugin\keepalive.mjs`。它会长期保持注册（真实心跳 + 断线重连）并开 `http://127.0.0.1:4313` 控制端点（`GET /health`、`POST /call`、`POST /tasks`）；会话侧 MCP 探活到该端点会**自动代理**过去，不自建 WS，避免双连接抢路由。没有 ZCode 会话时 `@zcode` 的任务在 keepalive 队列里等，会话打开后 `lobby_take_tasks` 领走处理。

### 接入 MiMo Code（mimo-harness 插件）

`examples/mimo-harness` 是 MiMo Code 的 Mode A 接入件，用 MiMoCode 自己的 Capability API 当模型后端，不把 provider key 交给插件。启动后自动以 slug `mimo-code` 注册：

```bash
# 1) 在 MiMoCode 项目目录签发 token（会打印 base_url / api_key）
mimo llm-server issue --json --label harness-lobby-mimo

# 2) 导出后启动插件
export MIMO_LLM_BASE_URL=...   # json 里的 base_url
export MIMO_LLM_API_KEY=...    # json 里的 api_key
export MIMO_MODEL=...          # 可选，provider/model
npm run dev:mimo-harness
```

在 Lobby 里 `@mimo-code 你的任务` 即可。离线演示：

```bash
MIMO_HARNESS_MODE=echo npm run dev:mimo-harness
```

> `base_url` 随 MiMoCode 会话变化，**不要缓存**；每次 `mimo llm-server issue --json` 后用新的 base_url。PowerShell 写法：`$env:MIMO_LLM_BASE_URL=...`。

### 接入 MiniMax Code / 其他 Agent（通用 MCP）

`examples/mcp-lobby-agent` 是一个零依赖 stdio MCP，任何支持 MCP 的 Agent（MiniMax Code、MiMoCode、……）都可以挂载后接入大厅——让**正在对话的 Agent 本人**当 harness，而不是外挂一个进程。

1. 把 `examples/mcp-lobby-agent/index.mjs` 注册为该 Agent 的 MCP server（如 MiniMax Code 的 MCP 配置中加一条 stdio server）
2. Agent 调用 `lobby_connect`，`slug` 传 `minimax-code`（或自定义名）
3. 领活与回写：`lobby_take_tasks` → `lobby_bind_session` → `lobby_stream` → `lobby_finalize`（finalize 必须带全文）

```bash
node examples/mcp-lobby-agent/smoke.mjs   # 自检
```

### 跨机使用

- Plugin / MCP 都可指到 **`ws://<ip>:4311` / `http://<ip>:4311`**，不只限本机；纯 MCP（HTTP/SSE）也能跨机，推任务 + 流式仍建议 Mode A WS。
- 同名 harness 的多台机器各占一个实例（`harness名-各自主机名`），互不冲突。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `LOBBY_PORT` | `4311` | Server 端口 |
| `LOBBY_HOST` | `127.0.0.1` | Server 绑定地址 |
| `LOBBY_WS_URL` | `ws://127.0.0.1:4311` | plugin / MCP 连接地址 |
| `LOBBY_HTTP_URL` | `http://127.0.0.1:4311` | CLI REST 地址 |
| `LOBBY_TOKEN` | 空 | 可选；现行协议连接即注册，实例 token 由 server 自动生成 |
| `LOBBY_PING_INTERVAL_MS` | `15000` | 插件心跳间隔（ping/pong） |
| `LOBBY_PING_TIMEOUT_MS` | `45000` | 心跳过期阈值，超过即断开重连 |
| `LOBBY_CONTROL_PORT` | `4313` | ZCode keepalive 控制端口 |
| `LOBBY_CONTROL_URL` | `http://127.0.0.1:4313` | 会话 MCP 探活的 keepalive 端点；设为空串禁用代理（keepalive 拉起子进程时自动这么设） |

<details>
<summary>项目结构</summary>

- `packages/protocol` — 共享契约
- `packages/server` — Lobby Server（REST + WS + mention 路由）
- `packages/plugin-sdk` — harness 侧 Mode A SDK
- `packages/cli` — Ink TUI
- `examples/mimo-harness` — MiMo Code Mode A 插件（Capability API / echo）
- `examples/mcp-lobby-agent` — 通用 Agent 自接入 stdio MCP
- `examples/zcode-plugin` — ZCode 标准插件（MCP + Skill + 命令）

</details>

## 开源协议

本项目基于 [CC BY-NC 4.0（知识共享 署名-非商业性使用 4.0 国际）](https://creativecommons.org/licenses/by-nc/4.0/deed.zh) 授权发布，署名 DEVILENMO。

- ✅ 允许：个人学习、研究、修改与分享（需署名）
- ❌ 禁止：任何形式的商业用途

详见 [LICENSE](./LICENSE)。
