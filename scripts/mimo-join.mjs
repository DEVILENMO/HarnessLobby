/**
 * Register this session as harness `mimo-code` on the local Lobby (Mode A).
 * Keeps a WS connection and prints task.new to stdout for the agent to pick up.
 */
import { connectPlugin } from '../packages/plugin-sdk/dist/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const inbox = path.join(os.tmpdir(), 'lobby-mimo-tasks.jsonl');
const url = process.env.LOBBY_WS_URL ?? 'ws://127.0.0.1:4311';
const token = process.env.LOBBY_TOKEN ?? 'ilv_mimo_open';
const sessions = new Map();

function append(line) {
  fs.appendFileSync(inbox, JSON.stringify(line) + '\n');
}

const plugin = connectPlugin(url, {
  token,
  profile: {
    slug: 'mimo-code',
    displayName: 'MiMo Code',
    avatar: 'MM',
    capabilities: ['对话', '读上下文摘要', '流式回写'],
    protocol: 'mode-a',
  },
  log: (line) => console.log(line),
  onBind(roomId, externalSessionRef) {
    sessions.set(roomId, externalSessionRef);
    append({ kind: 'bind', roomId, externalSessionRef, at: Date.now() });
  },
  onTask(task) {
    append({ kind: 'task', ...task, at: Date.now() });
    // Idle shell so the room shows the agent received work; the real answer
    // is streamed later by the session (agent) via a follow-up script.
    let ref = sessions.get(task.roomId);
    if (!ref) {
      ref = `sess_mimo_${task.roomId}`;
      plugin.bind(task.roomId, ref);
      sessions.set(task.roomId, ref);
    }
    plugin.status(task.roomId, 'working');
    const ack =
      '已收到任务（MiMo Code 会话已接手）。正在处理，完成后会流式回写本房间。';
    for (const ch of ack) plugin.stream(task.roomId, task.messageId, ch);
    plugin.finalize(task.roomId, task.messageId, ack);
    plugin.status(task.roomId, 'idle');
  },
});

console.log(`[mimo-join] ${url} inbox=${inbox}`);
void plugin;
