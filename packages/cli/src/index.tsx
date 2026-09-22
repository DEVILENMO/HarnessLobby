#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { printHelp } from './help.js';
import { renderIconAnsi, renderIconBlocks } from './pixel-icon.js';
import { startStack } from './onecmd.js';

type CliArgs = {
  cmd: string | null;
  port: number;
  external: boolean;
  rest: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const rest: string[] = [];
  let cmd: string | null = null;
  let port = Number(process.env.LOBBY_PORT ?? 4311);
  let external = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port') {
      const raw = argv[i + 1];
      const n = Number(raw);
      if (!raw || !Number.isInteger(n) || n < 1 || n > 65535) {
        console.error('用法：lobby --port <1-65535>');
        process.exit(2);
      }
      port = n;
      i += 1;
      continue;
    }
    if (a === '--external') {
      external = true;
      continue;
    }
    if (a === '--help' || a === '-h') {
      cmd = 'help';
      continue;
    }
    if (!cmd && !a.startsWith('-')) {
      cmd = a;
      continue;
    }
    rest.push(a);
  }

  return { cmd, port, external, rest };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.cmd === 'help') {
    printHelp();
    return;
  }

  if (args.cmd === 'icon') {
    const full = args.rest.includes('--full') || args.rest.includes('full');
    console.log(full ? renderIconBlocks(1) : renderIconAnsi(1));
    return;
  }

  const envHttp = process.env.LOBBY_HTTP_URL ?? 'http://127.0.0.1:4311';
  const stack = await startStack({
    port: args.port,
    external: args.external,
    httpBase: envHttp,
  });

  let exiting = false;
  const cleanup = async (code: number): Promise<void> => {
    if (exiting) return;
    exiting = true;
    try {
      await stack.stop();
    } catch {
      /* ignore */
    }
    process.exit(code);
  };

  process.on('SIGINT', () => void cleanup(0));
  process.on('SIGTERM', () => void cleanup(0));

  try {
    const ink = render(
      <App httpBase={stack.httpBase} embedded={stack.embedded} />
    );
    await ink.waitUntilExit();
    await cleanup(0);
  } catch (err) {
    console.error(String(err));
    await cleanup(1);
  }
}

main().catch(async (err) => {
  console.error(String(err));
  process.exit(1);
});
