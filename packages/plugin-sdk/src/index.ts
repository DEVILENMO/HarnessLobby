import WebSocket from 'ws';
import os from 'node:os';
import type {
  ActivityState,
  HarnessProfile,
  LobbyToPlugin,
  PluginToLobby,
  TaskNew,
} from '@harness-lobby/protocol';

export type PluginHandlers = {
  profile: HarnessProfile;
  token: string;
  onRegister?: (ack: Extract<LobbyToPlugin, { type: 'register_ack' }>) => void;
  onBind?: (roomId: string, externalSessionRef: string) => void;
  onTask?: (task: TaskNew) => void | Promise<void>;
  onRoomMessage?: (msg: Extract<LobbyToPlugin, { type: 'room.message' }>) => void;
  onDisconnect?: () => void;
  log?: (line: string) => void;
};

export type PluginHandle = {
  stream: (roomId: string, messageId: string, delta: string) => void;
  finalize: (roomId: string, messageId: string, content: string) => void;
  status: (roomId: string, state: ActivityState) => void;
  bind: (roomId: string, externalSessionRef: string) => void;
  close: () => void;
  readonly harnessId: string | null;
  readonly connected: boolean;
};

export function connectPlugin(
  url: string,
  handlers: PluginHandlers
): PluginHandle {
  const log = handlers.log ?? ((line: string) => console.log(line));
  let socket: WebSocket | null = null;
  let harnessId: string | null = null;
  let closed = false;
  let retryMs = 500;
  let registered = false;
  const outbox: PluginToLobby[] = [];
  const finalized = new Set<string>();

  const send = (msg: PluginToLobby): void => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    } else {
      outbox.push(msg);
      if (outbox.length > 2000) outbox.splice(0, outbox.length - 2000);
    }
  };

  const flushOutbox = (): void => {
    while (outbox.length && socket && socket.readyState === WebSocket.OPEN) {
      const msg = outbox.shift();
      if (msg) socket.send(JSON.stringify(msg));
    }
  };

  const open = (): void => {
    if (closed) return;
    const sep = url.includes('?') ? '&' : '?';
    socket = new WebSocket(`${url}${sep}role=plugin`);
    // Attach error first — unhandled 'error' crashes the host process.
    socket.on('error', (err) => {
      log(`[plugin-sdk] socket error: ${String(err)}`);
    });

    socket.on('open', () => {
      retryMs = 500;
      const profile: HarnessProfile = {
        ...handlers.profile,
        computerName: handlers.profile.computerName ?? os.hostname(),
      };
      send({
        type: 'register_lobby',
        token: handlers.token,
        profile,
      });
      flushOutbox();
    });

    socket.on('message', (raw) => {
      let msg: LobbyToPlugin;
      try {
        msg = JSON.parse(String(raw)) as LobbyToPlugin;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'register_ack': {
          registered = true;
          harnessId = msg.harnessId;
          log(`[plugin-sdk] registered as ${msg.harnessId} rooms=${msg.assignedRooms.join(',') || '-'}`);
          handlers.onRegister?.(msg);
          flushOutbox();
          break;
        }
        case 'register_nack': {
          log(`[plugin-sdk] register rejected: ${msg.error}`);
          closed = true;
          socket?.close();
          break;
        }
        case 'task.new': {
          void handlers.onTask?.({
            roomId: msg.roomId,
            messageId: msg.messageId,
            mentions: msg.mentions,
            taskText: msg.taskText,
            contextSnapshot: msg.contextSnapshot,
          });
          break;
        }
        case 'room.message': {
          handlers.onRoomMessage?.(msg);
          break;
        }
        case 'pong':
          break;
        default:
          break;
      }
    });

    socket.on('close', () => {
      handlers.onDisconnect?.();
      if (closed) return;
      log(`[plugin-sdk] disconnected, retry in ${retryMs}ms`);
      setTimeout(() => {
        registered = false;
        open();
      }, retryMs);
      retryMs = Math.min(retryMs * 2, 8000);
    });

    socket.on('error', (err) => {
      log(`[plugin-sdk] socket error: ${String(err)}`);
    });
  };

  open();

  return {
    get harnessId() {
      return harnessId;
    },
    get connected() {
      return registered;
    },
    stream(roomId, messageId, delta) {
      if (finalized.has(messageId)) return;
      send({ type: 'message.stream', roomId, messageId, delta });
    },
    finalize(roomId, messageId, content) {
      if (finalized.has(messageId)) return;
      finalized.add(messageId);
      send({ type: 'message.final', roomId, messageId, content });
    },
    status(roomId, state) {
      send({ type: 'status.update', roomId, state });
    },
    bind(roomId, externalSessionRef) {
      handlers.onBind?.(roomId, externalSessionRef);
      send({ type: 'session.bind', roomId, externalSessionRef });
    },
    close() {
      closed = true;
      socket?.close();
    },
  };
}
