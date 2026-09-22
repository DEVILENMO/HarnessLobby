import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  type ClientEvent,
  type LobbyToPlugin,
  type Message,
  type PluginToLobby,
  parseMentions,
} from '@harness-lobby/protocol';
import { Store } from './store.js';

type PluginSocket = WebSocket;

interface PluginConn {
  socket: PluginSocket;
  harnessId: string;
}

export interface LobbyServerOptions {
  port: number;
  host?: string;
}

export class LobbyServer {
  readonly store = new Store();
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private plugins = new Map<string, PluginConn>();
  private clients = new Set<PluginSocket>();
  private port: number;
  private host: string;

  constructor(opts: LobbyServerOptions) {
    this.port = opts.port;
    this.host = opts.host ?? '127.0.0.1';
    this.httpServer = http.createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (socket, req) => {
      const url = new URL(req.url ?? '/', `http://${this.host}`);
      if (url.searchParams.get('role') === 'plugin') {
        this.handlePluginSocket(socket);
      } else {
        this.handleClientSocket(socket);
      }
    });
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.port, this.host, () => resolve());
    });
  }

  async close(): Promise<void> {
    for (const conn of this.plugins.values()) {
      conn.socket.close();
    }
    for (const c of this.clients) c.close();
    await new Promise<void>((resolve) => {
      this.wss.close(() => {
        this.httpServer.close(() => resolve());
      });
    });
  }

  get wsUrl(): string {
    return `ws://${this.host}:${this.port}`;
  }

  private send(socket: WebSocket, msg: LobbyToPlugin | ClientEvent): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  private broadcastClient(event: ClientEvent): void {
    for (const c of this.clients) this.send(c, event);
  }

  private handleClientSocket(socket: WebSocket): void {
    this.clients.add(socket);
    const clientId = `cli_${Math.random().toString(36).slice(2, 8)}`;
    this.send(socket, { type: 'hello', clientId });
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  private handlePluginSocket(socket: WebSocket): void {
    let harnessId: string | null = null;

    socket.on('message', (raw) => {
      let msg: PluginToLobby;
      try {
        msg = JSON.parse(String(raw)) as PluginToLobby;
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        this.send(socket, { type: 'pong' });
        return;
      }

      if (msg.type === 'register_lobby') {
        const harness = this.store.findHarnessByToken(msg.token);
        if (!harness) {
          this.send(socket, { type: 'register_nack', error: 'invalid token' });
          socket.close(4001, 'invalid token');
          return;
        }
        harnessId = harness.id;
        harness.status = 'online';
        harness.slug = msg.profile.slug || harness.slug;
        harness.displayName = msg.profile.displayName || harness.displayName;
        harness.capabilities = msg.profile.capabilities?.length
          ? msg.profile.capabilities
          : harness.capabilities;
        harness.assignedRooms = [...this.store.rooms.values()]
          .filter((r) => r.memberIds.includes(harness.id))
          .map((r) => r.id);

        this.store.ensureMemberFromHarness(harness, {
          ...msg.profile,
          slug: harness.slug,
          displayName: harness.displayName,
          capabilities: harness.capabilities,
          protocol: 'mode-a',
        });

        this.plugins.set(harness.id, { socket, harnessId: harness.id });
        this.send(socket, {
          type: 'register_ack',
          lobbyId: this.store.lobbyId,
          wsUrl: this.wsUrl,
          assignedRooms: harness.assignedRooms,
          harnessId: harness.id,
          status: 'online',
        });
        this.broadcastClient({
          type: 'harness.presence',
          harnessId: harness.id,
          status: 'online',
        });

        const pending = this.store.takePending(harness.id) as LobbyToPlugin[];
        for (const p of pending) this.send(socket, p);
        return;
      }

      if (!harnessId) {
        this.send(socket, { type: 'register_nack', error: 'register first' });
        return;
      }

      switch (msg.type) {
        case 'session.bind': {
          const existing = this.store.getBound(msg.roomId, harnessId);
          if (existing) {
            existing.externalSessionRef = msg.externalSessionRef;
          } else {
            const { session } = this.store.ensureBound(msg.roomId, harnessId);
            session.externalSessionRef = msg.externalSessionRef;
          }
          const session = this.store.getBound(msg.roomId, harnessId)!;
          this.broadcastClient({ type: 'bound_session', roomId: msg.roomId, session });
          break;
        }
        case 'message.stream': {
          this.applyStream(msg.roomId, msg.messageId, msg.delta, harnessId);
          break;
        }
        case 'message.final': {
          this.applyFinal(msg.roomId, msg.messageId, msg.content, harnessId);
          break;
        }
        case 'status.update': {
          this.applyStatus(msg.roomId, msg.state, harnessId);
          break;
        }
        default:
          break;
      }
    });

    socket.on('close', () => {
      if (!harnessId) return;
      this.plugins.delete(harnessId);
      const h = this.store.harnesses.get(harnessId);
      if (h) {
        h.status = 'offline';
        this.broadcastClient({
          type: 'harness.presence',
          harnessId,
          status: 'offline',
        });
      }
    });
  }

  private applyStream(roomId: string, messageId: string, delta: string, harnessId: string): void {
    const list = this.store.roomMessages(roomId);
    let msg = list.find((m) => m.id === messageId);
    if (!msg) {
      msg = this.store.newMessage({
        roomId,
        senderId: harnessId,
        content: delta,
        mentions: [],
        streamState: 'streaming',
        state: 'working',
      });
    } else {
      msg.content += delta;
      msg.streamState = 'streaming';
    }
    this.broadcastClient({ type: 'message.updated', roomId, message: msg });
  }

  private applyFinal(roomId: string, messageId: string, content: string, harnessId: string): void {
    const list = this.store.roomMessages(roomId);
    let msg = list.find((m) => m.id === messageId);
    if (!msg) {
      msg = this.store.newMessage({
        roomId,
        senderId: harnessId,
        content,
        mentions: [],
        streamState: 'final',
        state: 'idle',
      });
    } else {
      msg.content = content;
      msg.streamState = 'final';
      msg.state = 'idle';
    }
    const h = this.store.harnesses.get(harnessId);
    if (h && h.status === 'working') h.status = 'online';
    this.broadcastClient({ type: 'message.updated', roomId, message: msg });
    this.broadcastClient({
      type: 'harness.presence',
      harnessId,
      status: h?.status ?? 'online',
    });
  }

  private applyStatus(roomId: string, state: 'thinking' | 'working' | 'idle', harnessId: string): void {
    const h = this.store.harnesses.get(harnessId);
    if (h) {
      h.status = state === 'idle' ? 'online' : 'working';
      this.broadcastClient({
        type: 'harness.presence',
        harnessId,
        status: h.status,
      });
    }
    const list = this.store.roomMessages(roomId);
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i];
      if (m.senderId === harnessId && m.streamState === 'streaming') {
        m.state = state;
        this.broadcastClient({ type: 'message.updated', roomId, message: m });
        break;
      }
    }
  }

  postUserMessage(roomId: string, senderId: string, content: string): Message {
    const harnessSlugs = [...this.store.harnesses.values()].map((h) => h.slug);
    const mentions = parseMentions(content, harnessSlugs);
    const msg = this.store.newMessage({
      roomId,
      senderId,
      content,
      mentions,
      streamState: 'final',
    });
    this.broadcastClient({ type: 'message.created', roomId, message: msg });

    const room = this.store.rooms.get(roomId);
    if (!room) return msg;

    for (const slug of mentions) {
      const harness = this.store.findHarnessBySlug(slug);
      if (!harness) continue;
      if (!room.memberIds.includes(harness.id)) {
        room.memberIds.push(harness.id);
      }

      const { session, created } = this.store.ensureBound(roomId, harness.id);
      if (created) {
        this.broadcastClient({ type: 'bound_session', roomId, session });
      }

      const replyShell = this.store.newMessage({
        roomId,
        senderId: harness.id,
        content: '',
        mentions: [],
        streamState: 'streaming',
        state: 'thinking',
        boundSessionId: session.id,
      });
      this.broadcastClient({ type: 'message.created', roomId, message: replyShell });

      const taskPayload: LobbyToPlugin = {
        type: 'task.new',
        roomId,
        messageId: replyShell.id,
        mentions: [slug],
        taskText: content,
        contextSnapshot: this.store.contextSnapshot(roomId),
      };

      const conn = this.plugins.get(harness.id);
      if (conn && conn.socket.readyState === conn.socket.OPEN) {
        this.send(conn.socket, taskPayload);
        harness.status = 'working';
        this.broadcastClient({
          type: 'harness.presence',
          harnessId: harness.id,
          status: 'working',
        });
      } else {
        this.store.enqueuePending(harness.id, taskPayload);
        this.broadcastClient({
          type: 'message.updated',
          roomId,
          message: {
            ...replyShell,
            content: `(挂起) plugin 离线，任务已入队，重连后补投 · ${slug}`,
            streamState: 'final',
            state: 'idle',
          },
        });
      }
    }

    return msg;
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${this.host}${req.url ?? '/'}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    const json = (code: number, body: unknown): void => {
      const data = JSON.stringify(body);
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      res.end(data);
    };

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    try {
      if (method === 'GET' && path === '/health') {
        json(200, {
          ok: true,
          lobbyId: this.store.lobbyId,
          wsUrl: this.wsUrl,
          plugins: [...this.plugins.keys()],
        });
        return;
      }

      if (method === 'GET' && path === '/harnesses') {
        json(200, [...this.store.harnesses.values()]);
        return;
      }

      if (method === 'GET' && path === '/rooms') {
        json(200, [...this.store.rooms.values()]);
        return;
      }

      if (method === 'POST' && path === '/rooms') {
        const body = (await readJson(req)) as { topic?: string };
        const topic = (body.topic ?? '').trim();
        if (!topic) return json(400, { error: 'topic required' });
        const room = this.store.createRoom(topic, ['u_you']);
        return json(200, room);
      }

      const roomMsgs = path.match(/^\/rooms\/([^/]+)\/messages$/);
      if (roomMsgs) {
        const roomId = roomMsgs[1];
        if (method === 'GET') {
          const since = url.searchParams.get('since');
          let msgs = this.store.roomMessages(roomId);
          if (since) {
            const idx = msgs.findIndex((m) => m.id === since);
            msgs = idx >= 0 ? msgs.slice(idx + 1) : msgs;
          }
          return json(200, msgs);
        }
        if (method === 'POST') {
          const body = (await readJson(req)) as {
            senderId?: string;
            content?: string;
          };
          const content = (body.content ?? '').trim();
          if (!content) return json(400, { error: 'content required' });
          const msg = this.postUserMessage(
            roomId,
            body.senderId ?? 'u_you',
            content
          );
          return json(200, { messageId: msg.id });
        }
      }

      const bound = path.match(/^\/rooms\/([^/]+)\/bound-sessions$/);
      if (bound && method === 'GET') {
        return json(200, this.store.boundForRoom(bound[1]));
      }

      const reset = path.match(/^\/rooms\/([^/]+)\/reset-session$/);
      if (reset && method === 'POST') {
        const body = (await readJson(req)) as { harnessId?: string; slug?: string };
        const harness = body.harnessId
          ? this.store.harnesses.get(body.harnessId)
          : body.slug
            ? this.store.findHarnessBySlug(body.slug)
            : undefined;
        if (!harness) return json(404, { error: 'harness not found' });
        const ok = this.store.resetBound(reset[1], harness.id);
        return json(200, { reset: ok });
      }

      json(404, { error: 'not found' });
    } catch (err) {
      json(500, { error: String(err) });
    }
  }
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}
