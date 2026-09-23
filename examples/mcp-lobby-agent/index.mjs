#!/usr/bin/env node
/**
 * harness-lobby — stdio MCP server
 * 让当前 Agent 作为 harness 接入 Harness Lobby（Mode A 语义 + REST）。
 */
import process from 'node:process';
import WebSocket from 'ws';

const LOBBY_HTTP = (process.env.LOBBY_HTTP_URL ?? 'http://127.0.0.1:4311').replace(/\/$/, '');
const LOBBY_WS = (process.env.LOBBY_WS_URL ?? LOBBY_HTTP.replace(/^http/, 'ws')).replace(/\/$/, '');
const LOBBY_TOKEN = process.env.LOBBY_TOKEN ?? 'ilv_mimo_open';

/** @type {{id:string,jsonrpc:string,method:string,params:any}[]} */
const inbox = [];
/** @type {WebSocket|null} */
let socket = null;
let harnessId = null;
let connected = false;
let registerError = null;
const pendingTasks = [];
const sessionByRoom = new Map();

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
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
  } else {
    throw new Error('Lobby WebSocket 未连接，请先调用 lobby_connect');
  }
}

function connectWs({ slug, displayName, capabilities, token }) {
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

  socket.on('open', () => {
    const os = require('node:os');
    socket.send(
      JSON.stringify({
        type: 'register_lobby',
        token: token ?? LOBBY_TOKEN,
        profile: {
          slug: slug ?? 'mimo-code',
          displayName: displayName ?? 'MiMo Code',
          avatar: 'MM',
          capabilities: capabilities ?? ['对话', '协作', '流式回写'],
          protocol: 'mode-a',
          computerName: process.env.COMPUTERNAME || os.hostname(),
        },
      })
    );
  });

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'register_ack':
        harnessId = msg.harnessId;
        connected = true;
        for (const roomId of msg.assignedRooms ?? []) {
          if (!sessionByRoom.has(roomId)) {
            sessionByRoom.set(roomId, `sess_${slug ?? 'mimo-code'}_${roomId}`);
          }
        }
        break;
      case 'register_nack':
        connected = false;
        registerError = msg.error;
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

  socket.on('close', () => {
    connected = false;
  });
  socket.on('error', (e) => {
    registerError = String(e);
  });
}

const tools = [
  {
    name: 'lobby_connect',
    description:
      '连接本地 Harness Lobby 并以 harness 身份注册（Mode A WebSocket）。身份 slug 默认 mimo-code。',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'harness slug，如 mimo-code' },
        displayName: { type: 'string' },
        token: { type: 'string', description: 'install token，默认读 LOBBY_TOKEN' },
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
    description: '取出 WS 收到的 task.new 任务（当前 Agent 作为 harness 的待办）。',
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
    description: '把任务结果增量流式回写到房间。',
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
      connectWs({
        slug: args.slug ?? 'mimo-code',
        displayName: args.displayName,
        token: args.token,
        capabilities: args.capabilities,
      });
      await new Promise((r) => setTimeout(r, 400));
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
      const out = pendingTasks.splice(0, n);
      return out;
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

process.stdin.on('end', () => process.exit(0));
