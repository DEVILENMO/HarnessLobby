/**
 * Regression probes: stream final immutability, messageId continuity, offline pending shell.
 */
import { LobbyServer } from '../packages/server/src/lobby.js';
import WebSocket from 'ws';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const port = 4399;
  const server = new LobbyServer({ port });
  await server.listen();

  const ws = new WebSocket(`ws://127.0.0.1:${port}?role=plugin`);
  await new Promise((r) => ws.on('open', r));
  ws.send(
    JSON.stringify({
      type: 'register_lobby',
      token: 'ilv_mimo_open',
      profile: {
        slug: 'mimo-code',
        displayName: 'MiMo Code',
        capabilities: ['x'],
        protocol: 'mode-a',
      },
    })
  );
  await sleep(100);

  const rooms = [...server.store.rooms.values()];
  const room = rooms.find((r) => r.topic === '具身智能') ?? rooms[0];
  server.postUserMessage(room.id, 'u_you', '@mimo-code probe task');
  await sleep(50);

  const customId = 'm_custom_123';
  ws.send(
    JSON.stringify({
      type: 'message.stream',
      roomId: room.id,
      messageId: customId,
      delta: 'orphan',
    })
  );
  await sleep(50);
  const afterStream = server.store
    .roomMessages(room.id)
    .find((m) => m.id === customId);
  if (!afterStream) throw new Error(`FAIL: messageId not honored (stream)`);
  if (afterStream.content !== 'orphan') {
    throw new Error(`FAIL: stream content ${afterStream.content}`);
  }

  ws.send(
    JSON.stringify({
      type: 'message.final',
      roomId: room.id,
      messageId: customId,
      content: 'ORPHAN FINAL',
    })
  );
  await sleep(50);
  const afterFinal = server.store
    .roomMessages(room.id)
    .find((m) => m.id === customId);
  if (!afterFinal || afterFinal.content !== 'ORPHAN FINAL' || afterFinal.streamState !== 'final') {
    throw new Error(`FAIL: final continuity ${JSON.stringify(afterFinal)}`);
  }

  ws.send(
    JSON.stringify({
      type: 'message.stream',
      roomId: room.id,
      messageId: customId,
      delta: ' WORLD',
    })
  );
  await sleep(50);
  const afterLate = server.store
    .roomMessages(room.id)
    .find((m) => m.id === customId);
  if (!afterLate || afterLate.content !== 'ORPHAN FINAL' || afterLate.streamState !== 'final') {
    throw new Error(
      `FAIL: post-final delta mutated message ${JSON.stringify(afterLate)}`
    );
  }

  const offline = server.store.harnesses.get('h_mimo');
  if (offline) offline.status = 'offline';
  ws.close();
  await sleep(80);
  server.postUserMessage(room.id, 'u_you', '@mimo-code offline probe');
  await sleep(50);
  const shells = server.store.roomMessages(room.id).filter((m) => m.senderId === 'h_mimo');
  const hung = shells.find((m) => m.content.includes('挂起'));
  if (!hung || hung.streamState !== 'final') {
    throw new Error(`FAIL: offline shell not persisted ${JSON.stringify(shells.slice(-3))}`);
  }

  await server.close();
  console.log('CRITICAL PROBES PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
