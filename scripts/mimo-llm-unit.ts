/**
 * Unit-style probes for SSE flush + partial retention on error.
 */
import { streamChat, echoStream } from '../examples/mimo-harness/src/llm.js';
import http from 'node:http';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function testSseNoTrailingNewline() {
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // final data line WITHOUT trailing newline
      res.write('data: {"choices":[{"delta":{"content":"HELLO"}}]}\n');
      res.write('data: {"choices":[{"delta":{"content":" WORLD"}}]}');
      res.end();
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(4522, '127.0.0.1', () => r()));
  try {
    let out = '';
    const full = await streamChat(
      { baseUrl: 'http://127.0.0.1:4522', apiKey: 'x' },
      [{ role: 'user', content: 'hi' }],
      { onDelta: (d) => (out += d) }
    );
    if (full !== 'HELLO WORLD' || out !== 'HELLO WORLD') {
      throw new Error(`SSE flush fail full=${JSON.stringify(full)}`);
    }
    console.log('SSE flush PASS');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function testPartialOnError() {
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"PART"}}]}\n');
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"IAL"}}]}\n');
        setTimeout(() => res.destroy(), 30);
      }, 30);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(4523, '127.0.0.1', () => r()));
  try {
    let out = '';
    try {
      await streamChat(
        { baseUrl: 'http://127.0.0.1:4523', apiKey: 'x' },
        [{ role: 'user', content: 'hi' }],
        { onDelta: (d) => (out += d) }
      );
      // ending without throw is acceptable if destroy looked like EOF — partial must still hold
    } catch (e) {
      const err = e as Error & { partial?: string };
      const body = (err.partial ?? '') + out;
      if (!body.includes('PART')) {
        throw new Error(`partial lost body=${err.partial} out=${out}`);
      }
    }
    if (!out.includes('PART')) {
      throw new Error(`no PART streamed out=${out}`);
    }
    console.log('partial-on-error PASS');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await sleep(50);
  }
}

async function testEchoReturnsFull() {
  let out = '';
  const full = echoStream('task', { onDelta: (d) => (out += d) });
  if (!full.includes('task') || out !== full) throw new Error('echo mismatch');
  console.log('echo-full PASS');
}

await testSseNoTrailingNewline();
await testPartialOnError();
await testEchoReturnsFull();
console.log('MIMO LLM UNIT PASS');
