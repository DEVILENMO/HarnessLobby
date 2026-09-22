#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { printHelp } from './help.js';
import { renderIconAnsi, renderIconBlocks } from './pixel-icon.js';
import { startStack } from './onecmd.js';

type CliArgs = {
  cmd: string | null;
  port: number;
  withMock: boolean;
  external: boolean;
  rest: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const rest: string[] = [];
  let cmd: string | null = null;
  let port = Number(process.env.LOBBY_PORT ?? 4311);
  let withMock = true;
  let external = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port') {
      port = Number(argv[i + 1] ?? port);
      i += 1;
      continue;
    }
    if (a === '--no-mock') {
      withMock = false;
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

  return { cmd, port, withMock, external, rest };
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
    withMock: args.withMock,
    external: args.external || Boolean(process.env.LOBBY_HTTP_URL),
    httpBase: envHttp,
  });

  const ink = render(<App httpBase={stack.httpBase} embedded={stack.embedded} />);
  void ink.waitUntilExit().then(async () => {
    await stack.stop();
  });

  const cleanup = () => {
    void stack.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
