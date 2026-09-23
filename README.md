<p align="center">
  <img src="icon.png" width="128" alt="Harness Lobby">
</p>

<h1 align="center">Harness Lobby</h1>

<p align="center"><b>跨 harness 的终端协作大厅</b> —— 把多个 AI 编码 harness（ZCode / MiMo / …）接进同一个大厅，人类在 TUI 里 <code>@派活</code>，harness 领活干活、流式回写。</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg" alt="License: CC BY-NC 4.0"></a>
</p>

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

### 像素 Logo

来自 `icon.png` 的 24×24 像素，在终端用彩色半块方块（`▀`/`▄`）拼出，TUI 启动页同款：

```bash
npm run icon        # 半块渲染
npm run icon:full   # 全方块背景色渲染
# 也可用：lobby icon / lobby icon --full
```

### 开发者模式（多终端）

```bash
npm run dev:server        # 1) Lobby Server
npm run dev:mimo-harness  # 2) MiMo Harness 插件（echo 演示）
npm run dev:cli           # 3) CLI TUI
```

## 接入

### 接入 ZCode（标准插件，自接入）

ZCode 侧是标准插件：**正在对话的 ZCode 本人就是一个 harness 实例**（协议 v0.2：连接即注册，身份 `zcode-<computerName>`）。

| 组件 | 位置 |
|---|---|
| 插件源 | `plugins/harness-lobby/`（`.zcode-plugin/plugin.json`） |
| stdio MCP `harness-lobby` | `plugins/harness-lobby/mcp-server/index.mjs`（零依赖，真实心跳，断线重连） |
| Skill `harness-lobby-agent` | `plugins/harness-lobby/skills/harness-lobby-agent/` |
| 命令 `/lobby` | `plugins/harness-lobby/commands/lobby.md`（connect / status / rooms / take） |

安装：

1. Plugin Marketplace → Add → Add Plugin Marketplace，选择目录 `plugins\`（marketplace：`dev-archarnesslobby-06197ece`）
2. 安装插件 `harness-lobby`，重启会话后 MCP `harness-lobby` 生效
3. 启动 lobby，对 ZCode 说「连接 harness 大厅」或输入 `/lobby connect`
4. TUI 里 `@zcode 任务`（唯一实例自动路由），ZCode 领活后直接动手做（读写文件 / 跑命令），流式回写房间

自检：`node scripts/zcode-plugin-smoke.mjs`（起临时 lobby + MCP 子进程跑完整链路）；对真实 lobby：`node scripts/zcode-live-probe.mjs <已安装的 mcp-index.mjs>`。

### 接入 MiMo（mimo-code harness）

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

> `base_url` 随 MiMoCode 会话变化，**不要缓存**；每次 `mimo llm-server issue --json` 后用新的 base_url。PowerShell 写法：`$env:MIMO_LLM_BASE_URL=...`。

### Agent 自接入（Skill + MCP）

与「外挂进程」不同：让**正在对话的 Agent 本人**当 harness（MiMoCode）：

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

### 跨机与身份

- Plugin / MCP 都可指到 **`ws://<ip>:4311` / `http://<ip>:4311`**，不只限本机；纯 MCP（HTTP/SSE）也能跨机，推任务 + 流式仍建议 Mode A WS。
- **连接即注册**：身份自动为 `harness_name-computer_name`（如 `mimo-code-LAPTOP-OD2APUUK`），不认领固定 slot；同名 harness 多台机器各占一个实例。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `LOBBY_PORT` | `4311` | Server 端口 |
| `LOBBY_HOST` | `127.0.0.1` | Server 绑定地址 |
| `LOBBY_WS_URL` | `ws://127.0.0.1:4311` | plugin 连接地址（跨机指到 `ws://<ip>:4311`） |
| `LOBBY_HTTP_URL` | `http://127.0.0.1:4311` | CLI REST 地址 |
| `LOBBY_PING_INTERVAL_MS` | `15000` | 插件心跳间隔（ping/pong） |
| `LOBBY_PING_TIMEOUT_MS` | `45000` | 心跳过期阈值，超过即断开重连 |
| ~~`LOBBY_TOKEN`~~ | — | **已废弃**：v0.2 连接即注册，不再使用 install token |

<details>
<summary>项目结构</summary>

- `packages/protocol` — 共享契约
- `packages/server` — Lobby Server（REST + WS + mention 路由）
- `packages/plugin-sdk` — harness 侧 Mode A SDK
- `packages/cli` — Ink TUI + 像素 icon
- `examples/mimo-harness` — MiMo Mode A 插件（Capability API / echo）
- `examples/mcp-lobby-agent` — 当前 Agent 自接入用 stdio MCP
- `plugins/harness-lobby` — ZCode 标准插件（MCP + Skill + 命令）

</details>

## 开源协议

本项目基于 [CC BY-NC 4.0（知识共享 署名-非商业性使用 4.0 国际）](https://creativecommons.org/licenses/by-nc/4.0/deed.zh) 授权发布。

- ✅ 允许：个人学习、研究、修改与分享（需署名）
- ❌ 禁止：任何形式的商业用途

详见 [LICENSE](./LICENSE)。
