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
  const emit = (line: string): string | null => {
    const clean = line.replace(/\r$/, '');
    if (clean.startsWith('data:')) return clean.slice(5).trim();
    return null;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const payload = emit(line);
      if (payload !== null) yield payload;
      nl = buf.indexOf('\n');
    }
  }
  buf += decoder.decode();
  if (buf.length) {
    for (const line of buf.split('\n')) {
      const payload = emit(line);
      if (payload !== null) yield payload;
    }
  }
}

function chatUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  // Accept both `http://127.0.0.1:PORT` and `http://127.0.0.1:PORT/v1`.
  if (base.endsWith('/v1')) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export async function streamChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  handlers: StreamHandlers
): Promise<string> {
  const url = chatUrl(cfg.baseUrl);
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

  let full = '';

  if (!res.ok) {
    const text = await res.text();
    let code = '';
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string } };
      code = parsed.error?.code ? ` code=${parsed.error.code}` : '';
    } catch {
      /* keep raw */
    }
    const suffix = res.status === 401
      ? `MiMo Capability API 401${code}。请在项目目录执行 mimo llm-server issue --json，并更新 MIMO_LLM_API_KEY / MIMO_LLM_BASE_URL（若已 revoke 需重新 issue）。`
      : res.status === 404
        ? `MiMo Capability API 404${code}。检查 MIMO_MODEL 是否为实例已配置的 provider/model；凭证异常时用 mimo llm-server list/revoke 后重新 issue。`
        : `MiMo Capability API ${res.status}${code} ${text.slice(0, 200)}`;
    const err = new Error(suffix) as Error & { partial?: string };
    err.partial = full;
    throw err;
  }

  try {
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
  } catch (e) {
    const err = (e instanceof Error ? e : new Error(String(e))) as Error & {
      partial?: string;
    };
    err.partial = full;
    throw err;
  }
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
