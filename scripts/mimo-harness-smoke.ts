/**
 * mimo-harness echo-mode dispatch smoke (no live MiMo instance required).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { startStack } from '../packages/cli/src/onecmd.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const port = 4511;
  const stack = await startStack({
    port,
    withMock: false,
    external: false,
    httpBase: `http://127.0.0.1:${port}`,
  });

  let mimo: ChildProcess | null = null;
  try {
    mimo = spawn(
      process.execPath,
      ['--import', 'tsx', 'examples/mimo-harness/src/index.ts'],
      {
        env: {
          ...process.env,
          LOBBY_WS_URL: `ws://127.0.0.1:${port}`,
          LOBBY_TOKEN: 'ilv_mimo_open',
          MIMO_HARNESS_MODE: 'echo',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    mimo.stdout?.on('data', (d) => process.stdout.write(`[mimo] ${String(d)}`));
    mimo.stderr?.on('data', (d) => process.stderr.write(`[mimo] ${String(d)}`));

    let registered = false;
    for (let i = 0; i < 50; i += 1) {
      await sleep(200);
      const health = (await (await fetch(`${stack.httpBase}/health`)).json()) as {
        plugins: string[];
      };
      if (health.plugins.includes('h_mimo')) {
        registered = true;
        break;
      }
    }
    if (!registered) {
      throw new Error('mimo not registered after wait');
    }

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
        content: '@mimo-code 总结房间近况',
      }),
    });

    let final = '';
    for (let i = 0; i < 40; i += 1) {
      await sleep(200);
      const msgs = (await (
        await fetch(`${stack.httpBase}/rooms/${room.id}/messages`)
      ).json()) as Array<{
        senderId: string;
        streamState: string;
        content: string;
      }>;
      const hit = msgs.find(
        (m) => m.senderId === 'h_mimo' && m.streamState === 'final'
      );
      if (hit && hit.content.includes('echo')) {
        final = hit.content;
        break;
      }
    }
    if (!final) throw new Error('no mimo final echo reply');

    const bound = (await (
      await fetch(`${stack.httpBase}/rooms/${room.id}/bound-sessions`)
    ).json()) as Array<{ harnessId: string; externalSessionRef: string }>;
    const bs = bound.find((b) => b.harnessId === 'h_mimo');
    if (!bs) throw new Error('no mimo bound session');
    if (!bs.externalSessionRef.startsWith('sess_mimo_')) {
      throw new Error(`unexpected session ref ${bs.externalSessionRef}`);
    }

    // missing LLM creds should exit non-zero
    const fail = spawn(process.execPath, ['--import', 'tsx', 'examples/mimo-harness/src/index.ts'], {
      env: {
        ...process.env,
        LOBBY_WS_URL: `ws://127.0.0.1:${port}`,
        LOBBY_TOKEN: 'ilv_mimo_open',
        MIMO_HARNESS_MODE: 'llm',
        MIMO_LLM_BASE_URL: '',
        MIMO_LLM_API_KEY: '',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const failCode = await new Promise<number | null>((r) => fail.on('exit', r));
    if (failCode === 0) throw new Error('expected non-zero exit without LLM creds');

    console.log('MIMO HARNESS PASS');
  } finally {
    if (mimo && !mimo.killed) mimo.kill();
    await stack.stop();
  }
}

main().catch((e) => {
  console.error('MIMO HARNESS FAIL', e);
  process.exit(1);
});
