import fs from 'node:fs';
import path from 'node:path';

const root = 'C:/Users/DEVIL/XiaomiMiMoProjects/ARCHHarnessLobby';
const app = path.join(root, 'packages/cli/src/app.tsx');
let t = fs.readFileSync(app, 'utf8');

t = t.replace(
  /const \[logs, setLogs\] = useState<LogLine\[\]>\(\[\]\);/,
  "const [logs, setLogs] = useState<LogLine[]>([{ text: '正在连接 Lobby…', tone: 'dim' }]);"
);

t = t.replace(/\n[ \t]*\{logs\.length > 0 \? \([\s\S]*?\) : null\}/g, '\n');
t = t.replace(/\{logs\.map\(\(l, i\) => \([\s\S]*?\)\)\}/g, '');

const inject = `        {logs.map((l, i) => (
          <Text key={String(i)} color={l.tone === 'err' ? '#FF6B7A' : l.tone === 'ok' ? '#3DDC97' : '#7E93A3'}>{l.text}</Text>
        ))}
        {err ? (`;
t = t.replace('{err ? (', inject);

fs.writeFileSync(app, t, 'utf8');

const lobby = path.join(root, 'packages/server/src/lobby.ts');
let s = fs.readFileSync(lobby, 'utf8');
if (!s.includes('STUCK_MS')) {
  s = s.replace(
    'export class LobbyServer {',
    "const STUCK_MS = 90_000;\n\nexport class LobbyServer {\n  private lastActive = new Map<string, number>();\n  private stuckTimer?: NodeJS.Timeout;"
  );
  s = s.replace(
    "harness.status = state === 'idle' ? 'online' : 'working';",
    "harness.status = state === 'idle' ? 'online' : 'working';\n      this.lastActive.set(harnessId, Date.now());"
  );
  s = s.replace('async listen(): Promise<void> {', `async listen(): Promise<void> {
    this.stuckTimer = setInterval(() => {
      const now = Date.now();
      for (const h of this.store.harnesses.values()) {
        if (h.status === 'working' && now - (this.lastActive.get(h.id) ?? now) > STUCK_MS) {
          h.status = 'online';
          this.broadcastClient({ type: 'harness.presence', harnessId: h.id, status: 'online' });
        }
      }
    }, 15_000);`);
  s = s.replace(
    'async close(): Promise<void> {',
    'async close(): Promise<void> {\n    if (this.stuckTimer) clearInterval(this.stuckTimer);'
  );
  fs.writeFileSync(lobby, s, 'utf8');
}
console.log('patched');
