/** A pretend room server for the end-to-end tests (route interception for its HTTP API, and a mocked
 * WebSocket for the room socket), speaking docs/rooms.md's protocol: tickets, hello, people, chat,
 * hands, the Chip relay, permissions re-read from the pretend database on {t: "perm"}, ending, and
 * real Yjs sync over y-protocols (the room's own Y.Doc lives here, so seeding and edits are real).
 * Other people in the room are played by the test. */
import type { Page, WebSocketRoute } from '@playwright/test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { CLOSE, FRAME, YDOC, type ChatMessage, type ChipEntry, type ClientMessage, type Person, type Publication, type ServerMessage } from '../shared/rooms';
import type { MockRooms, MRoom } from './mock-rooms';

const FROM_CLIENT = 'client';

interface Conn {
  ws: WebSocketRoute;
  userId: string;
  readonlyTold: boolean;
  closed: boolean;
}

export interface Peer {
  userId: string;
  name: string;
  role?: Person['role'];
  canEdit?: boolean;
}

export class MockRoomServer {
  doc = new Y.Doc();
  conns: Conn[] = [];
  /** Every JSON message a screen sent, in order. */
  received: ClientMessage[] = [];
  /** When each chip-chunk came. */
  chunkTimes: number[] = [];
  /** Every HTTP call, as "METHOD /path". */
  calls: string[] = [];
  peers: Peer[] = [];
  pubs: Publication[] = [];
  chat: ChatMessage[] = [];
  chip: ChipEntry[] = [];
  hands: string[] = [];
  /** What /turn answers: 'off' is 503 not_configured (the room server without video set up). */
  turn: 'off' | 'on' = 'off';
  /** The room is full for anyone new. */
  full = false;
  /** The room server can't reach the database (tickets fail; the screen keeps trying). */
  down = false;
  /** Seeding: ask the first editor (as the real server does). */
  askToSeed = true;
  private tickets = new Set<string>();
  private nextTicket = 1;
  private wasSeeded = false;

  constructor(
    private rooms: MockRooms,
    private me: () => { id: string; name: string },
  ) {}

  room(): MRoom {
    return this.rooms.rooms[this.rooms.rooms.length - 1];
  }

  roomById(id: string): MRoom | undefined {
    return this.rooms.rooms.find((r) => r.id === id);
  }

  seeded(): boolean {
    return this.doc.getMap(YDOC.room).get('seeded') === true;
  }

  // ── HTTP ──────────────────────────────────────────────────────────────

  async install(page: Page) {
    await page.route(/\/api\/rooms(\/|\?|$)/, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      this.calls.push(`${req.method()} ${url.pathname}`);
      const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      const m = /^\/api\/rooms\/([0-9a-f-]{36})\/(ticket|turn|rtc\/[a-z]+)$/.exec(url.pathname);
      if (!m) return json(404, { error: 'not_found' });
      const r = this.roomById(m[1]);
      if (!r) return json(404, { error: 'not_found' });
      if (!this.rooms.live(r)) return json(410, { error: 'ended' });
      const mem = this.rooms.memberOf(r, this.me().id);
      if (!mem || mem.state !== 'in') return json(403, { error: 'not_in_room', ...(mem ? { state: mem.state } : {}) });
      if (m[2] === 'ticket') {
        if (this.down) return json(502, { error: 'upstream' });
        if (this.full) return json(409, { error: 'room_full' });
        const t = `ticket-${this.nextTicket++}`;
        this.tickets.add(t);
        return json(200, { ticket: t });
      }
      if (m[2] === 'turn') return this.turn === 'off' ? json(503, { error: 'not_configured', detail: 'TURN is not set up yet' }) : json(200, { iceServers: [] });
      return json(503, { error: 'not_configured', detail: 'the SFU is not set up yet' });
    });
    await page.routeWebSocket(/\/api\/rooms\/[0-9a-f-]{36}\/ws/, (ws) => this.connect(ws));
  }

  // ── The socket ────────────────────────────────────────────────────────

  private people(): Person[] {
    const r = this.room();
    const meId = this.me().id;
    const here = new Set([...this.conns.filter((c) => !c.closed).map((c) => c.userId), ...this.peers.map((p) => p.userId)]);
    const list: Person[] = [];
    for (const m of r.members) {
      if (m.state !== 'in' || !here.has(m.user_id)) continue;
      list.push({ userId: m.user_id, name: m.name, role: m.role, canEdit: this.rooms.canEdit(r, m), hand: this.hands.includes(m.user_id), connected: true });
    }
    for (const p of this.peers) {
      if (list.some((x) => x.userId === p.userId)) continue;
      list.push({ userId: p.userId, name: p.name, role: p.role ?? 'member', canEdit: p.canEdit ?? r.edit_mode === 'everyone', hand: this.hands.includes(p.userId), connected: true });
    }
    void meId;
    return list;
  }

  private you(userId: string) {
    const r = this.room();
    const m = this.rooms.memberOf(r, userId)!;
    return { userId, name: m.name, role: m.role, canEdit: this.rooms.canEdit(r, m) };
  }

  private connect(ws: WebSocketRoute) {
    const ticket = new URL(ws.url()).searchParams.get('ticket') ?? '';
    if (!this.tickets.delete(ticket)) {
      ws.send(JSON.stringify({ t: 'error', code: 'bad_ticket' }));
      void ws.close({ code: CLOSE.badTicket, reason: 'bad_ticket' });
      return;
    }
    const r = this.room();
    if (!this.rooms.live(r)) {
      ws.send(JSON.stringify({ t: 'error', code: 'ended' }));
      void ws.close({ code: CLOSE.ended, reason: 'ended' });
      return;
    }
    const conn: Conn = { ws, userId: this.me().id, readonlyTold: false, closed: false };
    this.conns.push(conn);
    ws.onMessage((message) => this.onMessage(conn, message));
    ws.onClose(() => {
      conn.closed = true;
      this.hands = this.hands.filter((h) => h !== conn.userId);
    });
    const you = this.you(conn.userId);
    this.sendTo(conn, {
      t: 'hello',
      you,
      people: this.people(),
      publications: this.pubs,
      chat: this.chat,
      chip: this.chip,
      hands: this.hands,
      endsAt: r.ends_at ? Date.parse(r.ends_at) : null,
      editMode: r.edit_mode,
      seeded: this.seeded(),
    });
    if (you.canEdit) this.sendBytes(conn, this.step1());
    if (r.ends_at && Date.parse(r.ends_at) - Date.now() <= 5 * 60_000) this.sendTo(conn, { t: 'ending', at: Date.parse(r.ends_at) });
    if (!this.seeded() && you.canEdit && this.askToSeed) setTimeout(() => !conn.closed && this.sendTo(conn, { t: 'seed' }), 50);
  }

  private step1(): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, FRAME.sync);
    syncProtocol.writeSyncStep1(enc, this.doc);
    return encoding.toUint8Array(enc);
  }

  private onMessage(conn: Conn, message: string | Buffer) {
    if (typeof message === 'string') {
      if (message === 'ping') return conn.ws.send('pong');
      const m = JSON.parse(message) as ClientMessage;
      this.received.push(m);
      this.onJson(conn, m);
      return;
    }
    const bytes = new Uint8Array(message);
    const d = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(d);
    if (type !== FRAME.sync) return; // awareness: there's no one real to pass it to
    const kind = bytes[1];
    if (kind === syncProtocol.messageYjsSyncStep1) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, FRAME.sync);
      syncProtocol.readSyncMessage(d, enc, this.doc, FROM_CLIENT);
      this.sendBytes(conn, encoding.toUint8Array(enc));
      return;
    }
    if (!this.you(conn.userId).canEdit) {
      // A viewer's change is dropped, and they're told once.
      if (!conn.readonlyTold) {
        conn.readonlyTold = true;
        this.sendTo(conn, { t: 'readonly' });
      }
      return;
    }
    const before = this.wasSeeded;
    syncProtocol.readSyncMessage(d, encoding.createEncoder(), this.doc, FROM_CLIENT);
    if (this.seeded()) this.wasSeeded = true;
    void before;
  }

  private onJson(conn: Conn, m: ClientMessage) {
    const r = this.room();
    const from = { userId: conn.userId, name: this.you(conn.userId).name };
    switch (m.t) {
      case 'chat': {
        const msg: ChatMessage = { id: `c${this.chat.length + 1}`, from, text: m.text.trim(), at: Date.now() };
        this.chat.push(msg);
        return this.broadcast({ t: 'chat', ...msg });
      }
      case 'hand':
        this.hands = m.up ? [...new Set([...this.hands, conn.userId])] : this.hands.filter((h) => h !== conn.userId);
        return this.broadcast({ t: 'hand', userId: conn.userId, up: m.up });
      case 'perm':
        return this.reread();
      case 'mute-all':
        return;
      case 'end':
        if (this.rooms.live(r)) return this.sendTo(conn, { t: 'error', code: 'still_live' });
        return this.end('host');
      case 'seeded':
        if (!this.seeded()) this.sendTo(conn, { t: 'error', code: 'not_seeded' });
        return;
      case 'chip-ask': {
        const e: ChipEntry = { id: m.id, from, question: m.text, answer: '', done: false, at: Date.now() };
        this.chip.push(e);
        return this.broadcast({ t: 'chip', ...e });
      }
      case 'chip-chunk':
      case 'chip-done': {
        const e = this.chip.find((c) => c.id === m.id);
        if (!e || e.from.userId !== conn.userId) return this.sendTo(conn, { t: 'error', code: 'not_yours' });
        if (m.t === 'chip-chunk') this.chunkTimes.push(Date.now());
        e.answer = m.text;
        e.done = m.t === 'chip-done';
        return this.broadcast({ t: 'chip', ...e });
      }
    }
  }

  /** Reads the roster again (after {t: "perm"}): what each screen may do, who's out. */
  reread() {
    const r = this.room();
    if (!this.rooms.live(r)) return this.end(r.ends_at && Date.parse(r.ends_at) <= Date.now() ? 'time' : 'host');
    for (const c of this.conns) {
      if (c.closed) continue;
      const m = this.rooms.memberOf(r, c.userId);
      if (!m || m.state !== 'in') {
        this.sendTo(c, { t: 'ended', why: 'removed' });
        c.closed = true;
        void c.ws.close({ code: CLOSE.removed, reason: 'removed' });
        continue;
      }
      const you = this.you(c.userId);
      this.sendTo(c, { t: 'you', canEdit: you.canEdit, role: you.role });
      if (you.canEdit) c.readonlyTold = false;
    }
    this.broadcast({ t: 'people', people: this.people() });
  }

  end(why: 'host' | 'time') {
    for (const c of this.conns) {
      if (c.closed) continue;
      this.sendTo(c, { t: 'ended', why });
      c.closed = true;
      void c.ws.close({ code: CLOSE.ended, reason: 'ended' });
    }
  }

  // ── What the test does as everyone else ───────────────────────────────

  /** Someone else comes in (their tile, their name in People). */
  join(peer: Peer) {
    this.peers.push(peer);
    this.broadcast({ t: 'people', people: this.people() });
  }

  push(msg: ServerMessage) {
    if (msg.t === 'chat') this.chat.push({ id: msg.id, from: msg.from, text: msg.text, at: msg.at });
    if (msg.t === 'pubs') this.pubs = msg.publications;
    if (msg.t === 'hand') this.hands = msg.up ? [...new Set([...this.hands, msg.userId])] : this.hands.filter((h) => h !== msg.userId);
    this.broadcast(msg);
  }

  /** Someone else edits the shared document: [change] runs on the room's Y.Doc, and the update goes to every screen. */
  edit(change: (doc: Y.Doc) => void) {
    const updates: Uint8Array[] = [];
    const on = (u: Uint8Array) => updates.push(u);
    this.doc.on('update', on);
    this.doc.transact(() => change(this.doc), 'peer');
    this.doc.off('update', on);
    for (const u of updates) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, FRAME.sync);
      syncProtocol.writeUpdate(enc, u);
      for (const c of this.conns) if (!c.closed) this.sendBytes(c, encoding.toUint8Array(enc));
    }
  }

  /** Fills the room as if someone had seeded it already: one document with [text]. */
  fill(docId: string, title: string, text: string) {
    this.doc.transact(() => {
      const meta = new Y.Map<unknown>();
      meta.set('kind', 'doc');
      meta.set('title', title);
      meta.set('sort', 0);
      this.doc.getMap(YDOC.documents).set(docId, meta);
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      p.insert(0, [t]);
      this.doc.getXmlFragment(YDOC.doc(docId)).insert(0, [p]);
      t.insert(0, text);
      this.doc.getMap(YDOC.room).set('seeded', true);
    });
    this.wasSeeded = true;
  }

  /** The text of a shared document, as the room has it. */
  text(docId: string): string {
    return this.doc.getXmlFragment(YDOC.doc(docId)).toString().replace(/<[^>]+>/g, '');
  }

  /** The socket drops (a network blip): the screen reconnects with a new ticket. */
  drop() {
    for (const c of this.conns) {
      if (c.closed) continue;
      c.closed = true;
      void c.ws.close({ code: 1011, reason: 'gone' });
    }
  }

  open(): Conn[] {
    return this.conns.filter((c) => !c.closed);
  }

  broadcast(msg: ServerMessage) {
    for (const c of this.conns) if (!c.closed) this.sendTo(c, msg);
  }

  private sendTo(c: Conn, msg: ServerMessage) {
    try {
      c.ws.send(JSON.stringify(msg));
    } catch {
      c.closed = true;
    }
  }

  private sendBytes(c: Conn, bytes: Uint8Array) {
    try {
      c.ws.send(Buffer.from(bytes));
    } catch {
      c.closed = true;
    }
  }
}
