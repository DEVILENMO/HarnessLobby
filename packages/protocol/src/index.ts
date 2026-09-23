export type Mode = 'A';
export type MemberType = 'human' | 'harness';
export type HarnessStatus = 'online' | 'offline' | 'working';
export type StreamState = 'streaming' | 'final';
export type ActivityState = 'thinking' | 'working' | 'idle';

export interface HarnessProfile {
  slug: string;
  displayName: string;
  avatar?: string;
  capabilities: string[];
  protocol: 'mode-a';
  /** 主机名，如 LAPTOP-OD2APUUK；注册后 slug 变成 `<slug>-<computerName>` */
  computerName?: string;
}

export interface Harness extends HarnessProfile {
  id: string;
  mode: Mode;
  status: HarnessStatus;
  authToken: string;
  pluginEndpoint: string;
  assignedRooms: string[];
}

export interface Room {
  id: string;
  topic: string;
  /** null = 公共大厅（所有人可进）；非 null = 仅 owner 人类可进 */
  ownerId: string | null;
  memberIds: string[];
  createdAt: string;
}

export interface Member {
  id: string;
  type: MemberType;
  displayName: string;
  slug: string;
}

export interface BoundSession {
  id: string;
  roomId: string;
  harnessId: string;
  externalSessionRef: string;
  createdAt: string;
}

export interface Message {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  mentions: string[];
  parentId?: string | null;
  createdAt: string;
  streamState: StreamState;
  state?: ActivityState;
  boundSessionId?: string;
}

export interface TaskNew {
  roomId: string;
  messageId: string;
  mentions: string[];
  taskText: string;
  contextSnapshot: Message[];
}

export type PluginToLobby =
  | { type: 'register_lobby'; token: string; profile: HarnessProfile }
  | { type: 'session.bind'; roomId: string; externalSessionRef: string }
  | { type: 'message.stream'; roomId: string; messageId: string; delta: string }
  | { type: 'message.final'; roomId: string; messageId: string; content: string }
  | { type: 'status.update'; roomId: string; state: ActivityState }
  | { type: 'ping' };

export type LobbyToPlugin =
  | {
      type: 'register_ack';
      lobbyId: string;
      wsUrl: string;
      assignedRooms: string[];
      harnessId: string;
      status: 'online';
    }
  | { type: 'register_nack'; error: string }
  | (TaskNew & { type: 'task.new' })
  | {
      type: 'room.message';
      roomId: string;
      messageId: string;
      content: string;
      senderId: string;
    }
  | { type: 'pong' };

export type ClientEvent =
  | { type: 'hello'; clientId: string }
  | {
      type: 'message.created';
      roomId: string;
      message: Message;
    }
  | {
      type: 'message.updated';
      roomId: string;
      message: Message;
    }
  | {
      type: 'bound_session';
      roomId: string;
      session: BoundSession;
    }
  | {
      type: 'harness.presence';
      harnessId: string;
      status: HarnessStatus;
    };

export function parseMentions(text: string, known: Iterable<string>): string[] {
  const set = new Set(known);
  const out: string[] = [];
  const re = /@([A-Za-z0-9][A-Za-z0-9-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const slug = m[1];
    // 精确匹配注册名；也允许只写 harness 名时匹配唯一实例
    if (set.has(slug) && !out.includes(slug)) out.push(slug);
  }
  return out;
}

export function instanceSlug(baseSlug: string, computerName?: string): string {
  const b = (baseSlug || 'harness').trim();
  const c = (computerName || '').trim();
  return c ? `${b}-${c}` : b;
}

export function nowStamp(): string {
  return new Date().toISOString();
}

export function hhmm(iso = nowStamp()): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
