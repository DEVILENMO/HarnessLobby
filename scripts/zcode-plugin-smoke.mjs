/**
 * ZCode 插件（examples/zcode-plugin）端到端 smoke（协议 v0.2）：
 * 起 Lobby Server（临时端口）→ MCP 子进程连接即注册（slug-computerName）→
 * @短名 派活（验证自动路由，含带连字符主机名）→ 领任务 → bind → stream → finalize →
 * 断言房间消息、bound session、心跳。
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LobbyServer } from '../packages/server/dist/lobby.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PORT = 4399;
const HTTP = `http://127.0.0.1:${PORT}`;
const HOST = process.env.COMPUTERNAME || os.hostname();
const FULL_SLUG = `zcode-${HOST}`;
const EXPECTED_ID = `h_${FULL_SLUG.toLowerCase()}`;

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` :: ${detail}`}`);
  if (!ok) failed += 1;
}

async function rest(pathname, init) {
  const res = await fetch(`${HTTP}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${text.slice(0, 200)}`);
  return body;
}

const server = new LobbyServer({ port: PORT });
await server.listen();
console.log(`[smoke] lobby on ${HTTP}`);

const child = spawn(process.execPath, [path.join(root, 'examples', 'zcode-plugin', 'mcp-server', 'index.mjs')], {
  env: {
    ...process.env,
    LOBBY_HTTP_URL: HTTP,
    LOBBY_WS_URL: `ws://127.0.0.1:${PORT}`,
    LOBBY_PING_INTERVAL_MS: '300',
    LOBBY_PING_TIMEOUT_MS: '5000',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
const res = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const m = JSON.parse(line);
      if (m.id != null) res.set(m.id, m);
    } catch {
      console.log('stdout junk', line.slice(0, 120));
    }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => console.error('[mcp-err]', d));

let id = 1;
function rpc(method, params) {
  const n = id++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  return n;
}
async function wait(n, ms = 5000) {
  const t0 = Date.now();
  while (!res.has(n)) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting rpc ${n}`);
    await new Promise((r) => setTimeout(r, 30));
  }
  return res.get(n);
}
async function tool(name, args = {}, ms = 5000) {
  const r = await wait(rpc('tools/call', { name, arguments: args }), ms);
  if (r.error) throw new Error(`${name}: ${r.error.message}`);
  return JSON.parse(r.result.content[0].text);
}

try {
  const init = await wait(rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } }));
  check('mcp initialize v0.2', init.result?.serverInfo?.version === '0.2.0', JSON.stringify(init).slice(0, 200));

  const conn = await tool('lobby_connect', {});
  check('connect auto-registered as slug-computerName', conn.connected === true && conn.harnessId === EXPECTED_ID, JSON.stringify(conn));

  const harnesses = await rest('/harnesses');
  const me = harnesses.find((h) => h.id === EXPECTED_ID);
  check('instance online with full slug + baseSlug', me?.status === 'online' && me?.slug === FULL_SLUG && me?.baseSlug === 'zcode', JSON.stringify(me));
  check('no legacy seed slots', !harnesses.some((h) => ['h_mimo', 'h_minimax', 'h_zcode'].includes(h.id)), JSON.stringify(harnesses));

  const rooms = await rest('/rooms');
  const lobbyRoom = rooms.find((r) => r.topic === '大厅');
  check('auto-joined 大厅', Boolean(lobbyRoom) && lobbyRoom.memberIds.includes(EXPECTED_ID), JSON.stringify(rooms));

  // @短名 派活：主机名带连字符（LAPTOP-XXX）也要能自动路由到唯一实例
  await rest(`/rooms/${lobbyRoom.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: 'u_you', content: '@zcode 帮我算一下 21*2，把过程和结果回写' }),
  });

  const msgsAfterPost = await rest(`/rooms/${lobbyRoom.id}/messages`);
  const userMsg = [...msgsAfterPost].reverse().find((m) => m.senderId === 'u_you');
  check('short @zcode routed to full instance', JSON.stringify(userMsg?.mentions ?? []) === JSON.stringify([FULL_SLUG]), JSON.stringify(userMsg?.mentions));

  const tasks = await tool('lobby_take_tasks', { limit: 5 });
  check('task.new delivered', tasks.length === 1 && tasks[0].roomId === lobbyRoom.id && tasks[0].taskText.includes('@zcode'), JSON.stringify(tasks));

  const task = tasks[0];
  const bind = await tool('lobby_bind_session', { roomId: task.roomId, externalSessionRef: `sess_zcode_${task.roomId}` });
  check('bind session', Boolean(bind.externalSessionRef), JSON.stringify(bind));

  await tool('lobby_status_update', { roomId: task.roomId, state: 'working' });
  await tool('lobby_stream', { roomId: task.roomId, messageId: task.messageId, delta: '21 × 2 = ' });
  await tool('lobby_stream', { roomId: task.roomId, messageId: task.messageId, delta: '42' });

  const bound = await rest(`/rooms/${lobbyRoom.id}/bound-sessions`);
  check('bound session visible via REST', bound.length >= 1 && bound.some((b) => b.harnessId === EXPECTED_ID), JSON.stringify(bound));

  const finalText = '21 × 2 = 42\n\n过程：21 加 21 等于 42。';
  await tool('lobby_finalize', { roomId: task.roomId, messageId: task.messageId, content: finalText });
  await tool('lobby_status_update', { roomId: task.roomId, state: 'idle' });

  const msgs = await rest(`/rooms/${lobbyRoom.id}/messages`);
  const reply = msgs.find((m) => m.id === task.messageId);
  check('final message content replaced', reply?.streamState === 'final' && reply?.content === finalText, JSON.stringify(reply));

  const after = (await rest('/harnesses')).find((h) => h.id === EXPECTED_ID);
  check('presence back to online after idle', after?.status === 'online', JSON.stringify(after));

  await new Promise((r) => setTimeout(r, 800));
  const st = await tool('lobby_status', {});
  check('heartbeat acked (ping/pong)', Boolean(st.heartbeat?.lastAckAt) && st.heartbeat.ageMs < 5000, JSON.stringify(st.heartbeat));
  check('status queue drained', st.connected === true && st.pendingTaskCount === 0, JSON.stringify(st));
} catch (e) {
  check('smoke run', false, String(e?.message ?? e));
} finally {
  child.kill();
  await server.close();
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
