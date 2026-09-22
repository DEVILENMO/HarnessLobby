#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { printHelp } from './help.js';
import { renderIconAnsi, renderIconBlocks } from './pixel-icon.js';

const args = process.argv.slice(2);
const httpBase = process.env.LOBBY_HTTP_URL ?? 'http://127.0.0.1:4311';

function main(): void {
  const cmd = args[0];

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (cmd === 'icon') {
    const full = args.includes('--full');
    console.log(full ? renderIconBlocks(1) : renderIconAnsi(1));
    return;
  }

  render(<App httpBase={httpBase} />);
}

main();
