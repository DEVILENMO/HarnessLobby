/**
 * MiMo Code worker on Lobby — answers @mimo-code for real (LLM or useful echo).
 */
import { connectPlugin } from '../packages/plugin-sdk/dist/index.js';
import { streamChat } from '../examples/mimo-harness/dist/llm.js';

const url = process.env.LOBBY_WS_URL ?? 'ws://127.0.0.1:4311';
const token = process.env.LOBBY_TOKEN ?? 'ilv_mimo_open';
const sessions = new Map();

process.on('uncaughtException', (err) => {
  console.error('[mimo-code worker] uncaught', err?.message ?? err);
});
process.on('unhandledRejection', (err) => {
  console.error('[mimo-code worker] unhandledRejection', err);
});

function llmConfig() {
  const baseUrl = process.env.MIMO_LLM_BASE_URL;
  const apiKey = process.env.MIMO_LLM_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model: process.env.MIMO_MODEL || undefined };
}

function buildMessages(taskText, contextSnapshot) {
  const lines = (contextSnapshot ?? []).slice(-8).map((m) => {
    const who = m.senderId === 'u_you' ? 'you' : m.senderId;
    return `- ${who}: ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 120)}`;
  });
  return [
    {
      role: 'system',
      content: '你是 Harness Lobby 里的 MiMo Code。用简洁中文回答问题、完成派活。',
    },
    {
      role: 'user',
      content: `房间近况：\n${lines.join('\n') || '（无）'}\n\n派活：${taskText}`,
    },
  ];
}

function echoReply(taskText, ctxLen, sessionRef) {
  const q = taskText.replace(/@[a-z0-9-]+/gi, '').trim() || '（空任务）';
  if (/^(hello|hi|你好|在吗|在\?|ping|嗨)/i.test(q)) {
    return `在的。我是 MiMo Code（${sessionRef}）。\n\n直接说要做什么，例如：\n- 总结一下本房间讨论\n- 把需求拆成任务清单\n- 写一段 xxx 的代码骨架`;
  }
  return [
    `MiMo Code 收到（${sessionRef}）`,
    '',
    `任务：${q.slice(0, 200)}`,
    `房间上下文：${ctxLen} 条`,
    '',
    '处理要点：',
    '1. 结合房间近况理解意图',
    '2. 给出可执行的下一步或答案',
    '3. 长文可要求「分段写」',
    '',
    '（本地 worker；配置 MIMO_LLM_BASE_URL / MIMO_LLM_API_KEY 后走真实模型）',
  ].join('\n');
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
  },
  async onTask(task) {
    let ref = sessions.get(task.roomId);
    if (!ref) {
      ref = `sess_mimo_${task.roomId}`;
      plugin.bind(task.roomId, ref);
      sessions.set(task.roomId, ref);
    }
    plugin.status(task.roomId, 'thinking');
    await new Promise((r) => setTimeout(r, 200));
    plugin.status(task.roomId, 'working');
    try {
      const cfg = llmConfig();
      let full;
      if (cfg) {
        full = await streamChat(cfg, buildMessages(task.taskText, task.contextSnapshot), {
          onDelta: (d) => plugin.stream(task.roomId, task.messageId, d),
        });
      } else {
        full = echoReply(task.taskText, task.contextSnapshot?.length ?? 0, ref);
        for (let i = 0; i < full.length; i += 6) {
          plugin.stream(task.roomId, task.messageId, full.slice(i, i + 6));
          await new Promise((r) => setTimeout(r, 14));
        }
      }
      plugin.finalize(task.roomId, task.messageId, full);
    } catch (e) {
      plugin.finalize(task.roomId, task.messageId, `处理失败：${e?.message ?? e}`);
    } finally {
      plugin.status(task.roomId, 'idle');
    }
  },
});

console.log(`[mimo-code worker] ${url}`);
void plugin;
