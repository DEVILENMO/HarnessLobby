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
    // ws may re-emit server bind errors; keep them from becoming unhandled
    this.wss.on('error', () => undefined);
    this.httpServer.on('error', () => undefined);
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
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const onListening = (): void => {
        cleanup();
        resolve();
      };
      const cleanup = (): void => {
        this.httpServer.removeListener('error', onError);
        this.httpServer.removeListener('listening', onListening);
      };
      this.httpServer.on('error', onError);
      this.httpServer.on('listening', onListening);
      this.httpServer.listen(this.port, this.host);
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
        // 连接即注册：不认领固定 slot，自动得到 harness_name-computer_name
        const harness = this.store.registerInstance({
          ...msg.profile,
          computerName: msg.profile?.computerName,
          slug: msg.profile?.slug || 'harness',
          displayName: msg.profile?.displayName || msg.profile?.slug || 'Harness',
          capabilities: msg.profile?.capabilities ?? [],
          protocol: 'mode-a',
        });
        harnessId = harness.id;
        harness.status = 'online';
        harness.assignedRooms = [...this.store.rooms.values()]
          .filter((r) => r.memberIds.includes(harness.id) || r.ownerId === null)
          .map((r) => r.id);
        // 公共大厅默认挂上
        for (const r of this.store.rooms.values()) {
          if (r.ownerId === null && !r.memberIds.includes(harness.id)) {
            r.memberIds.push(harness.id);
          }
        }

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
      // 同一实例被更新连接接管（如 keepalive + 会话先后注册）时，旧连接断开不降级 presence
      const current = this.plugins.get(harnessId);
      if (current && current.socket !== socket) return;
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
    if (msg && msg.streamState === 'final') {
      // final is terminal — ignore late deltas
      return;
    }
    if (!msg) {
      msg = this.store.newMessage({
        id: messageId,
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
    if (msg && msg.streamState === 'final') {
      // idempotent final
      return;
    }
    if (!msg) {
      msg = this.store.newMessage({
        id: messageId,
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
    const instances = [...this.store.harnesses.values()];
    const mentions = parseMentions(content, instances.map((h) => h.slug));
    // 允许 @mimo-code 命中唯一实例 mimo-code-LAPTOP-xxx：
    // base 取注册时的产品名；主机名可能自带连字符，不能按 '-' 切尾段推导
    const bases = new Set(instances.map((h) => h.baseSlug ?? h.slug));
    for (const base of bases) {
      const re = new RegExp(`@${base}(?![A-Za-z0-9-])`, 'gi');
      if (!re.test(content)) continue;
      const twins = instances.filter((x) => (x.baseSlug ?? x.slug) === base);
      if (twins.length === 1 && !mentions.includes(twins[0].slug)) {
        mentions.push(twins[0].slug);
      }
    }
    const msg = this.store.newMessage({
      roomId,
      senderId,
      content,
      mentions,
      streamState: 'final',
    });
    this.broadcastClient({ type: 'message.created', roomId, message: msg });
    for (const conn of this.plugins.values()) {
      if (conn.socket.readyState === conn.socket.OPEN) {
        this.send(conn.socket, {
          type: 'room.message',
          roomId,
          messageId: msg.id,
          content: msg.content,
          senderId: msg.senderId,
        });
      }
    }

    const room = this.store.rooms.get(roomId);
    if (!room) return msg;

    let targets: import('@harness-lobby/protocol').Harness[] = [];
    if (mentions.length) {
      for (const slug of mentions) {
        const h0 = this.store.findHarnessBySlug(slug);
        if (h0) targets.push(h0);
      }
    } else {
      targets = [...this.store.harnesses.values()].filter((h) =>
        room.memberIds.includes(h.id) || room.ownerId === null
      );
    }
    const isBroadcast = mentions.length === 0 && targets.length > 0;
    for (const harness of targets) {
      void 0;
      
      
      // @harness：owner 或公共房可拉入成员
      if (!room.memberIds.includes(harness.id)) {
        const canInvite = room.ownerId === null || room.ownerId === senderId;
        if (canInvite) room.memberIds.push(harness.id);
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
        mentions: isBroadcast ? ['*'] : [harness.slug],
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
        replyShell.content = `(挂起) plugin 离线，任务已入队，重连后补投 · ${harness.slug}`;
        replyShell.streamState = 'final';
        replyShell.state = 'idle';
        this.broadcastClient({ type: 'message.updated', roomId, message: replyShell });
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
        const userId = url.searchParams.get('userId') ?? 'u_you';
        json(200, this.store.roomsForUser(userId));
        return;
      }

      if (method === 'POST' && path === '/rooms') {
        const body = (await readJson(req)) as { topic?: string; ownerId?: string };
        const topic = (body.topic ?? '').trim();
        if (!topic) return json(400, { error: 'topic required' });
        const ownerId = body.ownerId ?? 'u_you';
        const room = this.store.createRoom(topic, [ownerId], ownerId);
        return json(200, room);
      }

      const invite = path.match(/^\/rooms\/([^/]+)\/invite$/);
      if (invite && method === 'POST') {
        const roomId = invite[1];
        const room = this.store.rooms.get(roomId);
        const body = (await readJson(req)) as {
          userId?: string;
          slug?: string;
          harnessId?: string;
        };
        const userId = body.userId ?? 'u_you';
        if (!room) return json(404, { error: 'room not found' });
        if (room.ownerId !== null && room.ownerId !== userId) {
          return json(403, { error: '仅创建者可邀请 harness 进入工作间' });
        }
        const harness = body.harnessId
          ? this.store.harnesses.get(body.harnessId)
          : body.slug
            ? this.store.findHarnessBySlug(body.slug)
            : undefined;
        if (!harness) return json(404, { error: 'harness not found' });
        if (!room.memberIds.includes(harness.id)) {
          room.memberIds.push(harness.id);
        }
        return json(200, room);
      }

      const roomMsgs = path.match(/^\/rooms\/([^/]+)\/messages$/);
      if (roomMsgs) {
        const roomId = roomMsgs[1];
        const room = this.store.rooms.get(roomId);
        const userId = url.searchParams.get('userId') ?? 'u_you';
        if (room && room.ownerId !== null && room.ownerId !== userId) {
          return json(403, { error: '无权访问该房间（私有工作间仅创建者可进）' });
        }
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
          const sender = body.senderId ?? 'u_you';
          if (room && sender.startsWith('u_') && !this.store.canAccessRoom(room, sender, false)) {
            return json(403, { error: '无权在该房间发言' });
          }
          const msg = this.postUserMessage(roomId, sender, content);
          return json(200, { messageId: msg.id });
        }
      }

      const bound = path.match(/^\/rooms\/([^/]+)\/bound-sessions$/);
      if (bound && method === 'GET') {
        const room = this.store.rooms.get(bound[1]);
        const userId = url.searchParams.get('userId') ?? 'u_you';
        if (room && room.ownerId !== null && room.ownerId !== userId) {
          return json(403, { error: '无权访问' });
        }
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
