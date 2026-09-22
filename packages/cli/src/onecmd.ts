import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LobbyServer } from '@harness-lobby/server';

export type OneCmdOptions = {
  port: number;
  external: boolean;
  httpBase: string;
};

export type OneCmdHandle = {
  httpBase: string;
  embedded: boolean;
  stop: () => Promise<void>;
};

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Optional helper harness for local demos; not seeded, not auto-started. */
export function resolveHelperEntry(pkg: 'mimo-harness'): { cmd: string; args: string[] } | null {
  const override = process.env.LOBBY_HELPER_ENTRY;
  if (override && fs.existsSync(override)) {
    return { cmd: process.execPath, args: [override] };
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgRoot = path.resolve(here, '..');
    const monoRoot = path.resolve(pkgRoot, '..', '..');
    const dist = path.join(monoRoot, 'examples', pkg, 'dist', 'index.js');
    const src = path.join(monoRoot, 'examples', pkg, 'src', 'index.ts');
    if (fs.existsSync(dist)) return { cmd: process.execPath, args: [dist] };
    if (fs.existsSync(src)) return { cmd: process.execPath, args: ['--import', 'tsx', src] };
  } catch {
    /* fall through */
  }
  return null;
}

export async function startStack(opts: OneCmdOptions): Promise<OneCmdHandle> {
  let server: LobbyServer | null = null;
  let stopPromise: Promise<void> | null = null;

  const bindBase = normalizeBase(`http://127.0.0.1:${opts.port}`);
  let httpBase = opts.external ? normalizeBase(opts.httpBase) : bindBase;
  let embedded = false;

  const stop = async (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (server) {
        await server.close().catch(() => undefined);
        server = null;
      }
    })();
    return stopPromise;
  };

  if (!opts.external) {
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

  return {
    httpBase,
    embedded,
    stop,
  };
}
