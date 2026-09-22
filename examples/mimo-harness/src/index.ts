import { connectPlugin } from '@harness-lobby/plugin-sdk';
import type { TaskNew } from '@harness-lobby/protocol';
import { buildChatMessages } from './prompt.js';
import { echoStream, streamChat, type LlmConfig } from './llm.js';

const url = process.env.LOBBY_WS_URL ?? 'ws://127.0.0.1:4311';
const token = process.env.LOBBY_TOKEN ?? 'ilv_mimo_open';
const mode = (process.env.MIMO_HARNESS_MODE ?? 'llm').toLowerCase();
const rooms = new Map<string, string>();

function llmConfig(): LlmConfig | null {
  const baseUrl = process.env.MIMO_LLM_BASE_URL;
  const apiKey = process.env.MIMO_LLM_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    apiKey,
    model: process.env.MIMO_MODEL || undefined,
  };
}

const cfg = llmConfig();
if (mode !== 'echo' && !cfg) {
  console.error(
    [
      '[mimo-harness] 缺少 MIMO_LLM_BASE_URL / MIMO_LLM_API_KEY。',
      '请在 MiMoCode 项目目录执行：',
      '  mimo llm-server issue --json --label harness-lobby-mimo',
      '然后导出 base_url → MIMO_LLM_BASE_URL，api_key → MIMO_LLM_API_KEY。',
      '离线演示可用 MIMO_HARNESS_MODE=echo。',
    ].join('\n')
  );
  process.exit(1);
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
    rooms.set(roomId, externalSessionRef);
    console.log(`[mimo] bind room=${roomId} session=${externalSessionRef}`);
  },
  async onTask(task: TaskNew) {
    let sessionRef = rooms.get(task.roomId);
    if (!sessionRef) {
      sessionRef = `sess_mimo_${task.roomId}`;
      plugin.bind(task.roomId, sessionRef);
      rooms.set(task.roomId, sessionRef);
    }

    plugin.status(task.roomId, 'thinking');
    plugin.status(task.roomId, 'working');

    try {
      if (mode === 'echo' || !cfg) {
        const full = echoStream(task.taskText, {
          onDelta: (d) => plugin.stream(task.roomId, task.messageId, d),
        });
        plugin.finalize(task.roomId, task.messageId, full);
      } else {
        const messages = buildChatMessages(
          task.taskText,
          task.contextSnapshot,
          task.roomId
        );
        const full = await streamChat(cfg, messages, {
          onDelta: (d) => plugin.stream(task.roomId, task.messageId, d),
        });
        plugin.finalize(task.roomId, task.messageId, full);
      }
    } catch (err) {
      const text = String(err instanceof Error ? err.message : err);
      plugin.stream(task.roomId, task.messageId, `\n\n${text}`);
      plugin.finalize(task.roomId, task.messageId, text);
    } finally {
      plugin.status(task.roomId, 'idle');
    }
  },
});

console.log(
  `[mimo-harness] connecting ${url} mode=${mode}${cfg ? ` model=${cfg.model ?? '(instance default)'}` : ''}`
);
void plugin;
