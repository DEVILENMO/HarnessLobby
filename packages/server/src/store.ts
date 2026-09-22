import {
  type BoundSession,
  type Harness,
  type HarnessProfile,
  type Member,
  type Message,
  type Room,
  nowStamp,
} from '@harness-lobby/protocol';

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export class Store {
  lobbyId = 'lobby_local';
  harnesses = new Map<string, Harness>();
  rooms = new Map<string, Room>();
  members = new Map<string, Member>();
  messages = new Map<string, Message[]>();
  bound = new Map<string, BoundSession>();
  /** harnessId -> pending task.new payloads */
  pendingTasks = new Map<string, unknown[]>();

  constructor() {
    this.seed();
  }

  private seed(): void {
    const you: Member = {
      id: 'u_you',
      type: 'human',
      displayName: 'You',
      slug: 'you',
    };
    this.members.set(you.id, you);

    const mimo: Harness = {
      id: 'h_mimo',
      mode: 'A',
      slug: 'mimo-code',
      displayName: 'MiMo Code',
      avatar: 'MM',
      capabilities: ['对话', '读上下文摘要', '流式回写'],
      authToken: 'ilv_mimo_open',
      pluginEndpoint: 'ws://plugin/mimo-harness',
      assignedRooms: [],
      status: 'offline',
      protocol: 'mode-a',
    };
    this.harnesses.set(mimo.id, mimo);

    const lobby = this.createRoom('大厅', ['u_you', 'h_mimo']);
    const embodied = this.createRoom('具身智能', ['u_you', 'h_mimo']);
    this.messages.get(lobby.id)?.push({
      id: uid('m'),
      roomId: lobby.id,
      senderId: 'system',
      content: '房间「大厅」已创建 · @mimo-code 可派活',
      mentions: [],
      createdAt: nowStamp(),
      streamState: 'final',
    });
    this.messages.get(embodied.id)?.push({
      id: uid('m'),
      roomId: embodied.id,
      senderId: 'system',
      content: '房间「具身智能」已创建 · @mimo-code 可派活',
      mentions: [],
      createdAt: nowStamp(),
      streamState: 'final',
    });
  }

  createRoom(topic: string, memberIds: string[] = ['u_you']): Room {
    const room: Room = {
      id: uid('r'),
      topic,
      memberIds: [...memberIds],
      createdAt: nowStamp(),
    };
    this.rooms.set(room.id, room);
    this.messages.set(room.id, []);
    return room;
  }

  ensureMemberFromHarness(harness: Harness, profile: HarnessProfile): Member {
    const id = harness.id;
    const member: Member = {
      id,
      type: 'harness',
      displayName: profile.displayName,
      slug: profile.slug,
    };
    this.members.set(id, member);
    return member;
  }

  findHarnessBySlug(slug: string): Harness | undefined {
    const s = slug.toLowerCase();
    for (const h of this.harnesses.values()) {
      if (h.slug.toLowerCase() === s) return h;
    }
    return undefined;
  }

  findHarnessByToken(token: string): Harness | undefined {
    for (const h of this.harnesses.values()) {
      if (h.authToken === token) return h;
    }
    return undefined;
  }

  roomMessages(roomId: string): Message[] {
    return this.messages.get(roomId) ?? [];
  }

  addMessage(msg: Message): Message {
    const list = this.messages.get(msg.roomId) ?? [];
    list.push(msg);
    this.messages.set(msg.roomId, list);
    return msg;
  }

  newMessage(partial: Omit<Message, 'id' | 'createdAt' | 'streamState'> & Partial<Message>): Message {
    const msg: Message = {
      id: partial.id ?? uid('m'),
      roomId: partial.roomId,
      senderId: partial.senderId,
      content: partial.content,
      mentions: partial.mentions ?? [],
      parentId: partial.parentId ?? null,
      createdAt: partial.createdAt ?? nowStamp(),
      streamState: partial.streamState ?? 'final',
      state: partial.state,
      boundSessionId: partial.boundSessionId,
    };
    return this.addMessage(msg);
  }

  boundKey(roomId: string, harnessId: string): string {
    return `${roomId}|${harnessId}`;
  }

  getBound(roomId: string, harnessId: string): BoundSession | undefined {
    return this.bound.get(this.boundKey(roomId, harnessId));
  }

  ensureBound(roomId: string, harnessId: string): { session: BoundSession; created: boolean } {
    const key = this.boundKey(roomId, harnessId);
    const existing = this.bound.get(key);
    if (existing) return { session: existing, created: false };
    const session: BoundSession = {
      id: uid('bs'),
      roomId,
      harnessId,
      externalSessionRef: `sess_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: nowStamp(),
    };
    this.bound.set(key, session);
    return { session, created: true };
  }

  resetBound(roomId: string, harnessId: string): boolean {
    return this.bound.delete(this.boundKey(roomId, harnessId));
  }

  boundForRoom(roomId: string): BoundSession[] {
    return [...this.bound.values()].filter((b) => b.roomId === roomId);
  }

  enqueuePending(harnessId: string, payload: unknown): void {
    const q = this.pendingTasks.get(harnessId) ?? [];
    q.push(payload);
    this.pendingTasks.set(harnessId, q);
  }

  takePending(harnessId: string): unknown[] {
    const q = this.pendingTasks.get(harnessId) ?? [];
    this.pendingTasks.delete(harnessId);
    return q;
  }

  contextSnapshot(roomId: string, limit = 20): Message[] {
    return this.roomMessages(roomId).slice(-limit);
  }
}
