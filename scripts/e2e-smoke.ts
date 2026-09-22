/**
 * E2E smoke: boot server + mock-harness, dispatch a task via REST, assert stream.
 * Usage: node --import tsx scripts/e2e-smoke.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.env.MIMO_NPM ?? 'npm';
const NODE = process.env.execPath ?? process.execPath;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitOk(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting ${url}`);
    await sleep(200);
  }
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): ChildProcess {
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[proc] ${String(d)}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[proc] ${String(d)}`));
  return child;
}

async function main() {
  const port = 4311;
  const httpBase = `http://127.0.0.1:${port}`;

  const server = run(NODE, ['--import', 'tsx', 'packages/server/src/index.ts'], {
    LOBBY_PORT: String(port),
  });
  await waitOk(`${httpBase}/health`);

  const mock = run(NODE, ['--import', 'tsx', 'examples/mock-harness/src/index.ts'], {
    LOBBY_WS_URL: `ws://127.0.0.1:${port}`,
    LOBBY_TOKEN: 'ilv_mock_open',
  });
  await sleep(800);

  const health = (await (await fetch(`${httpBase}/health`)).json()) as {
    plugins: string[];
  };
  if (!health.plugins.includes('h_mock')) {
    throw new Error(`mock not registered: ${JSON.stringify(health)}`);
  }

  const rooms = (await (await fetch(`${httpBase}/rooms`)).json()) as {
    id: string;
    topic: string;
  }[];
  const room = rooms.find((r) => r.topic === '具身智能') ?? rooms[0];
  if (!room) throw new Error('no room');

  await fetch(`${httpBase}/rooms/${room.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      senderId: 'u_you',
      content: '@mock-harness 帮我把 ROS 节点改成支持 GelSight',
    }),
  });

  let finalMsg: { streamState: string; content: string } | null = null;
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const msgs = (await (
      await fetch(`${httpBase}/rooms/${room.id}/messages`)
    ).json()) as Array<{
      senderId: string;
      streamState: string;
      content: string;
    }>;
    finalMsg =
      msgs.find((m) => m.senderId === 'h_mock' && m.streamState === 'final') ??
      null;
    if (finalMsg && finalMsg.content.includes('GelSight')) break;
    await sleep(300);
  }

  const bound = (await (
    await fetch(`${httpBase}/rooms/${room.id}/bound-sessions`)
  ).json()) as Array<{ externalSessionRef: string }>;

  server.kill();
  mock.kill();

  if (!finalMsg) throw new Error('no final message from mock-harness');
  if (!bound.length) throw new Error('bound session not created');
  if (!finalMsg.content.includes('GelSight') && !finalMsg.content.includes('ROS')) {
    throw new Error(`reply missing echo: ${finalMsg.content.slice(0, 80)}`);
  }

  console.log('E2E PASS');
  console.log('bound:', bound.map((b) => b.externalSessionRef).join(','));
  console.log('reply chars:', finalMsg.content.length);
}

main().catch((err) => {
  console.error('E2E FAIL', err);
  process.exit(1);
});
