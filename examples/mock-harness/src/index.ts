import { connectPlugin } from '@harness-lobby/plugin-sdk';
import type { TaskNew } from '@harness-lobby/protocol';

const url = process.env.LOBBY_WS_URL ?? 'ws://127.0.0.1:4311';
const token = process.env.LOBBY_TOKEN ?? 'ilv_mock_open';

const sessions = new Map<string, string>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildReply(task: TaskNew, sessionRef: string): string {
  const echo = task.taskText.replace(/\s+/g, ' ').trim().slice(0, 80);
  const ctx = task.contextSnapshot.length;
  return [
    `收到派活 · bound session ${sessionRef}`,
    '',
    `任务：${echo}${task.taskText.length > 80 ? '…' : ''}`,
    `context_snapshot：${ctx} 条消息`,
    '',
    '步骤：',
    '1. 读取房间上下文',
    '2. 在 harness session 内规划',
    '3. 流式回写结果',
    '',
    '```',
    'status.update → working',
    'message.stream → deltas…',
    'message.final → done',
    '```',
    '',
    '完成。需要继续拆子任务吗？',
  ].join('\n');
}

const plugin = connectPlugin(url, {
  token,
  profile: {
    slug: 'mock-harness',
    displayName: 'Mock Harness',
    avatar: 'MH',
    capabilities: ['读文件', '写文件', '跑命令'],
    protocol: 'mode-a',
  },
  log: (line) => console.log(line),
  onBind(roomId, externalSessionRef) {
    sessions.set(roomId, externalSessionRef);
    console.log(`[mock] bind room=${roomId} session=${externalSessionRef}`);
  },
  async onTask(task) {
    let sessionRef = sessions.get(task.roomId);
    if (!sessionRef) {
      sessionRef = `sess_${task.roomId.slice(0, 6)}`;
      plugin.bind(task.roomId, sessionRef);
      sessions.set(task.roomId, sessionRef);
    }

    plugin.status(task.roomId, 'thinking');
    await sleep(400);
    plugin.status(task.roomId, 'working');

    const full = buildReply(task, sessionRef);
    let i = 0;
    while (i < full.length) {
      const n = 4 + Math.floor(Math.random() * 8);
      plugin.stream(task.roomId, task.messageId, full.slice(i, i + n));
      i += n;
      await sleep(28 + Math.random() * 36);
    }

    plugin.finalize(task.roomId, task.messageId, full);
    plugin.status(task.roomId, 'idle');
  },
});

console.log(`[mock-harness] connecting ${url}`);
void plugin;
