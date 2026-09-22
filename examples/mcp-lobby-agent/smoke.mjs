import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'index.mjs');

const child = spawn(process.execPath, [entry], {
  env: {
    ...process.env,
    LOBBY_HTTP_URL: 'http://127.0.0.1:4399',
    LOBBY_WS_URL: 'ws://127.0.0.1:4399',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
/** @type {{id:number, result?:any, error?:any}[]} */
const responses = new Map();

child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    } catch {
      /* ignore */
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return id;
}

async function waitFor(id, ms = 2000) {
  const start = Date.now();
  while (!responses.has(id)) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting rpc ${id}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  return responses.get(id);
}

function parseText(msg) {
  const t = msg.result?.content?.[0]?.text;
  return t ? JSON.parse(t) : msg.result;
}

// boot lobby server first via dynamic import of workspace server
const { LobbyServer } = await import(
  pathToFileURL(path.join(here, '..', '..', 'packages', 'server', 'dist', 'lib.js')).href
);
const server = new LobbyServer({ port: 4399 });
await server.listen();

try {
  const initId = rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  });
  const init = await waitFor(initId);
  if (init.error) throw new Error(JSON.stringify(init.error));

  const listId = rpc('tools/list', {});
  const list = await waitFor(listId);
  const names = list.result.tools.map((t) => t.name);
  for (const n of [
    'lobby_connect',
    'lobby_list_rooms',
    'lobby_take_tasks',
    'lobby_bind_session',
    'lobby_stream',
    'lobby_finalize',
  ]) {
    if (!names.includes(n)) throw new Error(`missing tool ${n}`);
  }
  console.log('MCP tools/list PASS');

  const connId = rpc('tools/call', {
    name: 'lobby_connect',
    arguments: { slug: 'mimo-code', displayName: 'MiMo Code' },
  });
  const conn = parseText(await waitFor(connId, 3000));
  if (!conn.connected) throw new Error(`connect failed ${JSON.stringify(conn)}`);
  console.log('MCP lobby_connect PASS');

  const health = await (await fetch('http://127.0.0.1:4399/health')).json();
  if (!health.plugins.includes('h_mimo')) {
    throw new Error(`server plugins ${JSON.stringify(health.plugins)}`);
  }
  console.log('MCP register visible in lobby PASS');

  const roomsId = rpc('tools/call', { name: 'lobby_list_rooms', arguments: {} });
  const rooms = parseText(await waitFor(roomsId));
  const room = rooms.find((r) => r.topic === '大厅') ?? rooms[0];

  await fetch(`http://127.0.0.1:4399/rooms/${room.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      senderId: 'u_you',
      content: '@mimo-code 用一句话介绍 lobby',
    }),
  });

  let tasks = [];
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    const tid = rpc('tools/call', { name: 'lobby_take_tasks', arguments: { limit: 5 } });
    tasks = parseText(await waitFor(tid));
    if (tasks.length) break;
  }
  if (!tasks.length) throw new Error('no task.new delivered');
  const task = tasks[0];
  console.log('MCP lobby_take_tasks PASS');

  const bid = rpc('tools/call', {
    name: 'lobby_bind_session',
    arguments: { roomId: task.roomId, externalSessionRef: 'sess_mimo_test' },
  });
  await waitFor(bid);

  const s1 = rpc('tools/call', {
    name: 'lobby_stream',
    arguments: { roomId: task.roomId, messageId: task.messageId, delta: '你好' },
  });
  await waitFor(s1);
  const s2 = rpc('tools/call', {
    name: 'lobby_finalize',
    arguments: {
      roomId: task.roomId,
      messageId: task.messageId,
      content: '你好，这里是 mimo-code。',
    },
  });
  await waitFor(s2);

  const msgs = await (
    await fetch(`http://127.0.0.1:4399/rooms/${task.roomId}/messages`)
  ).json();
  const finalMsg = msgs.find((m) => m.id === task.messageId);
  if (!finalMsg || finalMsg.content !== '你好，这里是 mimo-code。') {
    throw new Error(`final mismatch ${JSON.stringify(finalMsg)}`);
  }
  console.log('MCP stream/finalize PASS');
  console.log('MCP LOBBY AGENT PASS');
} finally {
  child.kill();
  await server.close();
}
