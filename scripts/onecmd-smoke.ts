/**
 * Verify one-command stack: embedded server + dispatch path without TUI.
 */
import { startStack } from '../packages/cli/src/onecmd.js';
import { spawn } from 'node:child_process';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const port = 4488;
  const stack = await startStack({
    port,
    external: false,
    httpBase: `http://127.0.0.1:${port}`,
  });

  let mimo: ReturnType<typeof spawn> | null = null;
  try {
    if (!stack.embedded) throw new Error('expected embedded server');
    mimo = spawn(
      process.execPath,
      ['--import', 'tsx', 'examples/mimo-harness/src/index.ts'],
      {
        env: {
          ...process.env,
          LOBBY_WS_URL: stack.httpBase.replace(/^http/, 'ws'),
          LOBBY_TOKEN: 'ilv_mimo_open',
          MIMO_HARNESS_MODE: 'echo',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      }
    );
    let registered = false;
    for (let i = 0; i < 40; i += 1) {
      await sleep(150);
      const health = (await (await fetch(`${stack.httpBase}/health`)).json()) as {
        plugins: string[];
      };
      if (health.plugins.includes('h_mimo')) {
        registered = true;
        break;
      }
    }
    if (!registered) throw new Error('mimo not registered');

    const rooms = (await (await fetch(`${stack.httpBase}/rooms`)).json()) as {
      id: string;
      topic: string;
    }[];
    const room = rooms.find((r) => r.topic === '大厅') ?? rooms[0];
    await fetch(`${stack.httpBase}/rooms/${room.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderId: 'u_you',
        content: '@mimo-code onecmd probe',
      }),
    });

    let ok = false;
    for (let i = 0; i < 40; i += 1) {
      await sleep(250);
      const msgs = (await (
        await fetch(`${stack.httpBase}/rooms/${room.id}/messages`)
      ).json()) as Array<{ senderId: string; streamState: string; content: string }>;
      ok = msgs.some(
        (m) =>
          m.senderId === 'h_mimo' &&
          m.streamState === 'final' &&
          (m.content.includes('onecmd') || m.content.includes('echo'))
      );
      if (ok) break;
    }
    if (!ok) throw new Error('mimo did not finalize reply');

    const bound = (await (
      await fetch(`${stack.httpBase}/rooms/${room.id}/bound-sessions`)
    ).json()) as unknown[];
    if (!bound.length) throw new Error('no bound session');

    console.log('ONECMD PASS');
  } finally {
    if (mimo && !mimo.killed) mimo.kill();
    await stack.stop();
  }

  const s2 = await startStack({
    port: 4489,
    external: false,
    httpBase: 'http://127.0.0.1:4489',
  });
  try {
    const h = (await (await fetch(`${s2.httpBase}/health`)).json()) as {
      plugins: string[];
    };
    if (h.plugins.length) throw new Error('unexpected plugins before connect');
    console.log('ONECMD clean-boot PASS');
  } finally {
    await s2.stop();
  }

  const s3 = await startStack({
    port: 4490,
    external: false,
    httpBase: 'http://127.0.0.1:4311',
  });
  try {
    if (!s3.embedded) throw new Error('expected embed on --port 4490');
    if (!s3.httpBase.includes(':4490')) throw new Error(`bad base ${s3.httpBase}`);
    console.log('ONECMD --port PASS');
  } finally {
    await s3.stop();
  }

  const net = await import('node:net');
  const blocker = net.createServer();
  await new Promise<void>((r) => blocker.listen(4491, '127.0.0.1', () => r()));
  try {
    let errMsg = '';
    try {
      await startStack({
        port: 4491,
        external: false,
        httpBase: 'http://127.0.0.1:4491',
      });
    } catch (e) {
      errMsg = String(e);
    }
    if (!errMsg.includes('已被占用') && !errMsg.includes('无法监听')) {
      throw new Error(`expected port conflict error, got: ${errMsg || '(no throw)'}`);
    }
    console.log('ONECMD port-conflict PASS');
  } finally {
    await new Promise<void>((r) => {
      blocker.close(() => r());
      setTimeout(r, 300);
    });
  }
}

main().catch((e) => {
  console.error('ONECMD FAIL', e);
  process.exit(1);
});
