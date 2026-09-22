import { LobbyServer } from './lobby.js';

const port = Number(process.env.LOBBY_PORT ?? 4311);
const host = process.env.LOBBY_HOST ?? '127.0.0.1';

const server = new LobbyServer({ port, host });

server
  .listen()
  .then(() => {
    console.log(`[lobby] ${server.store.lobbyId} listening`);
    console.log(`[lobby] REST  http://${host}:${port}`);
    console.log(`[lobby] WS    ${server.wsUrl}`);
    console.log(`[lobby] plugin endpoint: ${server.wsUrl}?role=plugin`);
  })
  .catch((err) => {
    console.error('[lobby] failed to start', err);
    process.exit(1);
  });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
