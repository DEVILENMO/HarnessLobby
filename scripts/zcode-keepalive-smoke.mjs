/**
 * ZCode 插件 keepalive 模式 smoke：
 * keepalive 常驻扛连接（控制端口 4391），会话 MCP 探活后走代理；
 * 关键断言：会话 MCP 退出后，zcode 实例仍在线；keepalive 退出后才离线。
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LobbyServer } from '../packages/server/dist/lobby.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PORT = 4390;
const CONTROL_PORT = 4391;
const HTTP = `http://127.0.0.1:${PORT}`;
const CONTROL = `http://127.0.0.1:${CONTROL_PORT}`;
const HOST = process.env.COMPUTERNAME || os.hostname();
const FULL_SLUG = `zcode-${HOST}`;
const EXPECTED_ID = `h_${FULL_SLUG.toLowerCase()}`;

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` :: ${detail}`}`);
  if (!ok) failed += 1;
};

async function rest(pathname, init) {
  const res = await fetch(`${HTTP}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const server = new LobbyServer({ port: PORT });
await server.listen();
console.log(`[ka-smoke] lobby on ${HTTP}, control on ${CONTROL}`);

const keepalive = spawn(process.execPath, [path.join(root, 'examples', 'zcode-plugin', 'keepalive.mjs')], {
  env: {
    ...process.env,
    LOBBY_HTTP_URL: HTTP,
    LOBBY_WS_URL: `ws://127.0.0.1:${PORT}`,
    LOBBY_CONTROL_PORT: String(CONTROL_PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
keepalive.stderr.setEncoding('utf8');
keepalive.stderr.on('data', (d) => process.stdout.write(`[ka] ${d}`));

// 会话侧 MCP
let buf = '';
const res = new Map();
let rpcId = 1;
const pending = new Map();
let session = null;

function startSession() {
  buf = '';
  res.clear();
  session = spawn(process.execPath, [path.join(root, 'examples', 'zcode-plugin', 'mcp-server', 'index.mjs')], {
    env: {
      ...process.env,
      LOBBY_HTTP_URL: HTTP,
      LOBBY_WS_URL: `ws://127.0.0.1:${PORT}`,
      LOBBY_CONTROL_URL: CONTROL,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  session.stdout.setEncoding('utf8');
  session.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line);
        if (m.id != null && pending.has(m.id)) {
          pending.get(m.id)(m);
          pending.delete(m.id);
        }
      } catch {
        /* ignore */
      }
    }
  });
  session.stderr.setEncoding('utf8');
  session.stderr.on('data', (d) => console.error('[mcp-err]', d));
}

async function tool(name, args = {}, ms = 8000) {
  const n = rpcId++;
  const p = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${name}`)), ms);
    pending.set(n, (m) => {
      clearTimeout(t);
      if (m.error) reject(new Error(`${name}: ${m.error.message}`));
      else resolve(JSON.parse(m.result.content[0].text));
    });
  });
  session.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  return p;
}

try {
  // 等 keepalive 起来（控制端点先于注册就绪，要轮询到 connected:true）
  let health = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`${CONTROL}/health`, { signal: AbortSignal.timeout(400) });
      if (r.ok) {
        const j = await r.json();
        if (j?.status?.connected === true) {
          health = j;
          break;
        }
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  check('keepalive up + connected', Boolean(health?.ok) && health?.status?.connected === true, JSON.stringify(health)?.slice(0, 200));

  startSession();
  await new Promise((r) => setTimeout(r, 300));

  const initId = rpcId++;
  session.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: initId, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ka-smoke', version: '0' } } }) + '\n');

  const conn = await tool('lobby_connect', {});
  check('session MCP proxies via keepalive', conn.mode === 'keepalive-proxy' && conn.connected === true && conn.harnessId === EXPECTED_ID, JSON.stringify(conn));

  const rooms = await rest('/rooms');
  const lobbyRoom = rooms.find((r) => r.topic === '大厅');
  await rest(`/rooms/${lobbyRoom.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: 'u_you', content: '@zcode keepalive 模式自检' }),
  });

  const tasks = await tool('lobby_take_tasks', { limit: 5 });
  check('task routed to keepalive, drained via proxy', tasks.length === 1 && tasks[0].roomId === lobbyRoom.id, JSON.stringify(tasks));
  const task = tasks[0];

  await tool('lobby_bind_session', { roomId: task.roomId, externalSessionRef: `sess_zcode_${task.roomId}` });
  await tool('lobby_status_update', { roomId: task.roomId, state: 'working' });
  await tool('lobby_stream', { roomId: task.roomId, messageId: task.messageId, delta: 'keepalive 代理链路 OK：' });
  const finalText = 'keepalive 代理链路 OK：会话退出后 zcode 仍在线。';
  await tool('lobby_finalize', { roomId: task.roomId, messageId: task.messageId, content: finalText });
  await tool('lobby_status_update', { roomId: task.roomId, state: 'idle' });

  const msgs = await rest(`/rooms/${task.roomId}/messages`);
  const reply = msgs.find((m) => m.id === task.messageId);
  check('proxy stream/finalize visible in room', reply?.streamState === 'final' && reply?.content === finalText, JSON.stringify(reply)?.slice(0, 160));

  // 关键：会话 MCP 退出，keepalive 仍扛着 presence
  session.kill();
  session = null;
  await new Promise((r) => setTimeout(r, 600));
  let hs = await rest('/harnesses');
  let me = hs.find((h) => h.id === EXPECTED_ID);
  check('presence SURVIVES session exit', me?.status === 'online', JSON.stringify(me));

  // keepalive 退出 → 才离线
  keepalive.kill();
  await new Promise((r) => setTimeout(r, 800));
  hs = await rest('/harnesses');
  me = hs.find((h) => h.id === EXPECTED_ID);
  check('presence drops after keepalive exit', me?.status === 'offline', JSON.stringify(me));
} catch (e) {
  check('keepalive smoke run', false, String(e?.message ?? e));
} finally {
  session?.kill();
  keepalive.kill();
  await server.close();
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
