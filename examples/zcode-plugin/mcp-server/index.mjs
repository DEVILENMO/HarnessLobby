#!/usr/bin/env node
/**
 * harness-lobby — ZCode 侧 stdio MCP server
 * 让当前 ZCode 会话作为 harness（默认 slug: zcode）接入 Harness Lobby。
 * 协议 v0.2.0：连接即注册（无固定 token slot），身份 = `slug-computerName`；
 * 真实心跳（ping/pong + lastAckAt 过期）；断线自动重连，重连后 server 补投离线任务。
 * 零依赖：Node >= 22 的全局 WebSocket / fetch。
 */
import os from 'node:os';
import process from 'node:process';

const LOBBY_HTTP = (process.env.LOBBY_HTTP_URL ?? 'http://127.0.0.1:4311').replace(/\/$/, '');
const LOBBY_WS = (process.env.LOBBY_WS_URL ?? LOBBY_HTTP.replace(/^http/, 'ws')).replace(/\/$/, '');
// keepalive 控制端点：探活成功就代理过去（常驻连接归 keepalive，避免双连接抢路由）。
// 显式设 LOBBY_CONTROL_URL='' 可禁用探活（keepalive 拉起自己的 MCP 子进程时必须这么做，
// 否则子进程会探到父进程的端点，自递归调 lobby_connect 直到超时）。
const CONTROL_URL_RAW = process.env.LOBBY_CONTROL_URL;
const CONTROL_URL = (CONTROL_URL_RAW ?? 'http://127.0.0.1:4313').replace(/\/$/, '');
const CONTROL_DISABLED = CONTROL_URL_RAW === '';
// 心跳：每 PING_INTERVAL 发一次 ping，超过 PONG_TIMEOUT 没收到任何 pong 就判定连接已死
const PING_INTERVAL_MS = Number(process.env.LOBBY_PING_INTERVAL_MS ?? 15000);
const PONG_TIMEOUT_MS = Number(process.env.LOBBY_PING_TIMEOUT_MS ?? 45000);

const computerName = () => process.env.COMPUTERNAME || os.hostname();

let proxyMode = false;

async function probeControl(timeoutMs = 600) {
  if (CONTROL_DISABLED) return null;
  try {
    const res = await fetch(`${CONTROL_URL}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function proxyCall(name, args = {}) {
  try {
    const res = await fetch(`${CONTROL_URL}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`keepalive ${name} -> ${res.status}`);
    const body = await res.json();
    if (!body.ok) throw new Error(body.error ?? 'keepalive error');
    // keepalive 的 /call 可能返回原始 MCP 信封，也可能已解包成对象
    const raw = body.result?.content?.[0]?.text;
    return raw ? JSON.parse(raw) : (body.result ?? {});
  } catch (e) {
    proxyMode = false;
    throw new Error(`${e?.message ?? e}（keepalive 掉线？重新 lobby_connect 将转为直连）`);
  }
}

/** @type {WebSocket|null} */
let socket = null;
let harnessId = null;
let connected = false;
let registerError = null;
let wantConnected = false;
let retryMs = 500;
let retryTimer = null;
let pingTimer = null;
let lastAckAt = 0;
/** 上次注册用的身份，重连时复用 */
let profile = null;
const pendingTasks = [];
const sessionByRoom = new Map();
const connectWaiters = [];

function sendMsg(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function rpcResult(id, result) {
  sendMsg({ jsonrpc: '2.0', id, result });
}

function rpcError(id, code, message) {
  sendMsg({ jsonrpc: '2.0', id, error: { code, message } });
}

async function rest(path, init) {
  const res = await fetch(`${LOBBY_HTTP}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(`${path} -> ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function wsSend(obj) {
  if (socket && socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(obj));
  } else if (!wantConnected) {
    throw new Error('尚未连接 Lobby，请先调用 lobby_connect');
  } else {
    throw new Error('Lobby WebSocket 未连接（重连中），稍后重试');
  }
}

function settleConnectWaiters() {
  while (connectWaiters.length) connectWaiters.shift()();
}

function waitForRegister(timeoutMs = 5000) {
  if (connected || registerError) return Promise.resolve();
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(wake, timeoutMs);
    connectWaiters.push(wake);
  });
}

function defaultProfile() {
  return {
    slug: 'zcode',
    displayName: 'ZCode',
    avatar: 'ZC',
    capabilities: ['对话', '代码生成', '文件读写', '命令执行', '流式回写'],
  };
}

function stopHeartbeat() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  lastAckAt = Date.now();
  pingTimer = setInterval(() => {
    if (Date.now() - lastAckAt > PONG_TIMEOUT_MS) {
      // 心跳过期：本地 connected=true 不可信，主动断开走重连
      registerError = `heartbeat stale ${((Date.now() - lastAckAt) / 1000).toFixed(1)}s`;
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      socket?.send(JSON.stringify({ type: 'ping' }));
    } catch {
      /* send 失败交给 close/error 处理 */
    }
  }, PING_INTERVAL_MS);
}

function openSocket() {
  registerError = null;
  stopHeartbeat();
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
  connected = false;

  const url = LOBBY_WS.includes('?')
    ? `${LOBBY_WS}&role=plugin`
    : `${LOBBY_WS}?role=plugin`;

  // 捕获本连接的引用：被更新的连接取代后，过期 socket 的事件一律忽略
  const ws = new WebSocket(url);
  socket = ws;

  ws.addEventListener('open', () => {
    if (socket !== ws) return;
    ws.send(
      JSON.stringify({
        type: 'register_lobby',
        token: profile?.token ?? '',
        profile: profile?.profile ?? defaultProfile(),
      })
    );
  });

  ws.addEventListener('message', (ev) => {
    if (socket !== ws) return;
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'register_ack':
        harnessId = msg.harnessId;
        connected = true;
        retryMs = 500;
        lastAckAt = Date.now();
        startHeartbeat();
        for (const roomId of msg.assignedRooms ?? []) {
          if (!sessionByRoom.has(roomId)) {
            sessionByRoom.set(roomId, `sess_${profile?.profile.slug ?? 'zcode'}_${roomId}`);
          }
        }
        settleConnectWaiters();
        break;
      case 'register_nack':
        connected = false;
        registerError = msg.error;
        settleConnectWaiters();
        break;
      case 'pong':
        lastAckAt = Date.now();
        break;
      case 'task.new':
        pendingTasks.push({
          roomId: msg.roomId,
          messageId: msg.messageId,
          mentions: msg.mentions ?? [],
          taskText: msg.taskText ?? '',
          contextSnapshot: msg.contextSnapshot ?? [],
          receivedAt: new Date().toISOString(),
        });
        break;
      default:
        break;
    }
  });

  // 必须挂 error handler：Lobby 重启时的 ECONNREFUSED 不能炸掉插件进程
  ws.addEventListener('error', () => {
    // close 事件会跟着来，重连逻辑在那里
  });

  ws.addEventListener('close', () => {
    if (socket !== ws) return;
    connected = false;
    stopHeartbeat();
    settleConnectWaiters();
    socket = null;
    if (wantConnected) scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    openSocket();
  }, retryMs);
  retryMs = Math.min(retryMs * 2, 8000);
}

function connectWs(args) {
  const p = args ?? {};
  profile = {
    token: p.token ?? process.env.LOBBY_TOKEN ?? '',
    profile: {
      slug: p.slug ?? 'zcode',
      computerName: p.computerName ?? computerName(),
      displayName: p.displayName ?? 'ZCode',
      avatar: 'ZC',
      capabilities: p.capabilities ?? defaultProfile().capabilities,
    },
  };
  wantConnected = true;
  registerError = null;
  openSocket();
  return waitForRegister();
}

const tools = [
  {
    name: 'lobby_connect',
    description:
      '连接本地 Harness Lobby 并注册（连接即注册，无 token）。身份 = `slug-computerName`，如 zcode-LAPTOP-OD2APUUK。',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '产品名，默认 zcode；最终身份为 `<slug>-<computerName>`' },
        computerName: { type: 'string', description: '主机名，默认 COMPUTERNAME / os.hostname()' },
        displayName: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'lobby_status',
    description: '查看 Lobby 连接、harness 实例身份、心跳、待处理 task.new 队列。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lobby_list_rooms',
    description: '列出所有房间。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lobby_room_messages',
    description: '读取房间消息（可 since）。',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        since: { type: 'string', description: '消息 id' },
      },
      required: ['roomId'],
    },
  },
  {
    name: 'lobby_fetch_context',
    description: '拉取房间上下文摘要（供处理任务时参考）。',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        limit: { type: 'number', default: 20 },
      },
      required: ['roomId'],
    },
  },
  {
    name: 'lobby_send_message',
    description: '向房间发送普通消息（可 @ 别的 harness 派活；短名 @zcode 在唯一实例时自动路由）。',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        content: { type: 'string' },
        senderId: { type: 'string', description: '默认 u_you' },
      },
      required: ['roomId', 'content'],
    },
  },
  {
    name: 'lobby_take_tasks',
    description: '取出 WS 收到的 task.new 任务（当前 ZCode 会话作为 harness 的待办）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 5 },
      },
    },
  },
  {
    name: 'lobby_bind_session',
    description: '为某房间绑定 harness session（首次接活时调用）。',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        externalSessionRef: { type: 'string' },
      },
      required: ['roomId'],
    },
  },
  {
    name: 'lobby_stream',
    description: '把任务结果增量流式回写到房间（追加语义）。',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        messageId: { type: 'string' },
        delta: { type: 'string' },
      },
      required: ['roomId', 'messageId', 'delta'],
    },
  },
  {
    name: 'lobby_finalize',
    description: '结束流式并写入最终全文（会替换该消息内容，需含已输出全文）。',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        messageId: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['roomId', 'messageId', 'content'],
    },
  },
  {
    name: 'lobby_status_update',
    description: '上报 harness 工作状态 thinking|working|idle。',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        state: { type: 'string', enum: ['thinking', 'working', 'idle'] },
      },
      required: ['roomId', 'state'],
    },
  },
  {
    name: 'lobby_bound_sessions',
    description: '列出房间内 bound sessions。',
    inputSchema: {
      type: 'object',
      properties: { roomId: { type: 'string' } },
      required: ['roomId'],
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'lobby_connect': {
      const ka = await probeControl();
      if (ka) {
        const r = await proxyCall('lobby_connect', args ?? {});
        proxyMode = true;
        return { ...r, mode: 'keepalive-proxy', control: CONTROL_URL };
      }
      proxyMode = false;
      await connectWs(args ?? {});
      return {
        connected,
        harnessId,
        instance: profile ? `${profile.profile.slug}-${profile.profile.computerName}` : null,
        registerError,
        lobby: LOBBY_HTTP,
        ws: LOBBY_WS,
        mode: 'direct',
      };
    }
    case 'lobby_status': {
      if (proxyMode) {
        try {
          return {
            ...(await proxyCall('lobby_status', {})),
            mode: 'keepalive-proxy',
            control: CONTROL_URL,
          };
        } catch {
          proxyMode = false;
        }
      }
      return {
        connected,
        harnessId,
        instance: profile ? `${profile.profile.slug}-${profile.profile.computerName}` : null,
        registerError,
        lobbyHttp: LOBBY_HTTP,
        lobbyWs: LOBBY_WS,
        mode: 'direct',
        heartbeat: {
          lastAckAt: lastAckAt ? new Date(lastAckAt).toISOString() : null,
          ageMs: lastAckAt ? Date.now() - lastAckAt : null,
          pingIntervalMs: PING_INTERVAL_MS,
          pongTimeoutMs: PONG_TIMEOUT_MS,
        },
        pendingTaskCount: pendingTasks.length,
        sessions: Object.fromEntries(sessionByRoom),
      };
    }
    case 'lobby_list_rooms':
      return rest('/rooms');
    case 'lobby_room_messages': {
      const q = args.since ? `?since=${encodeURIComponent(args.since)}` : '';
      return rest(`/rooms/${args.roomId}/messages${q}`);
    }
    case 'lobby_fetch_context': {
      const limit = args.limit ?? 20;
      const msgs = await rest(`/rooms/${args.roomId}/messages`);
      return msgs.slice(-limit);
    }
    case 'lobby_send_message': {
      return rest(`/rooms/${args.roomId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          senderId: args.senderId ?? 'u_you',
          content: args.content,
        }),
      });
    }
    case 'lobby_take_tasks': {
      if (proxyMode) return proxyCall('lobby_take_tasks', args);
      const n = args.limit ?? 5;
      return pendingTasks.splice(0, n);
    }
    case 'lobby_bind_session': {
      if (proxyMode) return proxyCall('lobby_bind_session', args);
      const ref = args.externalSessionRef ?? `sess_${args.roomId}`;
      sessionByRoom.set(args.roomId, ref);
      wsSend({ type: 'session.bind', roomId: args.roomId, externalSessionRef: ref });
      return { roomId: args.roomId, externalSessionRef: ref };
    }
    case 'lobby_stream': {
      if (proxyMode) return proxyCall('lobby_stream', args);
      wsSend({
        type: 'message.stream',
        roomId: args.roomId,
        messageId: args.messageId,
        delta: args.delta,
      });
      return { ok: true };
    }
    case 'lobby_finalize': {
      if (proxyMode) return proxyCall('lobby_finalize', args);
      wsSend({
        type: 'message.final',
        roomId: args.roomId,
        messageId: args.messageId,
        content: args.content,
      });
      return { ok: true };
    }
    case 'lobby_status_update': {
      if (proxyMode) return proxyCall('lobby_status_update', args);
      wsSend({ type: 'status.update', roomId: args.roomId, state: args.state });
      return { ok: true };
    }
    case 'lobby_bound_sessions': {
      return rest(`/rooms/${args.roomId}/bound-sessions`);
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

// --- minimal MCP stdio framing ---
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    void handleRpc(msg);
  }
});

async function handleRpc(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      rpcResult(id, {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'harness-lobby', version: '0.2.0' },
      });
      return;
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      return;
    }
    if (method === 'ping') {
      rpcResult(id, {});
      return;
    }
    if (method === 'tools/list') {
      rpcResult(id, { tools });
      return;
    }
    if (method === 'tools/call') {
      const result = await callTool(params?.name, params?.arguments ?? {});
      rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      });
      return;
    }
    if (id !== undefined) rpcError(id, -32601, `method not found: ${method}`);
  } catch (e) {
    if (id !== undefined) rpcError(id, -32000, String(e?.message ?? e));
  }
}

process.stdin.on('end', () => {
  wantConnected = false;
  stopHeartbeat();
  try {
    socket?.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
});
