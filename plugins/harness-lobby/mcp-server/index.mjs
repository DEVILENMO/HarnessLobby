#!/usr/bin/env node
/**
 * harness-lobby — ZCode 侧 stdio MCP server
 * 让当前 ZCode 会话作为 harness（默认 slug: zcode）接入 Harness Lobby。
 * 零依赖：Node >= 22 的全局 WebSocket / fetch。断线自动重连，重连后 server 会补投离线任务。
 */
import process from 'node:process';

const LOBBY_HTTP = (process.env.LOBBY_HTTP_URL ?? 'http://127.0.0.1:4311').replace(/\/$/, '');
const LOBBY_WS = (process.env.LOBBY_WS_URL ?? LOBBY_HTTP.replace(/^http/, 'ws')).replace(/\/$/, '');
const LOBBY_TOKEN = process.env.LOBBY_TOKEN ?? 'ilv_zcode_open';

/** @type {WebSocket|null} */
let socket = null;
let harnessId = null;
let connected = false;
let registerError = null;
let wantConnected = false;
let retryMs = 500;
let retryTimer = null;
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

function openSocket() {
  registerError = null;
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }
  connected = false;

  const url = LOBBY_WS.includes('?')
    ? `${LOBBY_WS}&role=plugin`
    : `${LOBBY_WS}?role=plugin`;

  socket = new WebSocket(url);

  socket.addEventListener('error', (ev) => {
    // ECONNREFUSED etc. — keep process alive and retry
    registerError = String(ev?.message ?? ev?.error ?? 'ws error');
    connected = false;
  });

  socket.addEventListener('open', () => {
    socket.send(
      JSON.stringify({
        type: 'register_lobby',
        token: profile?.token ?? LOBBY_TOKEN,
        profile: profile?.profile ?? defaultProfile(),
      })
    );
  });

  socket.addEventListener('message', (ev) => {
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
        for (const roomId of msg.assignedRooms ?? []) {
          if (!sessionByRoom.has(roomId)) {
            sessionByRoom.set(roomId, `sess_zcode_${roomId}`);
          }
        }
        settleConnectWaiters();
        break;
      case 'register_nack':
        connected = false;
        registerError = msg.error;
        settleConnectWaiters();
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

  socket.addEventListener('close', () => {
    connected = false;
    settleConnectWaiters();
    socket = null;
    if (wantConnected) scheduleReconnect();
  });
  socket.addEventListener('error', () => {
    // close 事件会跟着来，重连逻辑在那里
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
  profile = {
    token: args.token ?? LOBBY_TOKEN,
    profile: {
      slug: args.slug ?? 'zcode',
      displayName: args.displayName ?? 'ZCode',
      avatar: 'ZC',
      capabilities: args.capabilities ?? defaultProfile().capabilities,
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
      '连接本地 Harness Lobby 并以 harness 身份注册（Mode A WebSocket）。ZCode 默认身份 slug=zcode。',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'harness slug，默认 zcode' },
        displayName: { type: 'string' },
        token: { type: 'string', description: 'install token，默认读 LOBBY_TOKEN（ilv_zcode_open）' },
        capabilities: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'lobby_status',
    description: '查看 Lobby 连接、harness 身份、待处理 task.new 队列。',
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
    description: '向房间发送普通消息（可 @ 别的 harness 派活）。',
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
      await connectWs(args ?? {});
      return {
        connected,
        harnessId,
        registerError,
        lobby: LOBBY_HTTP,
        ws: LOBBY_WS,
      };
    }
    case 'lobby_status': {
      return {
        connected,
        harnessId,
        registerError,
        lobbyHttp: LOBBY_HTTP,
        lobbyWs: LOBBY_WS,
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
      const n = args.limit ?? 5;
      return pendingTasks.splice(0, n);
    }
    case 'lobby_bind_session': {
      const ref = args.externalSessionRef ?? `sess_${args.roomId}`;
      sessionByRoom.set(args.roomId, ref);
      wsSend({ type: 'session.bind', roomId: args.roomId, externalSessionRef: ref });
      return { roomId: args.roomId, externalSessionRef: ref };
    }
    case 'lobby_stream': {
      wsSend({
        type: 'message.stream',
        roomId: args.roomId,
        messageId: args.messageId,
        delta: args.delta,
      });
      return { ok: true };
    }
    case 'lobby_finalize': {
      wsSend({
        type: 'message.final',
        roomId: args.roomId,
        messageId: args.messageId,
        content: args.content,
      });
      return { ok: true };
    }
    case 'lobby_status_update': {
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
        serverInfo: { name: 'harness-lobby', version: '0.1.0' },
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
  try {
    socket?.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
});
