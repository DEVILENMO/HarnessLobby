import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { LobbyServer } from '@harness-lobby/server';

export type OneCmdOptions = {
  port: number;
  withMock: boolean;
  external: boolean;
  httpBase: string;
};

export type OneCmdHandle = {
  httpBase: string;
  embedded: boolean;
  stop: () => Promise<void>;
};

const require_ = createRequire(import.meta.url);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function probeHealth(httpBase: string, timeoutMs = 800): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${httpBase.replace(/\/$/, '')}/health`);
      if (res.ok) {
        const body = (await res.json()) as { lobbyId?: string };
        return Boolean(body.lobbyId);
      }
      return false;
    } catch {
      if (Date.now() - start > timeoutMs) return false;
      await sleep(100);
    }
  }
}

function resolveMockEntry(): { cmd: string; args: string[] } | null {
  try {
    const entry = require_.resolve('@harness-lobby/mock-harness');
    return { cmd: process.execPath, args: [entry] };
  } catch {
    /* fall through */
  }
  try {
    const pkgPath = require_.resolve('@harness-lobby/mock-harness/package.json');
    const dist = pkgPath.replace(/package\.json$/, 'dist/index.js');
    return { cmd: process.execPath, args: [dist] };
  } catch {
    /* fall through */
  }
  // monorepo dev fallback: run TypeScript source
  try {
    const root = require_.resolve('@harness-lobby/protocol/package.json').replace(
      /packages[/\\]protocol[/\\]package\.json$/,
      ''
    );
    const src = `${root}examples/mock-harness/src/index.ts`;
    return { cmd: process.execPath, args: ['--import', 'tsx', src] };
  } catch {
    return null;
  }
}

export async function startStack(opts: OneCmdOptions): Promise<OneCmdHandle> {
  let server: LobbyServer | null = null;
  let mock: ChildProcess | null = null;
  let httpBase = opts.httpBase.replace(/\/$/, '');
  let embedded = false;

  const stop = async (): Promise<void> => {
    if (mock && !mock.killed) {
      mock.kill();
      mock = null;
    }
    if (server) {
      await server.close().catch(() => undefined);
      server = null;
    }
  };

  if (!opts.external) {
    const already = await probeHealth(httpBase, 200);
    if (already) {
      embedded = false;
    } else {
      server = new LobbyServer({ port: opts.port });
      try {
        await server.listen();
      } catch (err) {
        await stop();
        throw new Error(
          `端口 ${opts.port} 无法监听（可能被非 Lobby 服务占用）：${String(err)}`
        );
      }
      httpBase = `http://127.0.0.1:${opts.port}`;
      embedded = true;
    }
  }

  if (opts.withMock) {
    const launch = resolveMockEntry();
    if (launch) {
      mock = spawn(launch.cmd, launch.args, {
        env: {
          ...process.env,
          LOBBY_WS_URL: httpBase.replace(/^http/, 'ws'),
          LOBBY_TOKEN: process.env.LOBBY_TOKEN ?? 'ilv_mock_open',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      mock.stderr?.on('data', (d) => {
        process.stderr.write(`[mock] ${String(d)}`);
      });
    }
  }

  // give mock a beat to register
  if (mock) await sleep(400);

  return {
    httpBase,
    embedded,
    stop,
  };
}
