import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { hhmm, type Message } from '@harness-lobby/protocol';
import { LobbyClient } from './client.js';
import { PixelIcon } from './pixel-icon.js';

type LogLine = { text: string; tone?: 'ok' | 'warn' | 'err' | 'dim' };

const HELP = [
  '/room create <主题>   创建私有工作间（仅你能进）',
  '/room switch <主题>   切换房间（swich 同义）',
  '/room list           我能进的房间',
  '/room add <slug>     把 harness 拉进当前房',
  '/members /harnesses /bound /reset /help /quit',
].join('\n');

export function App({
  httpBase,
  embedded = false,
}: {
  httpBase: string;
  embedded?: boolean;
}): React.ReactElement {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const client = useMemo(() => new LobbyClient(httpBase), [httpBase]);
  const [, setTick] = useState(0);
  const [input, setInput] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([
    { text: '正在连接 Lobby…', tone: 'dim' },
  ]);
  const [err, setErr] = useState<string | null>(null);
  const bootRef = useRef(false);
  const completionRef = useRef({ idx: 0 });

  const bump = () => setTick((t) => t + 1);

  useEffect(() => {
    const unsub = client.subscribe(bump);
    if (bootRef.current) return unsub;
    bootRef.current = true;
    void (async () => {
      try {
        await client.refresh();
        client.connectWs();
        setErr(null);
        setLogs((l) => [
          ...l,
          { text: `已连接 ${client.state.lobbyId} · ${httpBase}`, tone: 'ok' },
        ]);
        setRoomId((prev) => prev ?? client.state.rooms.find((r) => r.topic === '大厅')?.id ?? client.state.rooms[0]?.id ?? null);
      } catch (e) {
        setErr(`无法连接 Lobby Server：${String(e)}\n请先运行 npm run dev:server`);
      }
    })();
    return unsub;
  }, [client, httpBase]);

  const room = client.state.rooms.find((r) => r.id === roomId) ?? client.state.rooms[0];
  const messages = room ? (client.state.messages[room.id] ?? []) : [];
  // 离线 harness 不进列表：避免 mock/未接入身份一直挂着
  const harnesses = client.state.harnesses.filter((h) => h.status !== 'offline');
  const bound = room ? client.boundForRoom(room.id) : [];

  const pushLog = (text: string, tone?: LogLine['tone']) =>
    setLogs((l) => [...l.slice(-30), { text, tone }]);

  const runSlash = async (line: string): Promise<void> => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    const rest = parts.slice(1);
    const arg = rest.join(' ');

    const findRoom = (name: string) =>
      client.state.rooms.find(
        (r) => r.topic === name || r.id === name || r.topic.toLowerCase() === name.toLowerCase()
      );

    const switchRoom = (name: string): void => {
      const target = findRoom(name);
      if (!target) {
        pushLog(`找不到房间：${name}（/room list 查看你能进的）`, 'err');
        return;
      }
      setRoomId(target.id);
      pushLog(
        `已切换 → #${target.topic}${target.ownerId ? ' · 私有工作间' : ' · 公共大厅'}`,
        'ok'
      );
    };

    switch (cmd) {
      case '/help':
        pushLog(HELP, 'dim');
        break;
      case '/room':
      case '/rooms': {
        const sub = (rest[0] ?? '').toLowerCase();
        const name = rest.slice(1).join(' ');
        if (!sub || sub === 'list') {
          pushLog(
            client.state.rooms
              .map((r) => {
                const mark = r.id === room?.id ? '  ←' : '';
                const vis = r.ownerId ? '私有' : '公共';
                return `#${r.topic}  [${vis}]${mark}`;
              })
              .join('\n'),
            'dim'
          );
          break;
        }
        if (sub === 'create') {
          if (!name) return pushLog('用法：/room create <主题>', 'err');
          const created = await client.createRoom(name, 'u_you');
          setRoomId(created.id);
          pushLog(`已创建工作间 #${created.topic} · 仅你能进，可 /room add 拉 harness`, 'ok');
          break;
        }
        if (sub === 'switch' || sub === 'swich' || sub === 'use') {
          if (!name) return pushLog('用法：/room switch <主题>', 'err');
          switchRoom(name);
          break;
        }
        if (sub === 'add' || sub === 'invite') {
          if (!name || !room) return pushLog('用法：/room add <harness-slug>', 'err');
          try {
            await client.inviteHarness(room.id, name.replace(/^@/, ''));
            pushLog(`已把 @${name.replace(/^@/, '')} 拉进 #${room.topic}`, 'ok');
          } catch (e) {
            pushLog(`邀请失败：${String(e)}`, 'err');
          }
          break;
        }
        pushLog('用法：/room create|switch|list|add …', 'err');
        break;
      }
      case '/join':
      case '/new': {
        // 兼容旧别名
        if (cmd === '/new') {
          if (!arg) return pushLog('用法：/room create <主题>', 'err');
          const created = await client.createRoom(arg, 'u_you');
          setRoomId(created.id);
          pushLog(`已创建工作间 #${created.topic}`, 'ok');
        } else {
          if (!arg) return pushLog('用法：/room switch <主题>', 'err');
          switchRoom(arg);
        }
        break;
      }
      case '/members':
        pushLog(
          (room?.memberIds ?? [])
            .map((id) => {
              const h = harnesses.find((x) => x.id === id);
              const human = id === 'u_you' ? 'You' : id;
              return h ? `harness  @${h.slug}  ${h.status}` : `human    ${human}`;
            })
            .filter((line) => !line.includes('offline'))
            .join('\n'),
          'dim'
        );
        break;
      case '/harnesses':
        pushLog(
          client.state.harnesses
            .filter((h) => h.status !== 'offline')
            .map(
              (h) =>
                `@${h.slug.padEnd(14)} Mode A  ${h.status.padEnd(8)} ${h.capabilities.join(' / ')}`
            )
            .join('\n') || '（无在线 harness）',
          'dim'
        );
        break;
      case '/bound':
        pushLog(
          bound.length
            ? bound
                .map(
                  (b) =>
                    `${b.id}  room=${b.roomId}  external=${b.externalSessionRef}`
                )
                .join('\n')
            : '尚无 bound session · 首次 @ 时 lazy 创建',
          'dim'
        );
        break;
      case '/reset': {
        if (!arg || !room) return pushLog('用法：/reset <slug>', 'err');
        const ok = await client.resetSession(room.id, arg);
        pushLog(ok ? `已解绑 ${arg} 的 bound session` : '没有可解绑的 session', ok ? 'ok' : 'warn');
        break;
      }
      case '/quit':
      case '/exit':
        exit();
        break;
      default:
        pushLog(`未知命令：${cmd} · /help 查看列表`, 'err');
    }
  };

  const submit = async (): Promise<void> => {
    const text = input.trim();
    if (!text || !room) return;
    setInput('');
    if (text.startsWith('/')) {
      await runSlash(text);
      return;
    }
    try {
      await client.sendMessage(room.id, text);
    } catch (e) {
      pushLog(`发送失败：${String(e)}`, 'err');
    }
  };

  const completeMention = (value: string): string => {
    const m = value.match(/@([a-z0-9-]*)$/i);
    if (!m) return value;
    const q = m[1].toLowerCase();
    const pool = harnesses.filter((h) => h.slug.toLowerCase().startsWith(q));
    if (!pool.length) return value;
    const idx = completionRef.current.idx % pool.length;
    const pick = pool[idx];
    completionRef.current.idx = (idx + 1) % pool.length;
    return value.replace(/@([a-z0-9-]*)$/i, `@${pick.slug} `);
  };

  useInput((raw, key) => {
    if (!isRawModeSupported) return;
    if (key.tab) {
      setInput((s) => completeMention(s));
      return;
    }
    if (key.return && !key.shift) {
      completionRef.current.idx = 0;
      void submit();
      return;
    }
    if (key.backspace || key.delete) {
      completionRef.current.idx = 0;
      setInput((s) => s.slice(0, -1));
      return;
    }
    if (key.escape) {
      completionRef.current.idx = 0;
      setInput('');
      return;
    }
    if (raw && !key.ctrl && !key.meta) {
      completionRef.current.idx = 0;
      setInput((s) => s + raw);
    }
  });

  const colorFor = (m: Message): string | undefined => {
    if (m.senderId === 'u_you') return '#E0B56A';
    if (m.senderId === 'system') return '#5C6B76';
    return '#2FD4B8';
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <PixelIcon scale={1} />
        <Box flexDirection="column" marginLeft={2} justifyContent="center">
          <Text bold color="#E8F0F6">
            Harness Lobby
          </Text>
          <Text dimColor>
            {client.state.lobbyId} · {client.state.connected ? 'ws online' : 'ws offline'} · Mode A
            {embedded ? ' · embedded' : ' · external'}
          </Text>
          <Text dimColor>
            room {room ? `#${room.topic}${room.ownerId ? ' · 私有' : ' · 公共'}` : '—'} · members{' '}
            {room?.memberIds.length ?? 0} · bound {bound.length}
          </Text>
          <Box marginTop={1} flexDirection="column">
            {harnesses.length === 0 ? (
              <Text dimColor>（无在线 harness · 接入后显示）</Text>
            ) : (
              harnesses.map((h) => (
                <Text key={h.id}>
                  <Text color={h.status === 'working' ? '#2FD4B8' : '#3DDC97'}>●</Text>{' '}
                  @{h.slug} · {h.status}
                </Text>
              ))
            )}
          </Box>
        </Box>
      </Box>

      <Box marginY={1} flexDirection="column" flexGrow={1} minHeight={10}>
        {err ? (
          <Text color="#FF6B7A">{err}</Text>
        ) : (
          messages.slice(-12).map((m) => {
            const who =
              m.senderId === 'u_you'
                ? 'you'
                : harnesses.find((h) => h.id === m.senderId)?.slug ??
                  (m.senderId === 'system' ? 'system' : m.senderId);
            return (
              <Box key={m.id} flexDirection="column" marginBottom={1}>
                <Text>
                  <Text color={colorFor(m)} bold>
                    {who}
                  </Text>{' '}
                  <Text dimColor>{hhmm(m.createdAt)}</Text>{' '}
                  {m.streamState === 'streaming' ? (
                    <Text color="#2FD4B8">[{m.state ?? 'working'}]</Text>
                  ) : null}{' '}
                  {m.boundSessionId ? (
                    <Text dimColor>
                      bound · {bound.find((b) => b.id === m.boundSessionId)?.externalSessionRef ?? m.boundSessionId}
                    </Text>
                  ) : null}
                </Text>
                <Text>{m.content}</Text>
                {m.streamState === 'streaming' ? <Text color="#2FD4B8">▍</Text> : null}
              </Box>
            );
          })
        )}
        {logs.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            {logs.slice(-4).map((l, i) => (
              <Text
                key={i}
                color={l.tone === 'err' ? '#FF6B7A' : l.tone === 'ok' ? '#3DDC97' : '#7E93A3'}
              >
                {l.text}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>

      <Box borderStyle="single" borderColor="#24333F" paddingX={1}>
        <Text color="#2FD4B8">› </Text>
        <Text>{input}</Text>
        <Text color="#2FD4B8">▍</Text>
      </Box>
      <Text dimColor>
        enter 发送 · @ + tab 补全 · /room create|switch · /help
      </Text>
    </Box>
  );
}
