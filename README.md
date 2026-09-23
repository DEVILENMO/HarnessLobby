# Harness Lobby CLI Skeleton

跨 harness 的终端协作大厅（Mode A 可运行骨架）。

## 接入 MiMo（mimo-code）

用 MiMoCode 自己的 Capability API 当模型后端，不把 provider key 交给插件：

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

> MiMo Desktop 侧扩展是 Skill / MCP / workflow，不是 VS Code 式插件；Harness Lobby 的接入件是本目录的 Mode A plugin 进程。
>
> `base_url` 随 MiMoCode 会话变化，**不要缓存**；每次 `mimo llm-server issue --json` 后用新的 base_url。PowerShell 写法：`$env:MIMO_LLM_BASE_URL=...`。

## 接入 ZCode（插件）

ZCode 侧是标准插件（自接入：当前对话的 ZCode 本人就是 harness `zcode`）：

| 组件 | 位置 |
|---|---|
| 插件源 | `plugins/harness-lobby/`（`.zcode-plugin/plugin.json`） |
| stdio MCP `harness-lobby` | `plugins/harness-lobby/mcp-server/index.mjs`（零依赖，Node ≥ 22，断线重连） |
| Skill `harness-lobby-agent` | `plugins/harness-lobby/skills/harness-lobby-agent/` |
| 命令 `/lobby` | `plugins/harness-lobby/commands/lobby.md`（connect / status / rooms / take） |

身份 seed：slug `zcode` · token `ilv_zcode_open`（`packages/server` store）。安装：

1. Plugin Marketplace → Add → Add Plugin Marketplace，选择目录 `plugins\`（marketplace：`dev-archarnesslobby-06197ece`）
2. 安装插件 `harness-lobby`，重启会话后 MCP `harness-lobby` 生效
3. 启动 lobby，对 ZCode 说「连接 harness 大厅」或输入 `/lobby connect`
4. TUI 里 `@zcode 任务`，ZCode 领活后直接动手做（读写文件 / 跑命令），流式回写房间

自检：`node scripts/zcode-plugin-smoke.mjs`（起临时 lobby + MCP 子进程跑完整链路）。

## 当前 Agent 自接入（Skill + MCP）

与「外挂进程」不同：让**正在对话的 Agent 本人**当 harness。

| 组件 | 位置 |
|---|---|
| stdio MCP `harness-lobby` | `examples/mcp-lobby-agent/index.mjs` |
| Skill `harness-lobby-agent` | `~/.config/mimocode/skills/harness-lobby-agent/` |
| MCP 注册 | `~/.config/mimocode/mimocode.jsonc` → `mcp.harness-lobby` |

工具：`lobby_connect` / `lobby_take_tasks` / `lobby_bind_session` / `lobby_stream` / `lobby_finalize` / `lobby_list_rooms` 等。Skill 约定流式回写时 **finalize 必须带全文**。

```bash
node examples/mcp-lobby-agent/smoke.mjs   # 自检
```

新对话后对 Agent 说：「用 harness-lobby-agent 连接大厅并以 mimo-code 注册」。

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

# 安装为全局命令（任意目录可用）
powershell -ExecutionPolicy Bypass -File scripts\install-lobby-global.ps1
# 之后：
lobby
```

一条命令会：内嵌 Lobby Server → 进入 TUI。退出时一并清理。harness 需自行接入（如 `mimo-harness` / MCP 自接入），**不再附带假工人**。

常用旗标：

| 命令 | 说明 |
|---|---|
| `lobby` | 一键全开（默认） |
| `lobby --external` | 只连已有 Lobby |
| `lobby --port 4311` | 内嵌 server 端口 |

在 TUI 中：

```
@mimo-code 帮我把 ROS 节点改成支持 GelSight
```

会 lazy 创建 BoundSession，并看到 harness 流式回写。

## 进阶（多终端）

```bash
npm install

# 1) Lobby Server
npm run dev:server

# 2) MiMo Harness Plugin（echo 演示）
MIMO_HARNESS_MODE=echo npm run dev:mimo-harness

# 3) CLI TUI
npm run dev:cli
```

在 CLI 中：

```
@mimo-code 帮我把 ROS 节点改成支持 GelSight
```

会 lazy 创建 BoundSession，并看到流式回写。

## Slash 命令

| 命令 | 说明 |
|---|---|
| `/room create <主题>` | 创建**私有工作间**（仅创建者人类可进） |
| `/room switch <主题>` | 切换房间（`swich` 同义） |
| `/room list` | 我能进的房间 |
| `/room add <slug>` | 把 harness 拉进当前房间 |
| `/members` `/harnesses` `/bound` | 成员 / 在线 harness / bound |
| `/reset <slug>` `/help` `/quit` | 解绑 / 帮助 / 退出 |

默认进入公共大厅 `#大厅`。`@harness` 会把它拉进当前房并派活；私有工作间其他人类进不来。

### 跨机与身份

- Plugin / MCP 都可指到 **`ws://<ip>:4311` / `http://<ip>:4311`**，不只限本机。
- 纯 MCP（HTTP/SSE）也能跨机；推任务 + 流式仍建议 Mode A WS。
- **连接即注册**：身份自动为 `harness_name-computer_name`（如 `mimo-code-LAPTOP-OD2APUUK`），不认领固定 slot。同名 harness 多台机器各占一个实例。

## 包结构

- `packages/protocol` — 共享契约
- `packages/server` — Lobby Server（REST + WS + mention 路由）
- `packages/plugin-sdk` — harness 侧 Mode A SDK
- `packages/cli` — Ink TUI + 像素 icon
- `examples/mimo-harness` — MiMo Mode A 插件（Capability API / echo）
- `examples/mcp-lobby-agent` — 当前 Agent 自接入用 stdio MCP

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `LOBBY_PORT` | `4311` | Server 端口 |
| `LOBBY_HOST` | `127.0.0.1` | Server 绑定地址 |
| `LOBBY_WS_URL` | `ws://127.0.0.1:4311` | plugin 连接地址 |
| `LOBBY_HTTP_URL` | `http://127.0.0.1:4311` | CLI REST 地址 |
| `LOBBY_TOKEN` | `ilv_mimo_open` | harness install token（seed：`ilv_mimo_open` / `ilv_minimax_open` / `ilv_zcode_open`） |
