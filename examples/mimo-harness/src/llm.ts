import type { ChatMessage } from './prompt.js';

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model?: string;
};

export type StreamHandlers = {
  onDelta: (delta: string) => void;
};

async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) {
        yield line.slice(5).trim();
      }
      nl = buf.indexOf('\n');
    }
  }
}

export async function streamChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  handlers: StreamHandlers
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const body: Record<string, unknown> = {
    messages,
    stream: true,
  };
  if (cfg.model) body.model = cfg.model;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    let code = '';
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string } };
      code = parsed.error?.code ? ` code=${parsed.error.code}` : '';
    } catch {
      /* keep raw */
    }
    if (res.status === 401) {
      throw new Error(
        `MiMo Capability API 401${code}。请在项目目录执行 mimo llm-server issue --json，并更新 MIMO_LLM_API_KEY / MIMO_LLM_BASE_URL（若已 revoke 需重新 issue）。`
      );
    }
    if (res.status === 404) {
      throw new Error(
        `MiMo Capability API 404${code}。检查 MIMO_MODEL 是否为实例已配置的 provider/model。`
      );
    }
    throw new Error(`MiMo Capability API ${res.status}${code} ${text.slice(0, 200)}`);
  }

  let full = '';
  for await (const payload of sseLines(res)) {
    if (payload === '[DONE]') break;
    try {
      const json = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        handlers.onDelta(delta);
      }
    } catch {
      /* skip malformed chunk */
    }
  }
  return full;
}

export function echoStream(
  taskText: string,
  handlers: StreamHandlers
): string {
  const full = [
    '（echo 模式 · 未连接 MiMo Capability API）',
    '',
    `收到：${taskText}`,
    '',
    '接真实模型：',
    '1. 在项目目录执行 `mimo llm-server issue --json`',
    '2. 导出 MIMO_LLM_BASE_URL / MIMO_LLM_API_KEY',
    '3. 重启本插件（MIMO_HARNESS_MODE=llm 或省略）',
  ].join('\n');
  for (const ch of full) handlers.onDelta(ch);
  return full;
}
