#!/usr/bin/env node
/**
 * harness-lobby keepalive（ZCode）— 常驻父进程，让 zcode 实例一直在线。
 * - 拉起本插件的 stdio MCP server（mcp-server/index.mjs），开机即 initialize + lobby_connect
 * - Mode A WS 由 MCP 内部维持（真实心跳 + 断线重连），本进程只负责「活着」和转发控制
 * - 暴露 HTTP 控制端点（默认 127.0.0.1:4313，LOBBY_CONTROL_PORT 可改）：
 *     GET  /health          → lobby_status
 *     POST /call            → { name, arguments } 调任意 lobby_* 工具
 *     POST /tasks           → { limit } 取 task.new 待办
 *   会话侧 MCP 检测到该端点会自动走代理，不自建 WS，避免双连接抢路由。
 * 用法：node keepalive.mjs（配合 pm2/计划任务/开机自启动更佳）
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = path.dirname(fileURLToPath(import.meta.url));
const MCP_ENTRY = path.join(here, 'mcp-server', 'index.mjs');
const CONTROL_HOST = process.env.LOBBY_CONTROL_HOST ?? '127.0.0.1';
const CONTROL_PORT = Number(process.env.LOBBY_CONTROL_PORT ?? 4313);

const child = spawn(process.execPath, [MCP_ENTRY], {
  stdio: ['pipe', 'pipe', 'inherit'],
  // LOBBY_CONTROL_URL='' 禁用子进程的 keepalive 探活：它自己就是被 keepalive 拉起的，
  // 再去探父进程的端点会自递归（/health → /call lobby_connect → …）
  env: { ...process.env, LOBBY_CONTROL_URL: '' },
});

let buf = '';
let nextId = 1;
const pending = new Map();

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof frame.id === 'number' && pending.has(frame.id)) {
      const { resolve, reject } = pending.get(frame.id);
      pending.delete(frame.id);
      if (frame.error) reject(new Error(frame.error.message ?? JSON.stringify(frame.error)));
      else resolve(frame.result);
    }
  }
});

child.on('exit', (code) => {
  console.error(`[keepalive] MCP server exited code=${code}`);
  process.exit(code ?? 0);
});

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

function call(method, params = {}, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`mcp call ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(t);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(t);
        reject(e);
      },
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

async function callTool(name, args = {}) {
  const result = await call('tools/call', { name, arguments: args });
  const text = result.content?.[0]?.text ?? '{}';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function bootstrap() {
  const init = await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'harness-lobby-keepalive', version: '0.2.0' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  console.error(`[keepalive] MCP initialized: ${init.serverInfo?.name} ${init.serverInfo?.version}`);

  const conn = await callTool('lobby_connect', {});
  console.error(`[keepalive] lobby_connect -> ${JSON.stringify(conn)}`);

  const status = await callTool('lobby_status', {});
  console.error(`[keepalive] status -> ${JSON.stringify(status)}`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error(`bad JSON body: ${e.message}`));
      }
    });
    req.on('error', reject);
  });
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const reply = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return reply(200, { ok: true, pid: process.pid, status: await callTool('lobby_status', {}) });
    }
    if (req.method === 'POST' && url.pathname === '/call') {
      const body = await readJson(req);
      if (!body.name) return reply(400, { error: 'name required' });
      return reply(200, { ok: true, result: await callTool(body.name, body.arguments ?? {}) });
    }
    if (req.method === 'POST' && url.pathname === '/tasks') {
      const body = await readJson(req).catch(() => ({}));
      return reply(200, {
        ok: true,
        result: await callTool('lobby_take_tasks', { limit: body.limit ?? 5 }),
      });
    }
    reply(404, { error: 'not found' });
  } catch (e) {
    reply(500, { error: String(e?.message ?? e) });
  }
});

httpServer.listen(CONTROL_PORT, CONTROL_HOST, () => {
  console.error(
    `[keepalive] HTTP control on http://${CONTROL_HOST}:${CONTROL_PORT} (GET /health, POST /call, POST /tasks)`
  );
});

bootstrap().catch((e) => {
  console.error(`[keepalive] bootstrap failed: ${e?.message ?? e}`);
  process.exit(1);
});

// 脱离终端运行（stdin 关闭）也保持常驻
process.stdin.on('end', () => console.error('[keepalive] stdin ended; staying alive'));
process.stdin.on('error', () => {});
process.on('SIGINT', () => {
  child.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  child.kill();
  process.exit(0);
});
