import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'examples', 'mcp-lobby-agent', 'index.mjs');
const node = process.execPath;

const child = spawn(node, [entry], {
  env: {
    ...process.env,
    LOBBY_HTTP_URL: 'http://127.0.0.1:4311',
    LOBBY_WS_URL: 'ws://127.0.0.1:4311',
    LOBBY_TOKEN: 'ilv_mimo_open',
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
    } catch (e) {
      console.log('stdout junk', line.slice(0, 80));
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
async function wait(n, ms = 3000) {
  const t0 = Date.now();
  while (!res.has(n)) {
    if (Date.now() - t0 > ms) throw new Error('timeout ' + n);
    await new Promise((r) => setTimeout(r, 30));
  }
  return res.get(n);
}

const a = rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } });
console.log('init', JSON.stringify(await wait(a), null, 2).slice(0, 400));
const b = rpc('tools/call', { name: 'lobby_connect', arguments: { slug: 'mimo-code', displayName: 'MiMo Code' } });
const rb = await wait(b, 5000);
console.log('connect', JSON.stringify(rb, null, 2));
const c = rpc('tools/call', { name: 'lobby_list_rooms', arguments: {} });
const rc = await wait(c, 5000);
console.log('rooms', JSON.stringify(rc, null, 2).slice(0, 500));
child.kill();
