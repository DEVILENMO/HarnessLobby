import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  mockState: 'off' | 'online' | 'unresolved';
  stop: () => Promise<void>;
};

const require_ = createRequire(import.meta.url);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeBase(httpBase: string): string {
  return httpBase.replace(/\/$/, '');
}

async function isLobbyHealth(httpBase: string, timeoutMs = 800): Promise<boolean> {
  const base = normalizeBase(httpBase);
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(Math.max(50, timeoutMs)),
      });
      if (res.ok) {
        const body = (await res.json()) as { lobbyId?: string };
        return Boolean(body.lobbyId);
      }
      return false;
    } catch {
      if (Date.now() - start > timeoutMs) return false;
      await sleep(50);
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
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgRoot = path.resolve(here, '..');
    const monoRoot = path.resolve(pkgRoot, '..', '..');
    const dist = path.join(monoRoot, 'examples', 'mock-harness', 'dist', 'index.js');
    const src = path.join(monoRoot, 'examples', 'mock-harness', 'src', 'index.ts');
    if (fs.existsSync(dist)) return { cmd: process.execPath, args: [dist] };
    if (fs.existsSync(src)) return { cmd: process.execPath, args: ['--import', 'tsx', src] };
  } catch {
    /* fall through */
  }
  return null;
}

export async function startStack(opts: OneCmdOptions): Promise<OneCmdHandle> {
  let server: LobbyServer | null = null;
  let mock: ChildProcess | null = null;
  let stopPromise: Promise<void> | null = null;
  let mockState: OneCmdHandle['mockState'] = 'off';

  // Always prefer the port the user asked to bind when embedding.
  const bindBase = normalizeBase(`http://127.0.0.1:${opts.port}`);
  let httpBase = opts.external ? normalizeBase(opts.httpBase) : bindBase;
  let embedded = false;

  const stop = async (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (mock && !mock.killed) {
        mock.kill();
        mock = null;
      }
      if (server) {
        await server.close().catch(() => undefined);
        server = null;
      }
    })();
    return stopPromise;
  };

  if (!opts.external) {
    // Reuse only if the *requested* port already serves a Lobby.
    const already = await isLobbyHealth(bindBase, 200);
    if (already) {
      embedded = false;
      httpBase = bindBase;
    } else {
      server = new LobbyServer({ port: opts.port });
      try {
        await server.listen();
      } catch (err) {
        await stop();
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE') {
          throw new Error(
            `端口 ${opts.port} 已被占用，且不是可用的 Lobby Server。请换 --port，或先停掉占用进程，或用 --external 连接已有 Lobby。`
          );
        }
        throw new Error(`端口 ${opts.port} 无法监听：${String(err)}`);
      }
      httpBase = bindBase;
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
      mock.on('error', () => {
        mockState = 'unresolved';
      });
      mock.on('exit', (code) => {
        if (mockState !== 'off') mockState = code === 0 ? 'off' : 'unresolved';
      });
      mock.stderr?.on('data', (d) => {
        process.stderr.write(`[mock] ${String(d)}`);
      });
      await sleep(500);
      mockState = mock.killed ? 'unresolved' : 'online';
    } else {
      mockState = 'unresolved';
    }
  }

  return {
    httpBase,
    embedded,
    mockState,
    stop,
  };
}
