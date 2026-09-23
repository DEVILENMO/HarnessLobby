/**
 * Live probe：用「已安装」的 harness-lobby MCP 副本对真实 Lobby 跑接入链路。
 * 用法：node scripts/zcode-live-probe.mjs <mcp-index.mjs> [任务文本]
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const mcpEntry = process.argv[2];
const taskText = process.argv[3] ?? '@zcode 接入自检：请确认链路并回写';
const HTTP = process.env.LOBBY_HTTP_URL ?? 'http://127.0.0.1:4311';
const FULL_SLUG = `zcode-${process.env.COMPUTERNAME || os.hostname()}`;
const EXPECTED_ID = `h_${FULL_SLUG.toLowerCase()}`;

if (!mcpEntry) {
  console.error('usage: node scripts/zcode-live-probe.mjs <mcp-index.mjs> [task]');
  process.exit(1);
}

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
  const body = await res.text();
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

const child = spawn(process.execPath, [mcpEntry], {
  env: { ...process.env, LOBBY_HTTP_URL: HTTP, LOBBY_WS_URL: HTTP.replace(/^http/, 'ws') },
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
      /* ignore */
    }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => console.error('[mcp-err]', d));

let id = 1;
const rpc = (method, params) => {
  const n = id++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  return n;
};
async function wait(n, ms = 5000) {
  const t0 = Date.now();
  while (!res.has(n)) {
    if (Date.now() - t0 > ms) throw new Error(`timeout rpc ${n}`);
    await new Promise((r) => setTimeout(r, 30));
  }
  return res.get(n);
}
async function tool(name, args = {}) {
  const r = await wait(rpc('tools/call', { name, arguments: args }));
  if (r.error) throw new Error(`${name}: ${r.error.message}`);
  return JSON.parse(r.result.content[0].text);
}

try {
  await wait(rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'live-probe', version: '0' } }));
  const conn = await tool('lobby_connect', {});
  check(`installed MCP auto-registered as ${FULL_SLUG} on live lobby`, conn.connected === true && conn.harnessId === EXPECTED_ID, JSON.stringify(conn));

  const rooms = await rest('/rooms');
  const lobbyRoom = rooms.find((r) => r.topic === '大厅') ?? rooms[0];
  await rest(`/rooms/${lobbyRoom.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: 'u_you', content: taskText }),
  });
  const tasks = await tool('lobby_take_tasks', { limit: 5 });
  check('task.new received', tasks.length >= 1, JSON.stringify(tasks));
  const task = tasks[tasks.length - 1];

  await tool('lobby_bind_session', { roomId: task.roomId, externalSessionRef: `sess_zcode_${task.roomId}` });
  await tool('lobby_status_update', { roomId: task.roomId, state: 'working' });

  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  await tool('lobby_stream', { roomId: task.roomId, messageId: task.messageId, delta: '**ZCode 插件接入自检** ✅（协议 v0.2）\n\n' });
  await tool('lobby_stream', { roomId: task.roomId, messageId: task.messageId, delta: `- ${stamp} 连接即注册成功：\`${FULL_SLUG}\`（${conn.harnessId}）\n- 收到大厅派活并已绑定 session\n- 本条回复由**已安装的插件副本**流式回写\n\n` });
  const finalText = `**ZCode 插件接入自检** ✅（协议 v0.2）\n\n- ${stamp} 连接即注册成功：\`${FULL_SLUG}\`（${conn.harnessId}）\n- 收到大厅派活并已绑定 session\n- 本条回复由**已安装的插件副本**（${path.basename(path.dirname(path.dirname(mcpEntry)))}）流式回写：lobby_stream × 2 → lobby_finalize\n\n链路：ZCode 插件 MCP（stdio）→ Mode A WebSocket（真实心跳保活）→ Lobby → TUI 房间。在新 ZCode 会话里说「连接 harness 大厅」即可让我常驻接入。`;
  await tool('lobby_finalize', { roomId: task.roomId, messageId: task.messageId, content: finalText });
  await tool('lobby_status_update', { roomId: task.roomId, state: 'idle' });

  const msgs = await rest(`/rooms/${task.roomId}/messages`);
  const reply = msgs.find((m) => m.id === task.messageId);
  check('final reply visible in room', reply?.streamState === 'final' && reply?.content === finalText, JSON.stringify(reply)?.slice(0, 200));

  console.log(`\nroom=${lobbyRoom.topic}(${lobbyRoom.id}) messageId=${task.messageId}`);
} catch (e) {
  check('live probe', false, String(e?.message ?? e));
} finally {
  child.kill();
}
console.log(failed === 0 ? 'ALL PASS' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
