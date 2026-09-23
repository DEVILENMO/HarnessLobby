#!/usr/bin/env node
/**
 * lobby-responder — 常驻：收到 task.new 即用 MiMo Capability API 代答。
 * 不依赖 Agent 会话是否在线；token 来自 mimo llm-server issue（本机模型，非第三方 key）。
 */
import { connectPlugin } from '../packages/plugin-sdk/dist/index.js';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.LOBBY_WS_URL ?? 'ws://127.0.0.1:4311';
const token = process.env.LOBBY_TOKEN ?? 'ilv_mimo_open';
const sessions = new Map();
const cfgPath = process.env.MIMO_LLM_CONFIG ?? path.join(os.homedir(), '.config/mimocode/llm-token.json');

function loadCfg() {
  if (process.env.MIMO_LLM_BASE_URL && process.env.MIMO_LLM_API_KEY) {
    return { baseUrl: process.env.MIMO_LLM_BASE_URL, apiKey: process.env.MIMO_LLM_API_KEY, model: process.env.MIMO_MODEL };
  }
  try {
    const j = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return { baseUrl: j.base_url ?? j.baseUrl, apiKey: j.api_key ?? j.apiKey, model: j.model };
  } catch {
    return null;
  }
}

async function chat(taskText, ctx) {
  const cfg = loadCfg();
  const lines = (ctx ?? []).slice(-8).map((m) => {
    const who = m.senderId === 'u_you' ? 'you' : m.senderId;
    return `- ${who}: ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 140)}`;
  });
  const sys =
    '你是 Harness Lobby 里的 MiMo Code（由 MiMo Desktop 后台 responder 代答）。用简洁中文回答，直接给结论或步骤。';
  const user = `房间近况：\n${lines.join('\n') || '（无）'}\n\n消息：${taskText}`;

  if (!cfg?.baseUrl || !cfg?.apiKey) {
    return '（responder 在线，但未配置 Capability API）\n请在 MiMoCode 项目目录执行 mimo llm-server issue --json，把 base_url/api_key 写入 ~/.config/mimocode/llm-token.json';
  }
  const base = cfg.baseUrl.replace(/\/$/, '');
  const u = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const body = {
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    stream: true,
  };
  if (cfg.model) body.model = cfg.model;
  const res = await fetch(u, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    return `Capability API ${res.status}: ${t.slice(0, 160)}`;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const d = j.choices?.[0]?.delta?.content;
        if (d) full += d;
      } catch {}
    }
  }
  return full || '（空回复）';
}

const plugin = connectPlugin(url, {
  token,
  profile: {
    slug: 'mimo-code',
    displayName: 'MiMo Code',
    avatar: 'MM',
    capabilities: ['对话', '读上下文摘要', '流式回写'],
    protocol: 'mode-a',
    computerName: os.hostname(),
  },
  log: (l) => console.log(l),
  onBind(roomId, ref) {
    sessions.set(roomId, ref);
  },
  async onTask(task) {
    let ref = sessions.get(task.roomId);
    if (!ref) {
      ref = `sess_mimo_${task.roomId}`;
      plugin.bind(task.roomId, ref);
      sessions.set(task.roomId, ref);
    }
    plugin.status(task.roomId, 'thinking');
    await new Promise((r) => setTimeout(r, 150));
    plugin.status(task.roomId, 'working');
    try {
      const q = (task.taskText ?? '').trim();
      const bcast = (task.mentions ?? []).includes('*');
      if (bcast && q.length < 3) {
        plugin.finalize(task.roomId, task.messageId, '');
        return;
      }
      const full = await chat(q, task.contextSnapshot);
      for (let i = 0; i < full.length; i += 12) {
        plugin.stream(task.roomId, task.messageId, full.slice(i, i + 12));
        await new Promise((r) => setTimeout(r, 12));
      }
      plugin.finalize(task.roomId, task.messageId, full);
    } catch (e) {
      plugin.finalize(task.roomId, task.messageId, `responder 错误：${e?.message ?? e}`);
    } finally {
      plugin.status(task.roomId, 'idle');
    }
  },
});

console.log(`[lobby-responder] ${url}`);
void plugin;
