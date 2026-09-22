/**
 * Verify one-command stack: embedded server + auto mock + dispatch without TUI.
 */
import { startStack } from '../packages/cli/src/onecmd.js';

async function main() {
  const port = 4488;
  const stack = await startStack({
    port,
    withMock: true,
    external: false,
    httpBase: `http://127.0.0.1:${port}`,
  });

  try {
    if (!stack.embedded) throw new Error('expected embedded server');
    const health = (await (await fetch(`${stack.httpBase}/health`)).json()) as {
      plugins: string[];
      lobbyId: string;
    };
    if (!health.lobbyId) throw new Error('no lobbyId');
    if (!health.plugins.includes('h_mock')) {
      throw new Error(`mock not registered: ${JSON.stringify(health)}`);
    }

    const rooms = (await (await fetch(`${stack.httpBase}/rooms`)).json()) as {
      id: string;
      topic: string;
    }[];
    const room = rooms.find((r) => r.topic === '具身智能') ?? rooms[0];
    await fetch(`${stack.httpBase}/rooms/${room.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderId: 'u_you',
        content: '@mock-harness onecmd probe',
      }),
    });

    let ok = false;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      const msgs = (await (
        await fetch(`${stack.httpBase}/rooms/${room.id}/messages`)
      ).json()) as Array<{ senderId: string; streamState: string; content: string }>;
      ok = msgs.some(
        (m) => m.senderId === 'h_mock' && m.streamState === 'final' && m.content.includes('onecmd')
      );
      if (ok) break;
    }
    if (!ok) throw new Error('mock did not finalize reply');

    const bound = (await (
      await fetch(`${stack.httpBase}/rooms/${room.id}/bound-sessions`)
    ).json()) as unknown[];
    if (!bound.length) throw new Error('no bound session');

    // --no-mock path already covered by logic; test external reuse after stop? skip

    console.log('ONECMD PASS');
  } finally {
    await stack.stop();
  }

  // second boot with --no-mock semantics
  const s2 = await startStack({
    port: 4489,
    withMock: false,
    external: false,
    httpBase: 'http://127.0.0.1:4489',
  });
  try {
    const h = (await (await fetch(`${s2.httpBase}/health`)).json()) as {
      plugins: string[];
    };
    if (h.plugins.length) throw new Error('unexpected plugins with --no-mock');
    console.log('ONECMD --no-mock PASS');
  } finally {
    await s2.stop();
  }

  // --port must bind/probe the requested port, not fall back to 4311
  const s3 = await startStack({
    port: 4490,
    withMock: false,
    external: false,
    httpBase: 'http://127.0.0.1:4311',
  });
  try {
    if (!s3.embedded) throw new Error('expected embed on --port 4490 even if 4311 exists');
    if (!s3.httpBase.includes(':4490')) throw new Error(`bad base ${s3.httpBase}`);
    console.log('ONECMD --port PASS');
  } finally {
    await s3.stop();
  }

  // occupied by non-lobby should throw clear error
  const net = await import('node:net');
  const blocker = net.createServer();
  await new Promise<void>((r) => blocker.listen(4491, '127.0.0.1', () => r()));
  try {
    let errMsg = '';
    try {
      await startStack({
        port: 4491,
        withMock: false,
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
    await new Promise<void>((r) => blocker.close(() => r()));
  }
}

main().catch((e) => {
  console.error('ONECMD FAIL', e);
  process.exit(1);
});
