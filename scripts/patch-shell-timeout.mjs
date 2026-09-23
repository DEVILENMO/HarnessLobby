import fs from 'node:fs';
import path from 'node:path';

const root = 'C:/Users/DEVIL/XiaomiMiMoProjects/ARCHarnessLobby';
const lobby = path.join(root, 'packages/server/src/lobby.ts');
let s = fs.readFileSync(lobby, 'utf8');

if (!s.includes('SHELL_TIMEOUT_MS')) {
  s = s.replace(
    'export class LobbyServer {',
    `const SHELL_TIMEOUT_MS = 45_000;

export class LobbyServer {
  private shellTimers = new Map<string, NodeJS.Timeout>();`
  );

  // after creating replyShell, arm timeout
  s = s.replace(
    `      this.broadcastClient({ type: 'message.created', roomId, message: replyShell });`,
    `      this.broadcastClient({ type: 'message.created', roomId, message: replyShell });
      const t = setTimeout(() => {
        const cur = this.store.roomMessages(roomId).find((m) => m.id === replyShell.id);
        if (cur && cur.streamState !== 'final') {
          cur.content = cur.content || '（超时未响应）';
          cur.streamState = 'final';
          cur.state = 'idle';
          this.broadcastClient({ type: 'message.updated', roomId, message: cur });
          const h = this.store.harnesses.get(harness.id);
          if (h && h.status !== 'online') {
            h.status = 'online';
            this.broadcastClient({ type: 'harness.presence', harnessId: h.id, status: 'online' });
          }
        }
      }, SHELL_TIMEOUT_MS);
      this.shellTimers.set(replyShell.id, t);`
  );

  s = s.replace(
    'msg.streamState = \'final\';\n      msg.state = \'idle\';',
    `msg.streamState = 'final';
      msg.state = 'idle';
      const timer = this.shellTimers.get(messageId);
      if (timer) {
        clearTimeout(timer);
        this.shellTimers.delete(messageId);
      }`
  );

  s = s.replace(
    'async close(): Promise<void> {',
    'async close(): Promise<void> {\n    for (const t of this.shellTimers.values()) clearTimeout(t);\n    this.shellTimers.clear();'
  );
  fs.writeFileSync(lobby, s, 'utf8');
  console.log('timeout armed');
} else {
  console.log('timeout already present');
}
