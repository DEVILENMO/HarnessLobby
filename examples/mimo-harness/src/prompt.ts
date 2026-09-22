import type { Message } from '@harness-lobby/protocol';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export function buildChatMessages(
  taskText: string,
  contextSnapshot: Message[],
  roomLabel: string
): ChatMessage[] {
  const lines = contextSnapshot.slice(-12).map((m) => {
    const who =
      m.senderId === 'u_you'
        ? 'you'
        : m.senderId === 'system'
          ? 'system'
          : m.senderId;
    const body = (m.content || '').replace(/\s+/g, ' ').slice(0, 160);
    return `- ${who}: ${body}`;
  });

  const system = [
    '你是 Harness Lobby 房间里的 harness 成员「MiMo Code」。',
    '用简洁中文回答；若任务像编程工作，给出可执行步骤或要点列表。',
    '不要编造已读文件的具体路径或未提供的代码细节。',
    `当前房间：${roomLabel}`,
  ].join('\n');

  const user = [
    `房间近况（context_snapshot）：`,
    lines.length ? lines.join('\n') : '（无）',
    '',
    `派活：${taskText}`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
