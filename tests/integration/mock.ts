/** Pretend upstreams for the room server's integration test, in one small Node HTTP server:
 *  - Supabase's study_room_access RPC (fake tokens map to fake people),
 *  - the study-rooms function (save, close, roster; checks the shared secret),
 *  - Cloudflare Realtime's SFU API (sessions and tracks, checking the app secret),
 *  - Cloudflare TURN (credentials, including the port 53 URLs the server must drop). */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ROOM, type EditMode, type Role } from '../../shared/rooms';

export interface MockMember {
  token: string;
  userId: string;
  name: string;
  role: Role;
  state: 'in' | 'waiting' | 'removed';
  canEdit: boolean;
}

export interface MockRoom {
  id: string;
  live: boolean;
  maxPeople: number;
  endsAt: string | null;
  editMode: EditMode;
  members: MockMember[];
}

export interface SfuCall {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

interface SfuTrack {
  location: 'local' | 'remote';
  trackName: string;
  pubSession?: string;
  closed: boolean;
}

export class Mock {
  readonly rooms = new Map<string, MockRoom>();
  readonly saves: Record<string, unknown>[] = [];
  readonly closes: string[] = [];
  /** Saves and closes in the order they came: `save:<roomId>`, `close:<roomId>`. */
  readonly events: string[] = [];
  readonly sfuCalls: SfuCall[] = [];
  /** Every successful access check, so tests can see the token was really sent. */
  accessCalls = 0;
  rosterCalls = 0;
  private server: Server | null = null;
  private readonly sessions = new Map<string, Map<string, SfuTrack>>();
  private nextMid = 10;
  url = '';

  constructor(
    readonly anonKey: string,
    readonly roomSecret: string,
    readonly appId: string,
    readonly appSecret: string,
    readonly turnKeyId: string,
    readonly turnToken: string,
  ) {}

  addRoom(room: MockRoom): MockRoom {
    this.rooms.set(room.id, room);
    return room;
  }

  member(token: string): { room: MockRoom; member: MockMember } | null {
    for (const room of this.rooms.values()) {
      const member = room.members.find((m) => m.token === token);
      if (member) return { room, member };
    }
    return null;
  }

  /** Force closes the SFU was asked for: session → mids. */
  forceCloses(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const c of this.sfuCalls) {
      if (c.path.endsWith('/tracks/close') && c.body?.force === true) {
        const session = c.path.split('/sessions/')[1].split('/')[0];
        const mids = (c.body.tracks as { mid: string }[]).map((t) => t.mid);
        out.set(session, [...(out.get(session) ?? []), ...mids]);
      }
    }
    return out;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((e) => {
        console.error('mock', e);
        send(res, 500, { error: 'mock failed' });
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://mock');
    const raw = await read(req);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;

    if (url.pathname === '/rest/v1/rpc/study_room_access' && req.method === 'POST') return this.access(req, res, body);
    if (url.pathname === '/functions/v1/study-rooms' && req.method === 'POST') return this.service(req, res, body);
    if (url.pathname.startsWith('/sfu/v1/apps/')) return this.sfu(req, res, url.pathname, body);
    if (url.pathname.startsWith('/turn/v1/turn/keys/')) return this.turn(req, res, url.pathname, body);
    send(res, 404, { error: 'mock: no such route' });
  }

  private access(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown> | undefined): void {
    if (req.headers.apikey !== this.anonKey) return send(res, 401, { message: 'No API key found in request' });
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const found = this.member(token);
    if (!found && !token.startsWith('outsider')) return send(res, 401, { code: 'PGRST303', message: 'JWT expired' });
    const room = this.rooms.get(String(body?.p_room));
    if (!room || !found || found.room !== room) return send(res, 400, { code: 'P0001', message: 'not a member' });
    this.accessCalls++;
    const m = found.member;
    const host = room.members.find((x) => x.role === 'host');
    send(res, 200, {
      room_id: room.id,
      user_id: m.userId,
      name: m.name,
      role: m.role,
      state: m.state,
      can_edit: m.state === 'in' && (m.role !== 'member' || room.editMode === 'everyone' || m.canEdit),
      live: room.live,
      max_people: room.maxPeople,
      ends_at: room.endsAt,
      assignment_id: '00000000-0000-4000-8000-0000000000aa',
      host_id: host?.userId ?? m.userId,
      title: 'Mock room',
      class_room: false,
      edit_mode: room.editMode,
    });
  }

  private service(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown> | undefined): void {
    if (req.headers['x-room-secret'] !== this.roomSecret) return send(res, 401, { error: 'not allowed' });
    const room = this.rooms.get(String(body?.room_id));
    if (!room) return send(res, 404, { error: 'no such room' });
    switch (body?.action) {
      case 'save':
        this.saves.push(body);
        this.events.push(`save:${room.id}`);
        return send(res, 200, { ok: true });
      case 'close':
        this.closes.push(room.id);
        this.events.push(`close:${room.id}`);
        room.live = false;
        return send(res, 200, { ok: true });
      case 'roster':
        this.rosterCalls++;
        return send(res, 200, {
          live: room.live,
          ends_at: room.endsAt,
          max_people: room.maxPeople,
          edit_mode: room.editMode,
          assignment_id: '00000000-0000-4000-8000-0000000000aa',
          host_id: room.members.find((x) => x.role === 'host')?.userId,
          members: room.members.map((m) => ({
            user_id: m.userId,
            name: m.name,
            role: m.role,
            state: m.state,
            can_edit: m.state === 'in' && (m.role !== 'member' || room.editMode === 'everyone' || m.canEdit),
          })),
        });
      default:
        return send(res, 400, { error: 'unknown action' });
    }
  }

  private sfu(req: IncomingMessage, res: ServerResponse, path: string, body: Record<string, unknown> | undefined): void {
    if (req.headers.authorization !== `Bearer ${this.appSecret}`) return send(res, 401, { errorCode: 'unauthorized' });
    const m = /^\/sfu\/v1\/apps\/([^/]+)\/sessions\/(new|[^/]+\/(tracks\/new|tracks\/update|tracks\/close|renegotiate))$/.exec(path);
    if (!m || m[1] !== this.appId) return send(res, 404, { errorCode: 'not_found' });
    this.sfuCalls.push({ method: req.method ?? '', path, body });
    if (m[2] === 'new') {
      const sessionId = Math.random().toString(16).slice(2).padEnd(16, '0') + Math.random().toString(16).slice(2).padEnd(16, '0');
      this.sessions.set(sessionId, new Map());
      return send(res, 201, { sessionId });
    }
    const sessionId = m[2].split('/')[0];
    const tracks = this.sessions.get(sessionId);
    if (!tracks) return send(res, 404, { errorCode: 'session_not_found', errorDescription: 'no such session' });
    const op = m[3];
    if (op === 'tracks/new') {
      const list = (body?.tracks ?? []) as Record<string, string>[];
      if (body?.sessionDescription) {
        const out = list.map((t) => {
          tracks.set(t.mid, { location: 'local', trackName: t.trackName, closed: false });
          return { trackName: t.trackName, mid: t.mid };
        });
        return send(res, 200, { requiresImmediateRenegotiation: false, sessionDescription: { type: 'answer', sdp: 'v=0\r\nmock answer\r\n' }, tracks: out });
      }
      const out = list.map((t) => {
        const pub = [...(this.sessions.get(t.sessionId)?.values() ?? [])].find((x) => x.location === 'local' && x.trackName === t.trackName && !x.closed);
        if (!pub) return { sessionId: t.sessionId, trackName: t.trackName, errorCode: 'not_found', errorDescription: 'no such track' };
        const mid = String(this.nextMid++);
        tracks.set(mid, { location: 'remote', trackName: t.trackName, pubSession: t.sessionId, closed: false });
        return { sessionId: t.sessionId, trackName: t.trackName, mid };
      });
      return send(res, 200, { requiresImmediateRenegotiation: true, sessionDescription: { type: 'offer', sdp: 'v=0\r\nmock offer\r\n' }, tracks: out });
    }
    if (op === 'renegotiate') return send(res, 200, {});
    if (op === 'tracks/update') {
      const list = (body?.tracks ?? []) as Record<string, string>[];
      return send(res, 200, { requiresImmediateRenegotiation: false, tracks: list.map((t) => (tracks.has(t.mid) ? { mid: t.mid, sessionId: t.sessionId, trackName: t.trackName } : { mid: t.mid, errorCode: 'not_found' })) });
    }
    if (op === 'tracks/close') {
      const list = (body?.tracks ?? []) as { mid: string }[];
      const out = list.map((t) => {
        const track = tracks.get(t.mid);
        if (!track || track.closed) return { mid: t.mid, errorCode: 'close_track_error', errorDescription: "Track doesn't exist or was already closed" };
        track.closed = true;
        return { mid: t.mid };
      });
      return send(res, 200, { requiresImmediateRenegotiation: false, tracks: out, ...(body?.force ? {} : { sessionDescription: { type: 'answer', sdp: 'v=0\r\nmock close answer\r\n' } }) });
    }
    send(res, 404, { errorCode: 'not_found' });
  }

  private turn(req: IncomingMessage, res: ServerResponse, path: string, body: Record<string, unknown> | undefined): void {
    if (req.headers.authorization !== `Bearer ${this.turnToken}`) return send(res, 401, { error: 'unauthorized' });
    if (path !== `/turn/v1/turn/keys/${this.turnKeyId}/credentials/generate-ice-servers` || body?.ttl !== ROOM.turnTtlSeconds) return send(res, 400, { error: 'bad request' });
    send(res, 201, {
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turn:turn.cloudflare.com:53?transport=udp',
            'turn:turn.cloudflare.com:3478?transport=tcp',
            'turn:turn.cloudflare.com:80?transport=tcp',
            'turns:turn.cloudflare.com:5349?transport=tcp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'mock-user',
          credential: 'mock-credential',
        },
      ],
    });
  }
}

function read(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
