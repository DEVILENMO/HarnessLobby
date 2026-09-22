import WebSocket from 'ws';
import type {
  BoundSession,
  ClientEvent,
  Harness,
  Message,
  Room,
} from '@harness-lobby/protocol';

export type LobbySnapshot = {
  rooms: Room[];
  harnesses: Harness[];
  messages: Record<string, Message[]>;
  bound: BoundSession[];
  connected: boolean;
  lobbyId: string;
  clientId: string | null;
};

type Listener = () => void;

export class LobbyClient {
  private httpBase: string;
  private wsUrl: string;
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  state: LobbySnapshot = {
    rooms: [],
    harnesses: [],
    messages: {},
    bound: [],
    connected: false,
    lobbyId: 'lobby',
    clientId: null,
  };

  constructor(httpBase: string) {
    this.httpBase = httpBase.replace(/\/$/, '');
    const u = new URL(this.httpBase);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/';
    u.search = '';
    this.wsUrl = u.toString().replace(/\/$/, '');
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.httpBase}${path}`);
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.httpBase}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  async refresh(): Promise<void> {
    const health = await this.getJson<{ lobbyId: string }>('/health');
    const rooms = await this.getJson<Room[]>('/rooms');
    const harnesses = await this.getJson<Harness[]>('/harnesses');
    this.state.lobbyId = health.lobbyId;
    this.state.rooms = rooms;
    this.state.harnesses = harnesses;
    for (const r of rooms) {
      const msgs = await this.getJson<Message[]>(`/rooms/${r.id}/messages`);
      this.state.messages[r.id] = msgs;
      const bound = await this.getJson<BoundSession[]>(`/rooms/${r.id}/bound-sessions`);
      this.state.bound = [
        ...this.state.bound.filter((b) => b.roomId !== r.id),
        ...bound,
      ];
    }
    this.emit();
  }

  connectWs(): void {
    if (this.socket) return;
    this.socket = new WebSocket(`${this.wsUrl}`);
    this.socket.on('open', () => {
      this.state.connected = true;
      this.emit();
    });
    this.socket.on('close', () => {
      this.state.connected = false;
      this.socket = null;
      this.emit();
      setTimeout(() => this.connectWs(), 1000);
    });
    this.socket.on('message', (raw) => {
      let ev: ClientEvent;
      try {
        ev = JSON.parse(String(raw)) as ClientEvent;
      } catch {
        return;
      }
      switch (ev.type) {
        case 'hello':
          this.state.clientId = ev.clientId;
          break;
        case 'message.created':
        case 'message.updated': {
          const list = this.state.messages[ev.roomId] ?? [];
          const idx = list.findIndex((m) => m.id === ev.message.id);
          if (idx >= 0) list[idx] = ev.message;
          else list.push(ev.message);
          this.state.messages[ev.roomId] = list;
          break;
        }
        case 'bound_session': {
          const others = this.state.bound.filter((b) => b.id !== ev.session.id);
          this.state.bound = [...others, ev.session];
          break;
        }
        case 'harness.presence': {
          const h = this.state.harnesses.find((x) => x.id === ev.harnessId);
          if (h) h.status = ev.status;
          break;
        }
        default:
          break;
      }
      this.emit();
    });
  }

  async createRoom(topic: string): Promise<Room> {
    const room = await this.postJson<Room>('/rooms', { topic });
    this.state.rooms.push(room);
    this.state.messages[room.id] = this.state.messages[room.id] ?? [];
    this.emit();
    return room;
  }

  async sendMessage(roomId: string, content: string): Promise<void> {
    await this.postJson(`/rooms/${roomId}/messages`, {
      senderId: 'u_you',
      content,
    });
  }

  async resetSession(roomId: string, slug: string): Promise<boolean> {
    const res = await this.postJson<{ reset: boolean }>(
      `/rooms/${roomId}/reset-session`,
      { slug }
    );
    this.state.bound = this.state.bound.filter(
      (b) => !(b.roomId === roomId && b.harnessId.endsWith(slug))
    );
    await this.refresh();
    return res.reset;
  }

  boundForRoom(roomId: string): BoundSession[] {
    return this.state.bound.filter((b) => b.roomId === roomId);
  }
}
