/** A room's own storage: the SQLite database of its Durable Object. Written against a small
 * interface so the tests run the same SQL on node:sqlite.
 *
 * It holds what must survive the room sleeping (hibernation) or moving: the Yjs updates, tickets,
 * people, chat, Chip's conversation, SFU sessions and publications, timers, and a few settings. */
import { ROOM, type ChatMessage, type ChipEntry, type EditMode, type Publication, type Rid, type Role, type SessionPurpose, type TrackKind } from '../shared/rooms.ts';

export type SqlValue = ArrayBuffer | Uint8Array | string | number | null;
export type Row = Record<string, SqlValue>;

export interface Sql {
  exec(query: string, ...bindings: unknown[]): { toArray(): Row[] };
}

/** What the Worker verified about the caller (study_room_access), as the room keeps it. */
export interface Access {
  roomId: string;
  userId: string;
  name: string;
  role: Role;
  state: 'in' | 'waiting' | 'removed';
  canEdit: boolean;
  live: boolean;
  maxPeople: number;
  /** Epoch milliseconds, or null for no time limit. */
  endsAt: number | null;
  editMode: EditMode;
  classRoom: boolean;
  /** When the Worker asked the database (epoch ms): what this access is true as of. */
  checkedAt: number;
}

export interface Member {
  name: string;
  role: Role;
  state: 'in' | 'waiting' | 'removed';
  canEdit: boolean;
}

/** The last roster read through study-rooms, and when it was asked for (it's true as of then). */
export interface RosterCache {
  at: number;
  members: Record<string, Member>;
}

export interface PersonRow {
  userId: string;
  name: string;
  role: Role;
  canEdit: boolean;
  hand: boolean;
}

export interface SessionRow {
  sessionId: string;
  userId: string;
  purpose: SessionPurpose;
}

export interface PubRow extends Publication {
  mid: string;
}

export interface SubRow {
  sessionId: string;
  mid: string;
  pubSessionId: string;
  trackName: string;
  rid: Rid | null;
}

/** Yjs updates are split into parts this size: SQLite rows in a Durable Object hold at most 2 MB. */
const PART_BYTES = 512 * 1024;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tickets (nonce TEXT PRIMARY KEY, user_id TEXT NOT NULL, access TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS people (user_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, can_edit INTEGER NOT NULL, hand INTEGER NOT NULL DEFAULT 0, first_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chat (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chip (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, name TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, done INTEGER NOT NULL, stopped INTEGER NOT NULL, at INTEGER NOT NULL, chunk_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, purpose TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pubs (session_id TEXT NOT NULL, track_name TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, mid TEXT NOT NULL, rids TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (session_id, track_name))`,
  `CREATE TABLE IF NOT EXISTS subs (session_id TEXT NOT NULL, mid TEXT NOT NULL, pub_session_id TEXT NOT NULL, track_name TEXT NOT NULL, rid TEXT, PRIMARY KEY (session_id, mid))`,
  `CREATE TABLE IF NOT EXISTS closing (session_id TEXT NOT NULL, mid TEXT NOT NULL, tries INTEGER NOT NULL, PRIMARY KEY (session_id, mid))`,
  `CREATE TABLE IF NOT EXISTS timers (name TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS y_updates (id INTEGER NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, part))`,
  `CREATE TABLE IF NOT EXISTS saved (key TEXT PRIMARY KEY, print TEXT NOT NULL)`,
];

const toBytes = (v: SqlValue): Uint8Array => (v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array());
/** A copy as an ArrayBuffer: what a Durable Object's SQL takes for a BLOB. */
const toBuffer = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

export class RoomStore {
  constructor(private readonly sql: Sql) {}

  migrate(): void {
    for (const statement of SCHEMA) this.sql.exec(statement);
  }

  private rows(query: string, ...bindings: unknown[]): Row[] {
    return this.sql.exec(query, ...bindings).toArray();
  }

  private run(query: string, ...bindings: unknown[]): void {
    this.sql.exec(query, ...bindings).toArray();
  }

  // ── Settings ──────────────────────────────────────────────────────────

  meta(key: string): string | null {
    const row = this.rows(`SELECT v FROM meta WHERE k = ?`, key)[0];
    return row ? String(row.v) : null;
  }

  setMeta(key: string, value: string | null): void {
    if (value === null) this.run(`DELETE FROM meta WHERE k = ?`, key);
    else this.run(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, key, value);
  }

  json<T>(key: string): T | null {
    const v = this.meta(key);
    if (v === null) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }

  setJson(key: string, value: unknown): void {
    this.setMeta(key, value === null ? null : JSON.stringify(value));
  }

  // ── Tickets: single use, short-lived ──────────────────────────────────

  /** Keeps a new ticket's nonce and what it was issued for; answers when it expires. */
  addTicket(nonce: string, access: Access, now: number): number {
    const expiresAt = now + ROOM.ticketMs;
    this.run(`DELETE FROM tickets WHERE expires_at <= ?`, now);
    // The ticket's rights are the access check's, so they date from when it was made.
    this.run(`INSERT INTO tickets (nonce, user_id, access, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)`, nonce, access.userId, JSON.stringify(access), Math.min(access.checkedAt, now), expiresAt);
    return expiresAt;
  }

  /** Uses up a ticket: answers what it was issued for, or null if there is no such ticket or it
   * has expired. Either way it can't be used again. */
  takeTicket(nonce: string, now: number): { access: Access; issuedAt: number } | null {
    const row = this.rows(`SELECT access, issued_at, expires_at FROM tickets WHERE nonce = ?`, nonce)[0];
    if (!row) return null;
    this.run(`DELETE FROM tickets WHERE nonce = ?`, nonce);
    if (Number(row.expires_at) <= now) return null;
    return { access: JSON.parse(String(row.access)) as Access, issuedAt: Number(row.issued_at) };
  }

  dropTicketsOf(userId: string): void {
    this.run(`DELETE FROM tickets WHERE user_id = ?`, userId);
  }

  // ── People ────────────────────────────────────────────────────────────

  upsertPerson(p: { userId: string; name: string; role: Role; canEdit: boolean }, now: number): void {
    this.run(
      `INSERT INTO people (user_id, name, role, can_edit, hand, first_at) VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, role = excluded.role, can_edit = excluded.can_edit`,
      p.userId, p.name, p.role, p.canEdit ? 1 : 0, now,
    );
  }

  people(): PersonRow[] {
    return this.rows(`SELECT user_id, name, role, can_edit, hand FROM people ORDER BY first_at, user_id`).map((r) => ({
      userId: String(r.user_id),
      name: String(r.name),
      role: String(r.role) as Role,
      canEdit: Number(r.can_edit) === 1,
      hand: Number(r.hand) === 1,
    }));
  }

  removePerson(userId: string): void {
    this.run(`DELETE FROM people WHERE user_id = ?`, userId);
  }

  /** Raises or lowers a hand; true if it changed. */
  setHand(userId: string, up: boolean): boolean {
    const row = this.rows(`SELECT hand FROM people WHERE user_id = ?`, userId)[0];
    if (!row || (Number(row.hand) === 1) === up) return false;
    this.run(`UPDATE people SET hand = ? WHERE user_id = ?`, up ? 1 : 0, userId);
    return true;
  }

  hands(): string[] {
    return this.rows(`SELECT user_id FROM people WHERE hand = 1 ORDER BY first_at`).map((r) => String(r.user_id));
  }

  // ── Chat: the last 200 messages ───────────────────────────────────────

  addChat(m: ChatMessage): void {
    this.run(`INSERT INTO chat (id, user_id, name, text, at) VALUES (?, ?, ?, ?, ?)`, m.id, m.from.userId, m.from.name, m.text, m.at);
    this.run(`DELETE FROM chat WHERE seq <= (SELECT seq FROM chat ORDER BY seq DESC LIMIT 1 OFFSET ?)`, ROOM.chatKept);
  }

  chat(): ChatMessage[] {
    return this.rows(`SELECT id, user_id, name, text, at FROM chat ORDER BY seq`).map((r) => ({
      id: String(r.id),
      from: { userId: String(r.user_id), name: String(r.name) },
      text: String(r.text),
      at: Number(r.at),
    }));
  }

  // ── Chip's conversation: the last 50 ──────────────────────────────────

  private chipRow(r: Row): ChipEntry & { chunkAt: number } {
    const entry: ChipEntry & { chunkAt: number } = {
      id: String(r.id),
      from: { userId: String(r.user_id), name: String(r.name) },
      question: String(r.question),
      answer: String(r.answer),
      done: Number(r.done) === 1,
      at: Number(r.at),
      chunkAt: Number(r.chunk_at),
    };
    if (Number(r.stopped) === 1) entry.stopped = true;
    return entry;
  }

  chipEntry(id: string): (ChipEntry & { chunkAt: number }) | null {
    const row = this.rows(`SELECT * FROM chip WHERE id = ?`, id)[0];
    return row ? this.chipRow(row) : null;
  }

  addChip(e: ChipEntry): void {
    this.run(
      `INSERT INTO chip (id, user_id, name, question, answer, done, stopped, at, chunk_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0)`,
      e.id, e.from.userId, e.from.name, e.question, e.answer, e.at,
    );
    this.run(`DELETE FROM chip WHERE seq <= (SELECT seq FROM chip ORDER BY seq DESC LIMIT 1 OFFSET ?)`, ROOM.chipKept);
  }

  updateChip(id: string, answer: string, done: boolean, chunkAt: number, stopped = false): void {
    this.run(`UPDATE chip SET answer = ?, done = ?, stopped = ?, chunk_at = ? WHERE id = ?`, answer, done ? 1 : 0, stopped ? 1 : 0, chunkAt, id);
  }

  chip(): ChipEntry[] {
    return this.rows(`SELECT * FROM chip ORDER BY seq`).map((r) => {
      const { chunkAt: _chunkAt, ...entry } = this.chipRow(r);
      return entry;
    });
  }

  unfinishedChipOf(userId: string): string[] {
    return this.rows(`SELECT id FROM chip WHERE user_id = ? AND done = 0`, userId).map((r) => String(r.id));
  }

  // ── SFU sessions, publications (the discovery state) and subscriptions ─

  addSession(s: SessionRow, now: number): void {
    this.run(`INSERT OR REPLACE INTO sessions (session_id, user_id, purpose, at) VALUES (?, ?, ?, ?)`, s.sessionId, s.userId, s.purpose, now);
  }

  session(sessionId: string): SessionRow | null {
    const r = this.rows(`SELECT session_id, user_id, purpose FROM sessions WHERE session_id = ?`, sessionId)[0];
    return r ? { sessionId: String(r.session_id), userId: String(r.user_id), purpose: String(r.purpose) as SessionPurpose } : null;
  }

  /** Everyone holding SFU sessions in the room, with when they last made one. */
  sessionHolders(): { userId: string; at: number }[] {
    return this.rows(`SELECT user_id, MAX(at) AS at FROM sessions GROUP BY user_id`).map((r) => ({ userId: String(r.user_id), at: Number(r.at) }));
  }

  sessionsOf(userId: string): SessionRow[] {
    return this.rows(`SELECT session_id, user_id, purpose FROM sessions WHERE user_id = ?`, userId).map((r) => ({
      sessionId: String(r.session_id),
      userId: String(r.user_id),
      purpose: String(r.purpose) as SessionPurpose,
    }));
  }

  /** Forgets a person's sessions and everything on them. */
  dropSessionsOf(userId: string): void {
    for (const s of this.sessionsOf(userId)) {
      this.run(`DELETE FROM pubs WHERE session_id = ?`, s.sessionId);
      this.run(`DELETE FROM subs WHERE session_id = ?`, s.sessionId);
    }
    this.run(`DELETE FROM sessions WHERE user_id = ?`, userId);
  }

  private pubRow(r: Row): PubRow {
    return {
      sessionId: String(r.session_id),
      trackName: String(r.track_name),
      userId: String(r.user_id),
      kind: String(r.kind) as TrackKind,
      mid: String(r.mid),
      rids: JSON.parse(String(r.rids)) as Rid[],
    };
  }

  addPub(p: PubRow, now: number): void {
    this.run(
      `INSERT OR REPLACE INTO pubs (session_id, track_name, user_id, kind, mid, rids, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      p.sessionId, p.trackName, p.userId, p.kind, p.mid, JSON.stringify(p.rids), now,
    );
  }

  pub(sessionId: string, trackName: string): PubRow | null {
    const r = this.rows(`SELECT * FROM pubs WHERE session_id = ? AND track_name = ?`, sessionId, trackName)[0];
    return r ? this.pubRow(r) : null;
  }

  pubsWithMids(): PubRow[] {
    return this.rows(`SELECT * FROM pubs ORDER BY at, session_id, track_name`).map((r) => this.pubRow(r));
  }

  /** The discovery state, as the room shows it. */
  publications(): Publication[] {
    return this.pubsWithMids().map(({ mid: _mid, ...p }) => p);
  }

  pubsOf(userId: string): PubRow[] {
    return this.rows(`SELECT * FROM pubs WHERE user_id = ?`, userId).map((r) => this.pubRow(r));
  }

  /** Withdraws publications from discovery; answers the ones that were there. */
  dropPubs(sessionId: string, mids: readonly string[]): PubRow[] {
    const gone: PubRow[] = [];
    for (const mid of mids) {
      for (const r of this.rows(`SELECT * FROM pubs WHERE session_id = ? AND mid = ?`, sessionId, mid)) gone.push(this.pubRow(r));
      this.run(`DELETE FROM pubs WHERE session_id = ? AND mid = ?`, sessionId, mid);
    }
    return gone;
  }

  addSub(s: SubRow): void {
    this.run(`INSERT OR REPLACE INTO subs (session_id, mid, pub_session_id, track_name, rid) VALUES (?, ?, ?, ?, ?)`, s.sessionId, s.mid, s.pubSessionId, s.trackName, s.rid);
  }

  sub(sessionId: string, mid: string): SubRow | null {
    const r = this.rows(`SELECT * FROM subs WHERE session_id = ? AND mid = ?`, sessionId, mid)[0];
    return r
      ? { sessionId: String(r.session_id), mid: String(r.mid), pubSessionId: String(r.pub_session_id), trackName: String(r.track_name), rid: r.rid === null ? null : (String(r.rid) as Rid) }
      : null;
  }

  setSubRid(sessionId: string, mid: string, rid: Rid): void {
    this.run(`UPDATE subs SET rid = ? WHERE session_id = ? AND mid = ?`, rid, sessionId, mid);
  }

  subsOfSession(sessionId: string): string[] {
    return this.rows(`SELECT mid FROM subs WHERE session_id = ?`, sessionId).map((r) => String(r.mid));
  }

  dropSubs(sessionId: string, mids: readonly string[]): void {
    for (const mid of mids) this.run(`DELETE FROM subs WHERE session_id = ? AND mid = ?`, sessionId, mid);
  }

  /** Every receiving track, by session (for closing them all when the room ends). */
  allSubs(): { sessionId: string; mid: string }[] {
    return this.rows(`SELECT session_id, mid FROM subs`).map((r) => ({ sessionId: String(r.session_id), mid: String(r.mid) }));
  }

  // ── Forced closes still to be confirmed ───────────────────────────────

  addClosing(sessionId: string, mid: string): void {
    this.run(`INSERT INTO closing (session_id, mid, tries) VALUES (?, ?, 0) ON CONFLICT (session_id, mid) DO NOTHING`, sessionId, mid);
  }

  closings(): { sessionId: string; mid: string; tries: number }[] {
    return this.rows(`SELECT session_id, mid, tries FROM closing`).map((r) => ({ sessionId: String(r.session_id), mid: String(r.mid), tries: Number(r.tries) }));
  }

  closingTried(sessionId: string, mid: string): void {
    this.run(`UPDATE closing SET tries = tries + 1 WHERE session_id = ? AND mid = ?`, sessionId, mid);
  }

  closingDone(sessionId: string, mid: string): void {
    this.run(`DELETE FROM closing WHERE session_id = ? AND mid = ?`, sessionId, mid);
  }

  // ── Timers (one alarm serves them all) ────────────────────────────────

  setTimer(name: string, at: number): void {
    this.run(`INSERT INTO timers (name, at) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET at = excluded.at`, name, Math.round(at));
  }

  /** Sets a timer unless it is already set for earlier. */
  setTimerIfSooner(name: string, at: number): void {
    const current = this.timer(name);
    if (current === null || current > at) this.setTimer(name, at);
  }

  clearTimer(name: string): void {
    this.run(`DELETE FROM timers WHERE name = ?`, name);
  }

  clearTimersLike(prefix: string): void {
    this.run(`DELETE FROM timers WHERE substr(name, 1, ?) = ?`, prefix.length, prefix);
  }

  timer(name: string): number | null {
    const r = this.rows(`SELECT at FROM timers WHERE name = ?`, name)[0];
    return r ? Number(r.at) : null;
  }

  /** Timers due by [now], soonest first. They stay set until cleared. */
  dueTimers(now: number): string[] {
    return this.rows(`SELECT name FROM timers WHERE at <= ? ORDER BY at, name`, now).map((r) => String(r.name));
  }

  nextTimer(): number | null {
    const r = this.rows(`SELECT MIN(at) AS at FROM timers`)[0];
    return r && r.at !== null ? Number(r.at) : null;
  }

  // ── The Y.Doc: updates, compacted now and then ────────────────────────

  loadUpdates(): Uint8Array[] {
    const updates: Uint8Array[] = [];
    let id: number | null = null;
    let parts: Uint8Array[] = [];
    const flush = () => {
      if (parts.length === 1) updates.push(parts[0]);
      else if (parts.length > 1) {
        const whole = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const p of parts) {
          whole.set(p, at);
          at += p.length;
        }
        updates.push(whole);
      }
      parts = [];
    };
    for (const r of this.rows(`SELECT id, data FROM y_updates ORDER BY id, part`)) {
      if (Number(r.id) !== id) {
        flush();
        id = Number(r.id);
      }
      parts.push(toBytes(r.data));
    }
    flush();
    return updates;
  }

  private writeUpdate(id: number, update: Uint8Array): void {
    for (let part = 0, at = 0; at < update.length || part === 0; part++, at += PART_BYTES) {
      this.run(`INSERT INTO y_updates (id, part, data) VALUES (?, ?, ?)`, id, part, toBuffer(update.subarray(at, at + PART_BYTES)));
    }
  }

  /** Keeps one more update. */
  appendUpdate(update: Uint8Array): void {
    const r = this.rows(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM y_updates`)[0];
    this.writeUpdate(Number(r.id), update);
  }

  /** Replaces every update with one: the whole document. */
  replaceUpdates(state: Uint8Array): void {
    this.run(`DELETE FROM y_updates`);
    this.writeUpdate(1, state);
  }

  // ── What was saved last (fingerprints, to send only what changed) ─────

  savedPrint(key: string): string | null {
    const r = this.rows(`SELECT print FROM saved WHERE key = ?`, key)[0];
    return r ? String(r.print) : null;
  }

  setSavedPrint(key: string, print: string): void {
    this.run(`INSERT INTO saved (key, print) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET print = excluded.print`, key, print);
  }
}
