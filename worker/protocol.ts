/** The room socket's protocol, kept apart from the Durable Object so it can be tested on its own.
 *
 * Binary frames are Yjs over y-protocols: a varUint frame type (0 sync, 1 awareness), then the
 * sync message (step 1, step 2 or update) or the awareness update. Text frames are JSON. */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as sync from 'y-protocols/sync';
import * as Y from 'yjs';
import { CHIP_ID, FRAME, ROOM, YDOC, type ClientMessage } from '../shared/rooms.ts';

export class FrameError extends Error {}

/** The frame's type (its first varUint). */
export function frameType(frame: Uint8Array): number {
  try {
    return decoding.readVarUint(decoding.createDecoder(frame));
  } catch {
    throw new FrameError('empty frame');
  }
}

export type SyncResult =
  /** A sync step 1, answered with the step 2 to send back. */
  | { kind: 'reply'; reply: Uint8Array }
  /** An editor's change, applied to the document. */
  | { kind: 'applied' }
  /** An editor's change that fills the room again (it sets room.seeded, which is already set):
   * dropped, so two fillings can never both land and double the host's work. */
  | { kind: 'refilled' }
  /** From someone who can't edit, but nothing new (a step 2 of what the server already has). */
  | { kind: 'ignored' }
  /** Someone who can't edit tried to change the document: dropped. */
  | { kind: 'refused' };

/** True when [update] adds nothing to [doc]: every struct and every deletion is already there. */
export function addsNothing(doc: Y.Doc, update: Uint8Array): boolean {
  try {
    return Y.snapshotContainsUpdate(Y.snapshot(doc), update);
  } catch {
    return false;
  }
}

/** The item [id] points at in [doc], if the document has it. */
function itemAt(doc: Y.Doc, id: Y.ID | null): Y.Item | null {
  if (!id || id.clock >= Y.getState(doc.store, id.client)) return null;
  try {
    const found = Y.getItem(doc.store, id);
    return found instanceof Y.Item ? found : null;
  } catch {
    return null;
  }
}

/** True when [update] newly sets `room.seeded` in [doc] (as only a filling does). */
export function setsSeedFlag(doc: Y.Doc, update: Uint8Array): boolean {
  const room = doc.getMap(YDOC.room);
  try {
    for (const s of Y.decodeUpdate(update).structs) {
      if (!(s instanceof Y.Item) || s.id.clock < Y.getState(doc.store, s.id.client)) continue; // not new
      // A decoded item names its parent only when it has no neighbours: a top-level type by its
      // name. A value written over an existing one has the old value as its origin instead, and
      // takes that one's parent and key.
      if ((s.parent as unknown) === YDOC.room && s.parentSub === 'seeded') return true;
      if (s.parent === null) {
        const near = itemAt(doc, s.origin) ?? itemAt(doc, s.rightOrigin);
        if (near && near.parent === room && near.parentSub === 'seeded') return true;
      }
    }
  } catch {
    return false; // applyUpdate will say what's wrong with it
  }
  return false;
}

/** Handles a sync frame. Step 1 (asking for the state) is answered for everyone; step 2 and
 * updates are applied only from people who can edit, and never a second filling of a room that
 * is already filled ([seeded]). */
export function handleSync(doc: Y.Doc, frame: Uint8Array, canEdit: boolean, origin: unknown, seeded = false): SyncResult {
  const decoder = decoding.createDecoder(frame);
  if (decoding.readVarUint(decoder) !== FRAME.sync) throw new FrameError('not a sync frame');
  let step: number;
  try {
    step = decoding.readVarUint(decoder);
  } catch {
    throw new FrameError('short sync frame');
  }
  switch (step) {
    case sync.messageYjsSyncStep1: {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, FRAME.sync);
      try {
        sync.readSyncStep1(decoder, encoder, doc);
      } catch {
        throw new FrameError('bad state vector');
      }
      return { kind: 'reply', reply: encoding.toUint8Array(encoder) };
    }
    case sync.messageYjsSyncStep2:
    case sync.messageYjsUpdate: {
      let update: Uint8Array;
      try {
        update = decoding.readVarUint8Array(decoder);
      } catch {
        throw new FrameError('short update');
      }
      if (!canEdit) return addsNothing(doc, update) ? { kind: 'ignored' } : { kind: 'refused' };
      if (seeded && setsSeedFlag(doc, update)) return { kind: 'refilled' };
      try {
        Y.applyUpdate(doc, update, origin);
      } catch {
        throw new FrameError('bad update');
      }
      return { kind: 'applied' };
    }
    default:
      throw new FrameError('unknown sync message');
  }
}

/** Sync step 1: the server's state vector, asking a client for what the server is missing. */
export function syncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, FRAME.sync);
  sync.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A document update, to pass on to everyone else. */
export function updateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, FRAME.sync);
  sync.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

// ── Awareness ───────────────────────────────────────────────────────────

/** One client's awareness: its Yjs client id, clock, and state as JSON ("null" when it left). */
export interface AwarenessEntry {
  clientId: number;
  clock: number;
  state: string;
}

export function decodeAwareness(frame: Uint8Array): AwarenessEntry[] {
  try {
    const outer = decoding.createDecoder(frame);
    if (decoding.readVarUint(outer) !== FRAME.awareness) throw new FrameError('not awareness');
    const decoder = decoding.createDecoder(decoding.readVarUint8Array(outer));
    const count = decoding.readVarUint(decoder);
    const entries: AwarenessEntry[] = [];
    for (let i = 0; i < count; i++) {
      entries.push({ clientId: decoding.readVarUint(decoder), clock: decoding.readVarUint(decoder), state: decoding.readVarString(decoder) });
    }
    return entries;
  } catch (e) {
    if (e instanceof FrameError) throw e;
    throw new FrameError('bad awareness');
  }
}

export function encodeAwareness(entries: AwarenessEntry[]): Uint8Array {
  const inner = encoding.createEncoder();
  encoding.writeVarUint(inner, entries.length);
  for (const e of entries) {
    encoding.writeVarUint(inner, e.clientId);
    encoding.writeVarUint(inner, e.clock);
    encoding.writeVarString(inner, e.state);
  }
  const outer = encoding.createEncoder();
  encoding.writeVarUint(outer, FRAME.awareness);
  encoding.writeVarUint8Array(outer, encoding.toUint8Array(inner));
  return encoding.toUint8Array(outer);
}

const MAX_CLIENTS_PER_SOCKET = 4;
const MAX_ENTRIES_PER_FRAME = 16;
const MAX_STATE_CHARS = 16_384;

/** Relays awareness (cursors and selections) between sockets.
 *
 * Each socket may speak only for the Yjs client ids it was first to use (a few at most), so no one
 * can move or remove someone else's cursor. Every state's `user.id` and `user.name` are set to the
 * verified person before it is passed on, so screens can trust `user.id`. States are kept in
 * memory only: after the room sleeps, clients' regular renewals (every 15 s) fill them in again. */
export class AwarenessRelay {
  private states = new Map<number, { clock: number; state: string }>();
  private owners = new Map<number, string>();

  /** Re-learns which socket owns which client ids (after the room wakes up). */
  restore(conn: string, clientIds: readonly number[]): void {
    for (const id of clientIds) if (!this.owners.has(id)) this.owners.set(id, conn);
  }

  /** Takes a socket's awareness frame. Answers the frame to pass on to everyone else (or null when
   * nothing in it may be passed on) and the client ids the socket owns now. */
  accept(conn: string, person: { id: string; name: string }, frame: Uint8Array, owned: readonly number[]): { frame: Uint8Array | null; owned: number[] } {
    const mine = new Set(owned);
    const out: AwarenessEntry[] = [];
    for (const entry of decodeAwareness(frame).slice(0, MAX_ENTRIES_PER_FRAME)) {
      const owner = this.owners.get(entry.clientId);
      if (owner !== undefined && owner !== conn) continue; // someone else's cursor
      if (owner === undefined) {
        if (mine.size >= MAX_CLIENTS_PER_SOCKET) continue;
        this.owners.set(entry.clientId, conn);
        mine.add(entry.clientId);
      }
      const known = this.states.get(entry.clientId);
      if (known && known.clock > entry.clock) continue; // out of date
      const state = stamp(entry.state, person);
      if (state === undefined) continue;
      this.states.set(entry.clientId, { clock: entry.clock, state });
      out.push({ clientId: entry.clientId, clock: entry.clock, state });
    }
    return { frame: out.length ? encodeAwareness(out) : null, owned: [...mine] };
  }

  /** Everyone's current state, for a socket that just joined (null when there is none). */
  snapshot(): Uint8Array | null {
    const out: AwarenessEntry[] = [];
    for (const [clientId, { clock, state }] of this.states) if (state !== 'null') out.push({ clientId, clock, state });
    return out.length ? encodeAwareness(out) : null;
  }

  /** A socket closed: forgets its clients, and answers the frame that removes them for everyone
   * (null when their states aren't known, e.g. just after the room woke up: clients then drop
   * them on their own after 30 s). */
  drop(conn: string, owned: readonly number[]): Uint8Array | null {
    const out: AwarenessEntry[] = [];
    for (const clientId of owned) {
      if (this.owners.get(clientId) !== conn) continue;
      this.owners.delete(clientId);
      const known = this.states.get(clientId);
      this.states.delete(clientId);
      if (known && known.state !== 'null') out.push({ clientId, clock: known.clock + 1, state: 'null' });
    }
    return out.length ? encodeAwareness(out) : null;
  }
}

/** The state with the verified person in `user`, "null" for a client that left, or undefined when
 * it isn't an awareness state at all. */
function stamp(state: string, person: { id: string; name: string }): string | undefined {
  if (state.length > MAX_STATE_CHARS) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(state);
  } catch {
    return undefined;
  }
  if (value === null) return 'null';
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const user = typeof obj.user === 'object' && obj.user !== null && !Array.isArray(obj.user) ? (obj.user as Record<string, unknown>) : {};
  return JSON.stringify({ ...obj, user: { ...user, id: person.id, name: person.name } });
}

// ── JSON messages ───────────────────────────────────────────────────────

/** A client's JSON message, checked; null when it isn't one the server knows. Lengths and empty
 * text are the room's to judge. */
export function parseClientMessage(text: string): ClientMessage | null {
  if (text.length > ROOM.maxTextBytes) return null;
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const msg = m as Record<string, unknown>;
  switch (msg.t) {
    case 'chat':
      return typeof msg.text === 'string' ? { t: 'chat', text: msg.text } : null;
    case 'hand':
      return typeof msg.up === 'boolean' ? { t: 'hand', up: msg.up } : null;
    case 'perm':
    case 'mute-all':
    case 'end':
    case 'seeded':
      return { t: msg.t };
    case 'chip-ask':
    case 'chip-chunk':
    case 'chip-done':
      return typeof msg.id === 'string' && CHIP_ID.test(msg.id) && typeof msg.text === 'string' ? { t: msg.t, id: msg.id, text: msg.text } : null;
    default:
      return null;
  }
}
