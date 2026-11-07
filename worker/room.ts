/** StudyRoom: one Durable Object per room (named by the room's id). It owns the room's live state:
 * the shared Y.Doc, who is connected and what they may do, chat, hands, Chip's conversation, the
 * SFU sessions and publications, and the room's lifetime (saves, the free room's end, closing an
 * empty room). Sockets use the hibernation API, so a quiet room costs nothing while it waits.
 *
 * Everyone arrives through the Worker (worker/index.ts), which has already checked their sign-in
 * with study_room_access. HTTP calls come in as RPC with that verified access; the room socket
 * comes in as a WebSocket upgrade with a ticket the room issued. The contract is docs/rooms.md. */
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  CLOSE,
  FRAME,
  ROOM,
  type ApiErrorCode,
  type ChatMessage,
  type ChipEntry,
  type EditMode,
  type EndedWhy,
  type Person,
  type ReceiveResult,
  type Role,
  type ServerMessage,
  type SocketErrorCode,
  type TrackResult,
} from '../shared/rooms.ts';
import { configured, type Env } from './env.ts';
import { AwarenessRelay, FrameError, frameType, handleSync, parseClientMessage, syncStep1, updateFrame } from './protocol.ts';
import {
  capacityAllows,
  checkLayer,
  checkReceive,
  ownSession,
  RateLimits,
  readClose,
  readLayer,
  readPublish,
  readReceive,
  readRenegotiate,
  readSession,
  simulcast,
  type Refusal,
} from './rules.ts';
import { changedBatches, prints } from './save.ts';
import { closedOrGone, REALTIME_API, SfuClient, SfuError, type SfuTrackResult } from './sfu.ts';
import { RoomStore, type Access, type PubRow, type RosterCache } from './store.ts';
import { RoomService, type Roster } from './supabase.ts';
import { newNonce } from './tickets.ts';
import { buildSave, isSeeded } from './ydoc.ts';

/** An answer to one of the Worker's RPC calls: the HTTP status and the JSON body to send. */
export interface Answer {
  status: number;
  body: string;
}

export type RtcOp = 'session' | 'publish' | 'receive' | 'renegotiate' | 'layer' | 'close';

/** What each socket carries through hibernation: who it is and what they may do (from the
 * ticket, then from the roster after each perm), never anything the browser said. */
interface Attachment {
  /** user id */
  u: string;
  /** name */
  n: string;
  /** role */
  r: Role;
  /** can edit */
  e: boolean;
  /** connection id */
  c: string;
  /** connected at */
  at: number;
  /** awareness client ids this socket speaks for */
  aw: number[];
  /** when the rights above were checked (epoch ms): a roster asked for earlier doesn't overrule them */
  ck: number;
  /** already told it's read-only */
  ro?: boolean;
}

const OPEN = 1;
/** The origin of updates read back from storage, which aren't stored or sent again. */
const LOADING = Symbol('loading');
const COMPACT_UPDATES = 400;
const COMPACT_BYTES = 4 << 20;
const MAX_FINISH_TRIES = 12;
/** While anyone is connected, the room is touched this often: the database ends a room nobody
 * has saved to for six hours, even if people are in it (talking, not typing). */
const KEEPALIVE_MS = 60 * 60_000;
const MAX_CLOSE_TRIES = 5;

const answer = (status: number, body: unknown): Answer => ({ status, body: JSON.stringify(body) });
const fail = (status: number, error: ApiErrorCode, detail?: string): Answer => answer(status, { error, ...(detail ? { detail } : {}) });
const refused = (r: Refusal): Answer => answer(r.status, { error: r.error, ...(r.detail ? { detail: r.detail } : {}), ...(r.state ? { state: r.state } : {}) });

const cleanResult = (t: SfuTrackResult | undefined, fallback: { mid?: string; trackName?: string }): TrackResult => {
  const out: TrackResult = {};
  const mid = t?.mid ?? fallback.mid;
  const trackName = t?.trackName ?? fallback.trackName;
  if (mid) out.mid = mid;
  if (trackName) out.trackName = trackName;
  if (!t) out.errorCode = 'no_result';
  else if (t.errorCode) {
    out.errorCode = t.errorCode;
    if (t.errorDescription) out.errorDescription = t.errorDescription;
  }
  return out;
};

const bySession = (rows: { sessionId: string; mid: string }[]): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.sessionId, [...(out.get(r.sessionId) ?? []), r.mid]);
  return out;
};

const isManager = (a: Attachment) => a.r === 'host' || a.r === 'cohost';

export class StudyRoom extends DurableObject<Env> {
  private readonly store: RoomStore;
  private readonly relay = new AwarenessRelay();
  private relayRestored = false;
  private readonly limits = new RateLimits();
  /** One queue of SFU calls per session: the SFU wants each session's changes one at a time. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private ydoc: Y.Doc | null = null;
  private yUpdates = 0;
  private yBytes = 0;
  /** Size of the first stored update (the last compaction's whole document). */
  private yBase = 0;
  private seeded = false;
  /** Changes since the room woke: a save only counts the room as saved if none came in meanwhile. */
  private changes = 0;
  private saving: Promise<boolean> = Promise.resolve(true);
  private rosterRun: Promise<boolean> | null = null;
  private rosterAgain = false;
  private readonly rosterAskers = new Set<WebSocket>();
  private endedWhy: string | null;
  /** Bumped when the room's storage is cleared, so work started before stops. */
  private generation = 0;
  private alarmAt: number | null | undefined = undefined;
  private readonly left = new Set<string>();
  private sfuClient: SfuClient | null = null;
  private serviceClient: RoomService | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new RoomStore({ exec: (query, ...bindings) => ctx.storage.sql.exec(query, ...bindings) });
    this.store.migrate();
    this.endedWhy = this.store.meta('ended');
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ── RPC from the Worker ───────────────────────────────────────────────

  /** A ticket's nonce for the room socket (the Worker signs it). Refused when the room is full. */
  async ticket(roomId: string, access: Access): Promise<Answer> {
    const stop = this.enter(roomId, access);
    if (stop) return stop;
    if (!this.limits.take(`ticket:${access.userId}`, 20, 60_000)) return fail(429, 'rate_limited');
    if (!capacityAllows(this.connectedUsers(), access.maxPeople, access.userId)) return fail(409, 'room_full');
    const now = Date.now();
    const nonce = newNonce();
    const expiresAt = this.store.addTicket(nonce, access, now);
    // A room nobody connects to is closed like one everybody left, but never under someone who
    // has just been given a ticket.
    if (!this.open().length) {
      const empty = this.store.timer('empty');
      const soonest = now + ROOM.ticketMs + 60_000;
      if (empty === null) this.store.setTimer('empty', now + ROOM.emptyCloseMs);
      else if (empty < soonest) this.store.setTimer('empty', soonest);
    }
    await this.arm();
    return answer(200, { nonce, expiresAt });
  }

  /** The SFU proxy: every call checked against who owns which session and what is in the room. */
  async rtc(op: RtcOp, roomId: string, access: Access, body: unknown): Promise<Answer> {
    const stop = this.enter(roomId, access);
    if (stop) return stop;
    const sfu = this.sfu();
    if (!sfu) return fail(503, 'not_configured', 'video is not set up yet');
    // Media is for people in the room: new sessions, publishing and receiving need an open room
    // socket. (Renegotiating, layers and closing still work while a socket reconnects.)
    if ((op === 'session' || op === 'publish' || op === 'receive') && !this.connectedUsers().has(access.userId)) {
      return fail(409, 'not_connected', 'open the room socket first');
    }
    try {
      switch (op) {
        case 'session':
          return await this.rtcSession(sfu, access, body);
        case 'publish':
          return await this.rtcPublish(sfu, access, body);
        case 'receive':
          return await this.rtcReceive(sfu, access, body);
        case 'renegotiate':
          return await this.rtcRenegotiate(sfu, access, body);
        case 'layer':
          return await this.rtcLayer(sfu, access, body);
        case 'close':
          return await this.rtcClose(sfu, access, body);
        default:
          return fail(404, 'not_found');
      }
    } catch (e) {
      if (e instanceof SfuError) {
        console.error('room sfu', op, e.message);
        return answer(e.refused ? 409 : 502, { error: e.refused ? 'sfu_rejected' : 'sfu_error', code: e.code, ...(e.description ? { detail: e.description } : {}) });
      }
      throw e;
    } finally {
      await this.arm();
    }
  }

  /** The room socket. The Worker has checked the ticket's signature; here it is used up. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/ws' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const now = Date.now();
    const taken = this.store.takeTicket(url.searchParams.get('n') ?? '', now);
    if (!taken) return this.refuseSocket('bad_ticket', CLOSE.badTicket);
    if (this.endedWhy) return this.refuseSocket('ended', CLOSE.ended);
    let { access } = taken;
    let checkedAt = taken.issuedAt;
    // A roster asked for after the ticket's access check knows better: a host may have taken them
    // out or changed what they may do in the meantime. (Someone missing from it was a member at
    // the check, so they've been taken out.)
    const roster = this.store.json<RosterCache>('roster');
    if (roster && roster.at >= taken.issuedAt) {
      const m = roster.members[access.userId];
      if (!m || m.state !== 'in') return this.refuseSocket('removed', CLOSE.removed);
      access = { ...access, name: m.name, role: m.role, canEdit: m.canEdit };
      checkedAt = roster.at;
    }
    if (!capacityAllows(this.connectedUsers(), this.maxPeople(access.maxPeople), access.userId)) return this.refuseSocket('room_full', CLOSE.full);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [access.userId]);
    const a: Attachment = { u: access.userId, n: access.name, r: access.role, e: access.canEdit, c: crypto.randomUUID(), at: now, aw: [], ck: checkedAt };
    server.serializeAttachment(a);
    this.join(server, a, now);
    await this.arm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = this.att(ws);
    if (!a) return;
    if (this.endedWhy) {
      this.closeSocket(ws, CLOSE.ended, 'ended');
      return;
    }
    try {
      if (typeof message === 'string') await this.onText(ws, a, message);
      else this.onBinary(ws, a, new Uint8Array(message));
    } catch (e) {
      if (e instanceof FrameError) {
        this.send(ws, { t: 'error', code: 'bad_frame' });
        this.closeSocket(ws, CLOSE.protocol, 'protocol');
      } else console.error('room message', e);
    }
    await this.arm();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.closeSocket(ws, CLOSE.normal, 'bye');
    await this.leave(ws);
    await this.arm();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.leave(ws);
    await this.arm();
  }

  /** One alarm serves every timer: saves, the free room's warning and end, the empty room's
   * close, dropping a departed person's publications, the seeding wait, and SFU cleanup. */
  async alarm(): Promise<void> {
    this.alarmAt = null;
    const generation = this.generation;
    const now = Date.now();
    for (const name of this.store.dueTimers(now)) {
      const at = this.store.timer(name);
      if (at === null || at > now) continue; // cleared or moved while an earlier one ran
      this.store.clearTimer(name);
      try {
        await this.fire(name, now);
      } catch (e) {
        console.error('room timer', name, e);
      }
      if (this.generation !== generation) return;
    }
    await this.arm();
  }

  // ── Entering ──────────────────────────────────────────────────────────

  /** Checks shared by every RPC, and learns the room's settings from the verified access. */
  private enter(roomId: string, access: Access): Answer | null {
    const known = this.store.meta('room');
    if (known && known !== roomId) return fail(500, 'internal', 'wrong room');
    if (!known) this.store.setMeta('room', roomId);
    if (this.endedWhy) return fail(410, 'ended');
    if (access.roomId !== roomId || access.state !== 'in' || !access.live) return fail(403, 'not_in_room');
    this.learn(access);
    return null;
  }

  /** The room's settings, from an access check or a roster, and the free room's timers. */
  private learn(r: { maxPeople: number; endsAt: number | null; editMode: EditMode }): void {
    const set = (key: string, value: string | null) => {
      if (this.store.meta(key) !== value) this.store.setMeta(key, value);
    };
    set('maxPeople', String(r.maxPeople));
    set('editMode', r.editMode);
    set('endsAt', r.endsAt === null ? null : String(r.endsAt));
    if (r.endsAt === null) {
      this.store.clearTimer('warn');
      this.store.clearTimer('end');
    } else {
      if (this.store.meta('warned') !== '1' && this.store.timer('warn') !== r.endsAt - ROOM.endingWarnMs) this.store.setTimer('warn', r.endsAt - ROOM.endingWarnMs);
      if (this.store.timer('end') !== r.endsAt) this.store.setTimer('end', r.endsAt);
    }
  }

  private refuseSocket(code: SocketErrorCode, close: number): Response {
    const pair = new WebSocketPair();
    const server = pair[1];
    server.accept();
    server.send(JSON.stringify({ t: 'error', code } satisfies ServerMessage));
    server.close(close, code);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private join(ws: WebSocket, a: Attachment, now: number): void {
    this.store.upsertPerson({ userId: a.u, name: a.n, role: a.r, canEdit: a.e }, now);
    this.store.clearTimer(`depart:${a.u}`);
    this.store.clearTimer('empty');
    const doc = this.doc();
    const endsAt = this.endsAt();
    this.send(ws, {
      t: 'hello',
      you: { userId: a.u, name: a.n, role: a.r, canEdit: a.e },
      people: this.peopleList(),
      publications: this.store.publications(),
      chat: this.store.chat(),
      chip: this.store.chip(),
      hands: this.store.hands(),
      endsAt,
      editMode: this.editMode(),
      seeded: this.seeded,
    });
    // Ask editors for anything the room is missing (after a restart, their copy may be newer).
    // Viewers aren't asked: nothing they send would be kept.
    if (a.e) this.sendBytes(ws, syncStep1(doc));
    const aw = this.relay.snapshot();
    if (aw) this.sendBytes(ws, aw);
    if (endsAt !== null && now >= endsAt - ROOM.endingWarnMs) this.send(ws, { t: 'ending', at: endsAt });
    if (this.store.timer('keepalive') === null) this.store.setTimer('keepalive', now + KEEPALIVE_MS);
    this.askToSeed();
    this.broadcast({ t: 'people', people: this.peopleList() }, ws);
  }

  // ── The shared document ───────────────────────────────────────────────

  /** The room's Y.Doc, read back from storage the first time it's needed after waking. */
  private doc(): Y.Doc {
    if (this.ydoc) return this.ydoc;
    const doc = new Y.Doc({ gc: true });
    const updates = this.store.loadUpdates();
    doc.transact(() => {
      for (const u of updates) Y.applyUpdate(doc, u, LOADING);
    }, LOADING);
    this.yUpdates = updates.length;
    this.yBytes = updates.reduce((n, u) => n + u.length, 0);
    this.yBase = updates[0]?.length ?? 0;
    this.seeded = this.store.meta('seeded') === '1' || isSeeded(doc);
    doc.on('update', (update: Uint8Array, origin: unknown) => this.onDocUpdate(update, origin));
    this.ydoc = doc;
    return doc;
  }

  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === LOADING || !this.ydoc) return;
    this.store.appendUpdate(update);
    this.yUpdates++;
    this.yBytes += update.length;
    if (this.yUpdates > COMPACT_UPDATES || this.yBytes - this.yBase > COMPACT_BYTES) this.compact();
    this.broadcastBytes(updateFrame(update), origin as WebSocket);
    if (!this.seeded && isSeeded(this.ydoc)) this.onSeeded();
    if (this.seeded) {
      this.changes++;
      if (this.store.meta('dirty') !== '1') this.store.setMeta('dirty', '1');
      if (this.store.timer('save') === null) this.store.setTimer('save', Date.now() + ROOM.saveEveryMs);
    }
  }

  /** Whether the room has been filled. Once it has, it stays filled (kept in storage, so an edit
   * that takes `room.seeded` away can't make the room ask for seeding or stop saving). */
  private seededNow(): boolean {
    return this.seeded || this.store.meta('seeded') === '1';
  }

  /** Replaces the stored updates with the whole document in one. */
  private compact(): void {
    const state = Y.encodeStateAsUpdate(this.ydoc!);
    this.ctx.storage.transactionSync(() => this.store.replaceUpdates(state));
    this.yUpdates = 1;
    this.yBytes = state.length;
    this.yBase = state.length;
  }

  /** The room has just been filled. What it was filled with is what the database already has, so
   * it's remembered as saved: only real changes are ever sent. */
  private onSeeded(): void {
    this.seeded = true;
    this.store.setMeta('seeded', '1');
    this.store.setMeta('seeder', null);
    this.store.clearTimer('seed');
    const payload = buildSave(this.ydoc!);
    if (payload) for (const [key, print] of prints(payload)) this.store.setSavedPrint(key, print);
  }

  /** Asks the first editor to fill the empty room, unless someone is already asked and here. */
  private askToSeed(except?: WebSocket): void {
    if (this.seededNow() || this.endedWhy) return;
    const asked = this.store.json<{ conn: string }>('seeder');
    const editors = this.open(except).filter((s) => s.a.e);
    if (asked && editors.some((s) => s.a.c === asked.conn)) return;
    this.seedNext(editors, null);
  }

  /** The seeder hasn't seeded in time: the next editor is asked (or the same one, if alone). */
  private seedTimedOut(): void {
    if (this.seededNow() || this.endedWhy) return;
    const asked = this.store.json<{ conn: string }>('seeder');
    this.seedNext(this.open().filter((s) => s.a.e), asked?.conn ?? null);
  }

  /** Asks the editor who came after [afterConn] (the first, if none), in the order they came. */
  private seedNext(editors: { ws: WebSocket; a: Attachment }[], afterConn: string | null): void {
    editors.sort((x, y) => x.a.at - y.a.at || (x.a.c < y.a.c ? -1 : 1));
    const after = editors.findIndex((s) => s.a.c === afterConn);
    const next = editors[(after + 1) % Math.max(editors.length, 1)];
    if (!next) {
      this.store.setMeta('seeder', null);
      this.store.clearTimer('seed');
      return;
    }
    this.store.setJson('seeder', { conn: next.a.c, at: Date.now() });
    this.store.setTimer('seed', Date.now() + ROOM.seedWaitMs);
    this.send(next.ws, { t: 'seed' });
  }

  // ── Messages ──────────────────────────────────────────────────────────

  private onBinary(ws: WebSocket, a: Attachment, bytes: Uint8Array): void {
    if (bytes.length > ROOM.maxBinaryBytes) {
      this.send(ws, { t: 'error', code: 'too_long' });
      this.closeSocket(ws, CLOSE.tooBig, 'too big');
      return;
    }
    const type = frameType(bytes);
    if (type === FRAME.sync) {
      // Each step 1 makes the room send its whole document back: a few at a time is plenty.
      if (bytes[1] === 0 && !this.limits.take(`step1:${a.c}`, 6, 10_000)) return this.send(ws, { t: 'error', code: 'rate_limited' });
      const result = handleSync(this.doc(), bytes, a.e, ws, this.seededNow());
      if (result.kind === 'reply') this.sendBytes(ws, result.reply);
      else if (result.kind === 'refilled') this.send(ws, { t: 'error', code: 'already_seeded' });
      else if (result.kind === 'refused' && !a.ro) {
        this.setAtt(ws, { ...a, ro: true });
        this.send(ws, { t: 'readonly' });
      }
    } else if (type === FRAME.awareness) {
      if (!this.limits.take(`aw:${a.c}`, 60, 5_000)) return; // cursors can lag; the next one catches up
      if (!this.relayRestored) {
        for (const o of this.open()) this.relay.restore(o.a.c, o.a.aw);
        this.relayRestored = true;
      }
      const { frame, owned } = this.relay.accept(a.c, { id: a.u, name: a.n }, bytes, a.aw);
      if (owned.length !== a.aw.length) this.setAtt(ws, { ...a, aw: owned });
      if (frame) this.broadcastBytes(frame, ws);
    } else {
      this.send(ws, { t: 'error', code: 'bad_frame' });
    }
  }

  private async onText(ws: WebSocket, a: Attachment, text: string): Promise<void> {
    if (text === 'ping') {
      ws.send('pong'); // the auto-response normally answers this without waking the room
      return;
    }
    const msg = parseClientMessage(text);
    if (!msg) {
      this.send(ws, { t: 'error', code: text.length > ROOM.maxTextBytes ? 'too_long' : 'bad_message' });
      return;
    }
    switch (msg.t) {
      case 'chat':
        return this.chat(ws, a, msg.text);
      case 'hand':
        if (!this.limits.take(`hand:${a.u}`, 20, 10_000)) return this.send(ws, { t: 'error', code: 'rate_limited' });
        if (this.store.setHand(a.u, msg.up)) this.broadcast({ t: 'hand', userId: a.u, up: msg.up });
        return;
      case 'perm':
        if (!isManager(a)) return this.send(ws, { t: 'error', code: 'not_allowed' });
        await this.refreshRoster(ws);
        return;
      case 'mute-all':
        if (!isManager(a)) return this.send(ws, { t: 'error', code: 'not_allowed' });
        if (!this.limits.take(`mute:${a.u}`, 1, 3_000)) return this.send(ws, { t: 'error', code: 'rate_limited' });
        return this.broadcast({ t: 'mute-request', by: a.u }, ws);
      case 'end':
        // Ends the room once the database says it has ended (the host's screen calls
        // study_room_end first): the roster is read again, and applyRoster ends it.
        if (!isManager(a)) return this.send(ws, { t: 'error', code: 'not_allowed' });
        if ((await this.refreshRoster(ws)) && !this.endedWhy) this.send(ws, { t: 'error', code: 'still_live' });
        return;
      case 'seeded':
        // The room counts as seeded when the document says so (room.seeded, set in the same
        // transaction as the filling); this message only confirms it.
        if (!this.seededNow()) this.send(ws, { t: 'error', code: 'not_seeded' });
        return;
      case 'chip-ask':
        return this.chipAsk(ws, a, msg.id, msg.text);
      case 'chip-chunk':
        return this.chipAnswer(ws, a, msg.id, msg.text, false);
      case 'chip-done':
        return this.chipAnswer(ws, a, msg.id, msg.text, true);
    }
  }

  private chat(ws: WebSocket, a: Attachment, raw: string): void {
    const text = raw.trim();
    if (!text) return this.send(ws, { t: 'error', code: 'bad_message' });
    if (text.length > ROOM.chatChars) return this.send(ws, { t: 'error', code: 'too_long' });
    if (!this.limits.take(`chat:${a.u}`, 10, 10_000)) return this.send(ws, { t: 'error', code: 'rate_limited' });
    const m: ChatMessage = { id: crypto.randomUUID(), from: { userId: a.u, name: a.n }, text, at: Date.now() };
    this.store.addChat(m);
    this.broadcast({ t: 'chat', ...m });
  }

  private chipAsk(ws: WebSocket, a: Attachment, id: string, raw: string): void {
    const question = raw.trim();
    if (!question) return this.send(ws, { t: 'error', code: 'bad_message' });
    if (question.length > ROOM.chipQuestionChars) return this.send(ws, { t: 'error', code: 'too_long' });
    if (this.store.chipEntry(id)) return this.send(ws, { t: 'error', code: 'bad_message' });
    if (!this.limits.take(`chip:${a.u}`, 6, 60_000)) return this.send(ws, { t: 'error', code: 'rate_limited' });
    const entry: ChipEntry = { id, from: { userId: a.u, name: a.n }, question, answer: '', done: false, at: Date.now() };
    this.store.addChip(entry);
    this.broadcast({ t: 'chip', ...entry });
  }

  /** The asker's screen relays Chip's answer: each chunk is the whole answer so far, so chunks that
   * come too fast are simply dropped (the next one carries them). */
  private chipAnswer(ws: WebSocket, a: Attachment, id: string, text: string, done: boolean): void {
    const e = this.store.chipEntry(id);
    if (!e || e.from.userId !== a.u) return this.send(ws, { t: 'error', code: 'not_yours' });
    if (e.done) return;
    const now = Date.now();
    if (!done && now - e.chunkAt < ROOM.chipChunkGapMs) return;
    const answerText = text.slice(0, ROOM.chipAnswerChars);
    this.store.updateChip(id, answerText, done, now);
    const { chunkAt: _chunkAt, ...entry } = e;
    this.broadcast({ t: 'chip', ...entry, answer: answerText, done });
  }

  // ── Leaving ───────────────────────────────────────────────────────────

  private async leave(ws: WebSocket): Promise<void> {
    const a = this.att(ws);
    if (!a || this.left.has(a.c)) return;
    this.left.add(a.c);
    const aw = this.relay.drop(a.c, a.aw);
    if (aw) this.broadcastBytes(aw, ws);
    if (this.endedWhy || !this.store.meta('room')) return; // the room has ended (and may be cleared)
    const now = Date.now();
    const others = this.open(ws);
    if (!others.some((o) => o.a.u === a.u)) {
      // Their last socket: hands down, Chip answers they were relaying stop, and their
      // publications go after a grace period unless they come back.
      if (this.store.setHand(a.u, false)) this.broadcast({ t: 'hand', userId: a.u, up: false }, ws);
      for (const id of this.store.unfinishedChipOf(a.u)) {
        const e = this.store.chipEntry(id);
        if (!e) continue;
        this.store.updateChip(id, e.answer, true, now, true);
        const { chunkAt: _chunkAt, ...entry } = e;
        this.broadcast({ t: 'chip', ...entry, done: true, stopped: true }, ws);
      }
      if (this.store.sessionsOf(a.u).length) this.store.setTimer(`depart:${a.u}`, now + ROOM.pubGraceMs);
    }
    const asked = this.store.json<{ conn: string }>('seeder');
    if (asked?.conn === a.c) this.askToSeed(ws);
    this.broadcast({ t: 'people', people: this.peopleList(ws) }, ws);
    if (!others.length) {
      this.store.setTimer('empty', now + ROOM.emptyCloseMs);
      await this.save('last person left');
    }
  }

  /** Their grace period is over and they haven't come back: their publications are withdrawn, and
   * every track of theirs (sent or received) is closed at the SFU. Media is for people in the room. */
  private async depart(userId: string): Promise<void> {
    if (this.connectedUsers().has(userId)) return;
    const tracks = this.tracksOf(userId);
    const hadPubs = this.store.pubsOf(userId).length > 0;
    this.store.dropSessionsOf(userId);
    if (hadPubs) this.broadcast({ t: 'pubs', publications: this.store.publications() });
    await this.forceClose(tracks);
  }

  /** Every track a person has at the SFU: their publications and what they receive. */
  private tracksOf(userId: string): { sessionId: string; mid: string }[] {
    const tracks: { sessionId: string; mid: string }[] = [];
    for (const s of this.store.sessionsOf(userId)) {
      if (s.purpose === 'publish') for (const p of this.store.pubsOf(userId)) if (p.sessionId === s.sessionId) tracks.push(p);
      for (const mid of this.store.subsOfSession(s.sessionId)) tracks.push({ sessionId: s.sessionId, mid });
    }
    return tracks;
  }

  // ── Permissions ───────────────────────────────────────────────────────

  /** Re-reads the roster (after a host changed settings or members). Calls that arrive while one is
   * running make it run once more, so no change is missed; everyone who asked hears if it fails.
   * True when the last read went through. */
  private refreshRoster(requester?: WebSocket): Promise<boolean> {
    if (requester) this.rosterAskers.add(requester);
    if (this.rosterRun) {
      this.rosterAgain = true;
      return this.rosterRun;
    }
    const generation = this.generation;
    this.rosterRun = (async () => {
      let ok = false;
      try {
        for (let pass = 0; pass < 5; pass++) {
          this.rosterAgain = false;
          const askers = [...this.rosterAskers];
          this.rosterAskers.clear();
          try {
            const service = this.service();
            const roomId = this.store.meta('room');
            if (!service || !roomId) throw new Error('ROOM_SERVICE_URL or ROOM_SERVER_SECRET is not set');
            const askedAt = Date.now();
            const roster = await service.roster(roomId);
            if (this.generation !== generation || this.endedWhy) return false;
            await this.applyRoster(roster, askedAt);
            ok = true;
          } catch (e) {
            ok = false;
            console.error('room roster', e instanceof Error ? e.message : e);
            for (const ws of askers) this.send(ws, { t: 'error', code: 'perm_failed' });
          }
          if (!this.rosterAgain || this.endedWhy) break;
        }
        return ok;
      } finally {
        this.rosterRun = null;
      }
    })();
    return this.rosterRun;
  }

  /** Applies a roster asked for at [askedAt]: it's true as of then, so it doesn't overrule rights
   * checked later (someone who joined meanwhile isn't in it, and isn't taken out for that). */
  private async applyRoster(roster: Roster, askedAt: number): Promise<void> {
    const now = Date.now();
    this.store.setJson('roster', { at: askedAt, members: roster.members } satisfies RosterCache);
    this.learn(roster);
    if (!roster.live) {
      await this.end(roster.endsAt !== null && roster.endsAt <= now ? 'time' : 'host');
      return;
    }
    const newer = new Set<string>();
    const out = new Set<string>();
    for (const { ws, a } of this.open()) {
      if (a.ck > askedAt) {
        newer.add(a.u);
        continue;
      }
      const m = roster.members[a.u];
      if (!m || m.state !== 'in') {
        out.add(a.u);
        continue;
      }
      if (a.e === m.canEdit && a.r === m.role && a.n === m.name) continue;
      const next: Attachment = { ...a, n: m.name, r: m.role, e: m.canEdit };
      if (a.e !== m.canEdit) delete next.ro;
      this.setAtt(ws, next);
      if (a.e !== m.canEdit || a.r !== m.role) this.send(ws, { t: 'you', canEdit: m.canEdit, role: m.role });
    }
    for (const p of this.store.people()) {
      if (newer.has(p.userId)) continue;
      const m = roster.members[p.userId];
      if (!m || m.state !== 'in') out.add(p.userId);
      else if (m.name !== p.name || m.role !== p.role || m.canEdit !== p.canEdit) this.store.upsertPerson({ userId: p.userId, ...m }, now);
    }
    // Anyone still holding SFU sessions who is no longer in, even if they never opened a socket.
    for (const { userId, at } of this.store.sessionHolders()) {
      if (newer.has(userId) || at > askedAt) continue;
      const m = roster.members[userId];
      if (!m || m.state !== 'in') out.add(userId);
    }
    for (const userId of out) await this.takeOut(userId);
    this.askToSeed();
    this.broadcast({ t: 'people', people: this.peopleList() });
  }

  /** Takes someone out of the room: told, disconnected, forgotten, and every track of theirs
   * (sent or received) closed at the SFU. */
  private async takeOut(userId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(userId)) {
      const a = this.att(ws);
      if (a) {
        this.left.add(a.c);
        const aw = this.relay.drop(a.c, a.aw);
        if (aw) this.broadcastBytes(aw, ws);
      }
      this.send(ws, { t: 'ended', why: 'removed' });
      this.closeSocket(ws, CLOSE.removed, 'removed');
    }
    const hadHand = this.store.hands().includes(userId);
    this.store.removePerson(userId);
    if (hadHand) this.broadcast({ t: 'hand', userId, up: false });
    this.store.dropTicketsOf(userId);
    this.store.clearTimer(`depart:${userId}`);
    const tracks = this.tracksOf(userId);
    const hadPubs = this.store.pubsOf(userId).length > 0;
    this.store.dropSessionsOf(userId);
    if (hadPubs) this.broadcast({ t: 'pubs', publications: this.store.publications() });
    await this.forceClose(tracks);
  }

  // ── The SFU proxy ─────────────────────────────────────────────────────

  private async rtcSession(sfu: SfuClient, access: Access, body: unknown): Promise<Answer> {
    const req = readSession(body);
    if (!req.ok) return refused(req);
    if (!this.limits.take(`session:${access.userId}`, 12, 60_000)) return fail(429, 'rate_limited');
    const sessionId = await sfu.newSession();
    this.store.addSession({ sessionId, userId: access.userId, purpose: req.value.purpose }, Date.now());
    return answer(200, { sessionId });
  }

  private async rtcPublish(sfu: SfuClient, access: Access, body: unknown): Promise<Answer> {
    const req = readPublish(body, access.userId);
    if (!req.ok) return refused(req);
    const own = ownSession(this.store.session(req.value.sessionId), access.userId, 'publish');
    if (!own.ok) return refused(own);
    const { sessionId, offer, tracks } = req.value;
    const started = Date.now();
    const res = await this.queue(sessionId, () =>
      sfu.addTracks(sessionId, { sessionDescription: offer, tracks: tracks.map((t) => ({ location: 'local', mid: t.mid, trackName: t.trackName })) }),
    );
    const results = res.tracks ?? [];
    const added: PubRow[] = [];
    const out = tracks.map((t) => {
      const r = results.find((x) => x.trackName === t.trackName) ?? results.find((x) => x.mid === t.mid);
      if (r && !r.errorCode) added.push({ userId: access.userId, sessionId, trackName: t.trackName, kind: t.kind, rids: t.rids ?? [], mid: r.mid ?? t.mid });
      return cleanResult(r, t);
    });
    const gone = this.goneSince(access.userId, started);
    if (gone) {
      await this.forceClose(added);
      return gone;
    }
    if (!res.sessionDescription) throw new SfuError(502, 'bad_response', 'no answer');
    // One publication of each kind per person: a new camera (after a reconnect, say) replaces the old.
    const replaced: PubRow[] = [];
    for (const p of added) {
      for (const old of this.store.pubsOf(access.userId)) {
        if (old.kind === p.kind && !(old.sessionId === p.sessionId && old.trackName === p.trackName)) replaced.push(...this.store.dropPubs(old.sessionId, [old.mid]));
      }
      this.store.addPub(p, Date.now());
    }
    if (added.length) this.broadcast({ t: 'pubs', publications: this.store.publications() });
    if (replaced.length) await this.forceClose(replaced);
    return answer(200, { answer: res.sessionDescription, tracks: out });
  }

  private async rtcReceive(sfu: SfuClient, access: Access, body: unknown): Promise<Answer> {
    const req = readReceive(body);
    if (!req.ok) return refused(req);
    const own = ownSession(this.store.session(req.value.sessionId), access.userId, 'receive');
    if (!own.ok) return refused(own);
    const wanted = checkReceive(req.value, (s, n) => this.store.pub(s, n));
    if (!wanted.ok) return refused(wanted);
    const { sessionId } = req.value;
    const started = Date.now();
    const res = await this.queue(sessionId, () =>
      sfu.addTracks(sessionId, {
        tracks: wanted.value.map(({ pub, rid }) => ({ location: 'remote', sessionId: pub.sessionId, trackName: pub.trackName, ...(rid ? { simulcast: simulcast(rid) } : {}) })),
      }),
    );
    const results = res.tracks ?? [];
    const subscribed: { sessionId: string; mid: string }[] = [];
    const out: ReceiveResult[] = wanted.value.map(({ pub, rid }, i) => {
      const r = results.find((x) => x.sessionId === pub.sessionId && x.trackName === pub.trackName) ?? (results.length === wanted.value.length ? results[i] : undefined);
      if (r && !r.errorCode && r.mid) {
        this.store.addSub({ sessionId, mid: r.mid, pubSessionId: pub.sessionId, trackName: pub.trackName, rid });
        subscribed.push({ sessionId, mid: r.mid });
      }
      return { ...cleanResult(r, { trackName: pub.trackName }), publisherSessionId: pub.sessionId, trackName: pub.trackName };
    });
    const gone = this.goneSince(access.userId, started);
    if (gone) {
      this.store.dropSubs(sessionId, subscribed.map((s) => s.mid));
      await this.forceClose(subscribed);
      return gone;
    }
    return answer(200, {
      ...(res.sessionDescription ? { offer: res.sessionDescription } : {}),
      requiresImmediateRenegotiation: res.requiresImmediateRenegotiation === true,
      tracks: out,
    });
  }

  private async rtcRenegotiate(sfu: SfuClient, access: Access, body: unknown): Promise<Answer> {
    const req = readRenegotiate(body);
    if (!req.ok) return refused(req);
    const own = ownSession(this.store.session(req.value.sessionId), access.userId);
    if (!own.ok) return refused(own);
    await this.queue(req.value.sessionId, () => sfu.renegotiate(req.value.sessionId, req.value.answer));
    return answer(200, {});
  }

  private async rtcLayer(sfu: SfuClient, access: Access, body: unknown): Promise<Answer> {
    const req = readLayer(body);
    if (!req.ok) return refused(req);
    const own = ownSession(this.store.session(req.value.sessionId), access.userId, 'receive');
    if (!own.ok) return refused(own);
    const changes = checkLayer(req.value, (s, m) => this.store.sub(s, m), (s, n) => this.store.pub(s, n));
    if (!changes.ok) return refused(changes);
    const { sessionId } = req.value;
    const res = await this.queue(sessionId, () =>
      sfu.updateTracks(
        sessionId,
        changes.value.map(({ sub, pub, rid }) => ({ location: 'remote', sessionId: pub.sessionId, trackName: pub.trackName, mid: sub.mid, simulcast: simulcast(rid) })),
      ),
    );
    const results = res.tracks ?? [];
    const out = changes.value.map(({ sub, rid }) => {
      const r = results.find((x) => x.mid === sub.mid);
      if (r && !r.errorCode) this.store.setSubRid(sessionId, sub.mid, rid);
      return cleanResult(r, { mid: sub.mid, trackName: sub.trackName });
    });
    return answer(200, { tracks: out });
  }

  private async rtcClose(sfu: SfuClient, access: Access, body: unknown): Promise<Answer> {
    const req = readClose(body);
    if (!req.ok) return refused(req);
    const own = ownSession(this.store.session(req.value.sessionId), access.userId);
    if (!own.ok) return refused(own);
    const { sessionId, offer, tracks } = req.value;
    const mids = tracks.map((t) => t.mid);
    const res = await this.queue(sessionId, () => sfu.closeTracks(sessionId, mids, { offer }));
    const results = res.tracks ?? [];
    const closed = mids.filter((mid) => {
      const r = results.find((x) => x.mid === mid);
      return r !== undefined && closedOrGone(r);
    });
    if (own.value.purpose === 'publish') {
      if (this.store.dropPubs(sessionId, closed).length) this.broadcast({ t: 'pubs', publications: this.store.publications() });
    } else this.store.dropSubs(sessionId, closed);
    if (!res.sessionDescription) throw new SfuError(502, 'bad_response', 'no answer');
    return answer(200, { answer: res.sessionDescription, tracks: mids.map((mid) => cleanResult(results.find((x) => x.mid === mid), { mid })) });
  }

  /** Refuses work that finished after the caller was taken out of the room (or it ended). */
  private goneSince(userId: string, since: number): Answer | null {
    if (this.endedWhy) return fail(410, 'ended');
    const roster = this.store.json<RosterCache>('roster');
    if (roster && roster.at >= since && roster.members[userId]?.state !== 'in') return fail(403, 'not_in_room');
    return null;
  }

  /** Runs SFU calls for one session one after another. */
  private queue<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(sessionId) ?? Promise.resolve();
    const next = prev.then(run);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(sessionId, tail);
    void tail.then(() => {
      if (this.queues.get(sessionId) === tail) this.queues.delete(sessionId);
    });
    return next;
  }

  /** Stops these tracks at the SFU without the endpoint (it has gone, or must not keep them).
   * Closes that aren't confirmed are kept and tried again a few times by the cleanup timer. */
  private async forceClose(tracks: { sessionId: string; mid: string }[]): Promise<void> {
    const sfu = this.sfu();
    if (!tracks.length || !sfu) return;
    let pending = false;
    for (const [sessionId, mids] of bySession(tracks)) {
      try {
        const res = await this.queue(sessionId, () => sfu.closeTracks(sessionId, mids, { force: true }));
        for (const mid of mids) {
          const r = res.tracks?.find((t) => t.mid === mid);
          if (!r || !closedOrGone(r)) {
            this.store.addClosing(sessionId, mid);
            pending = true;
          }
        }
      } catch (e) {
        if (e instanceof SfuError && e.refused) continue; // the session itself is gone, and its tracks with it
        console.error('room sfu close', sessionId, e instanceof Error ? e.message : e);
        for (const mid of mids) this.store.addClosing(sessionId, mid);
        pending = true;
      }
    }
    if (pending) this.store.setTimerIfSooner('cleanup', Date.now() + 10_000);
  }

  private async retryClosings(): Promise<void> {
    const sfu = this.sfu();
    if (!sfu) return;
    const pending = this.store.closings();
    let again = false;
    for (const [sessionId, mids] of bySession(pending)) {
      try {
        const res = await this.queue(sessionId, () => sfu.closeTracks(sessionId, mids, { force: true }));
        for (const mid of mids) {
          const r = res.tracks?.find((t) => t.mid === mid);
          const tries = pending.find((p) => p.sessionId === sessionId && p.mid === mid)?.tries ?? 0;
          if ((r && closedOrGone(r)) || tries + 1 >= MAX_CLOSE_TRIES) this.store.closingDone(sessionId, mid);
          else {
            this.store.closingTried(sessionId, mid);
            again = true;
          }
        }
      } catch (e) {
        // A refusal means the session itself is gone (closed or expired), and its tracks with it.
        const gone = e instanceof SfuError && e.refused;
        for (const mid of mids) {
          const tries = pending.find((p) => p.sessionId === sessionId && p.mid === mid)?.tries ?? 0;
          if (gone || tries + 1 >= MAX_CLOSE_TRIES) this.store.closingDone(sessionId, mid);
          else {
            this.store.closingTried(sessionId, mid);
            again = true;
          }
        }
        if (!gone) console.error('room sfu close', sessionId, e instanceof Error ? e.message : e);
      }
    }
    if (again) this.store.setTimer('cleanup', Date.now() + 10_000);
  }

  // ── Saving and ending ─────────────────────────────────────────────────

  /** Saves the shared work (one save at a time). True when everything is saved. */
  private save(reason: string): Promise<boolean> {
    const run = () => this.saveNow(reason);
    const next = this.saving.then(run, run);
    this.saving = next.catch(() => false);
    return next;
  }

  private async saveNow(reason: string): Promise<boolean> {
    const roomId = this.store.meta('room');
    if (!roomId || this.store.meta('dirty') !== '1') return true;
    // Never before the room is seeded: an empty room must not be saved over the host's work.
    const payload = buildSave(this.doc(), this.store.meta('seeded') === '1');
    if (!payload) {
      this.store.setMeta('dirty', null);
      return true;
    }
    const service = this.service();
    const startedAt = this.changes;
    try {
      if (!service) throw new Error('ROOM_SERVICE_URL or ROOM_SERVER_SECRET is not set');
      for (const batch of changedBatches(payload, (key) => this.store.savedPrint(key))) {
        await service.save(roomId, batch.body);
        for (const [key, print] of batch.prints) this.store.setSavedPrint(key, print);
      }
    } catch (e) {
      const fails = Number(this.store.meta('saveFails') ?? 0) + 1;
      this.store.setMeta('saveFails', String(fails));
      this.store.setTimer('save', Date.now() + Math.min(ROOM.saveEveryMs * 2 ** (fails - 1), 10 * 60_000));
      console.error('room save', reason, e instanceof Error ? e.message : e);
      return false;
    }
    this.store.setMeta('saveFails', null);
    if (this.changes === startedAt) {
      this.store.setMeta('dirty', null);
      this.store.clearTimer('save');
    } else this.store.setTimerIfSooner('save', Date.now() + ROOM.saveEveryMs);
    return true;
  }

  /** Ends the room for everyone: a host ended it, or a free room's time is up. */
  private async end(why: Exclude<EndedWhy, 'removed'>): Promise<void> {
    if (this.endedWhy) return;
    this.markEnded(why);
    for (const { ws, a } of this.open()) {
      this.left.add(a.c);
      this.send(ws, { t: 'ended', why });
      this.closeSocket(ws, CLOSE.ended, why);
    }
    await this.finish();
  }

  private markEnded(why: string): void {
    this.endedWhy = why;
    this.store.setMeta('ended', why);
    for (const t of ['save', 'warn', 'end', 'empty', 'seed', 'keepalive']) this.store.clearTimer(t);
    this.store.clearTimersLike('depart:');
  }

  /** After the room ends: the last save, the room closed in the database, every track closed at
   * the SFU, then the room's storage cleared. If the save or the close fails it is tried again
   * later; nothing is cleared before the work is saved. */
  private async finish(): Promise<void> {
    const roomId = this.store.meta('room');
    let done = false;
    let saved = false;
    try {
      saved = await this.save('room ended');
    } catch (e) {
      console.error('room final save', e instanceof Error ? e.message : e);
    }
    if (roomId && saved) {
      try {
        const service = this.service();
        if (!service) throw new Error('ROOM_SERVICE_URL or ROOM_SERVER_SECRET is not set');
        await service.close(roomId);
        done = true;
      } catch (e) {
        console.error('room close', e instanceof Error ? e.message : e);
      }
    }
    if (!done) {
      this.store.clearTimer('save');
      const tries = Number(this.store.meta('finishTries') ?? 0) + 1;
      this.store.setMeta('finishTries', String(tries));
      if (tries <= MAX_FINISH_TRIES) this.store.setTimer('finish', Date.now() + Math.min(60_000 * 2 ** (tries - 1), 60 * 60_000));
      else console.error('room finish: giving up; its storage is kept', roomId);
      return;
    }
    await this.forceClose([...this.store.pubsWithMids(), ...this.store.allSubs()]);
    await this.wipe(roomId!);
  }

  /** Clears the room's storage, keeping only a tombstone: the room has ended for good, so a
   * request that was already on its way can't bring it back to life. */
  private async wipe(roomId: string): Promise<void> {
    const why = this.endedWhy ?? 'ended';
    this.generation++;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.ydoc?.destroy();
    this.ydoc = null;
    this.seeded = false;
    this.changes = 0;
    this.alarmAt = null;
    this.store.migrate();
    this.store.setMeta('room', roomId);
    this.store.setMeta('ended', why);
    this.endedWhy = why;
  }

  private async fire(name: string, now: number): Promise<void> {
    if (!this.store.meta('room')) return; // cleared: nothing left to do
    if (name === 'save') await this.save('timer');
    else if (name === 'keepalive') await this.keepAlive(now);
    else if (name === 'warn') {
      const at = this.endsAt();
      if (at === null || this.endedWhy) return;
      this.store.setMeta('warned', '1');
      this.broadcast({ t: 'ending', at });
    } else if (name === 'end') {
      const at = this.endsAt();
      if (at !== null && at <= now + 1_000) await this.end('time');
    } else if (name === 'empty') {
      if (!this.open().length && !this.endedWhy) {
        this.markEnded('empty');
        await this.finish();
      }
    } else if (name === 'seed') this.seedTimedOut();
    else if (name === 'cleanup') await this.retryClosings();
    else if (name === 'finish') await this.finish();
    else if (name.startsWith('depart:')) await this.depart(name.slice('depart:'.length));
  }

  /** Touches the room in the database (a save of nothing) while people are in it. */
  private async keepAlive(now: number): Promise<void> {
    if (this.endedWhy || !this.open().length) return;
    this.store.setTimer('keepalive', now + KEEPALIVE_MS);
    const roomId = this.store.meta('room');
    try {
      const service = this.service();
      if (!service || !roomId) throw new Error('ROOM_SERVICE_URL or ROOM_SERVER_SECRET is not set');
      await service.save(roomId, {});
    } catch (e) {
      console.error('room keep-alive', e instanceof Error ? e.message : e);
    }
  }

  /** Points the one alarm at the soonest timer. */
  private async arm(): Promise<void> {
    const next = this.store.nextTimer();
    if (this.alarmAt === undefined) this.alarmAt = await this.ctx.storage.getAlarm();
    if (next === this.alarmAt) return;
    this.alarmAt = next;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  // ── Small helpers ─────────────────────────────────────────────────────

  private sfu(): SfuClient | null {
    const { REALTIME_APP_ID: id, REALTIME_APP_SECRET: secret } = this.env;
    if (!configured(id) || !configured(secret)) return null;
    return (this.sfuClient ??= new SfuClient(this.env.REALTIME_API_BASE || REALTIME_API, id, secret));
  }

  private service(): RoomService | null {
    const { ROOM_SERVICE_URL: url, ROOM_SERVER_SECRET: secret } = this.env;
    if (!configured(url) || !configured(secret)) return null;
    return (this.serviceClient ??= new RoomService(url, secret));
  }

  private endsAt(): number | null {
    const v = this.store.meta('endsAt');
    return v === null ? null : Number(v);
  }

  private maxPeople(fallback: number): number {
    const v = Number(this.store.meta('maxPeople'));
    return Number.isInteger(v) && v > 0 ? v : fallback;
  }

  private editMode(): EditMode {
    return this.store.meta('editMode') === 'everyone' ? 'everyone' : 'chosen';
  }

  private att(ws: WebSocket): Attachment | null {
    try {
      const a = ws.deserializeAttachment() as Attachment | null;
      return a && typeof a.u === 'string' ? a : null;
    } catch {
      return null;
    }
  }

  private setAtt(ws: WebSocket, a: Attachment): void {
    try {
      ws.serializeAttachment(a);
    } catch {
      // closed meanwhile
    }
  }

  /** Open sockets and who they are. */
  private open(except?: WebSocket): { ws: WebSocket; a: Attachment }[] {
    const out: { ws: WebSocket; a: Attachment }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== OPEN) continue;
      const a = this.att(ws);
      if (a && !this.left.has(a.c)) out.push({ ws, a });
    }
    return out;
  }

  private connectedUsers(except?: WebSocket): Set<string> {
    return new Set(this.open(except).map((s) => s.a.u));
  }

  private peopleList(except?: WebSocket): Person[] {
    const online = this.connectedUsers(except);
    return this.store.people().map((p) => ({ ...p, connected: online.has(p.userId) }));
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // closed meanwhile
    }
  }

  private sendBytes(ws: WebSocket, bytes: Uint8Array): void {
    try {
      ws.send(bytes);
    } catch {
      // closed meanwhile
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    const text = JSON.stringify(msg);
    for (const { ws } of this.open(except)) {
      try {
        ws.send(text);
      } catch {
        // closed meanwhile
      }
    }
  }

  private broadcastBytes(bytes: Uint8Array, except?: WebSocket): void {
    for (const { ws } of this.open(except)) this.sendBytes(ws, bytes);
  }

  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }
}
