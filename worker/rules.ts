/** The room server's rules for the HTTP API: request shapes, who may use which SFU session, which
 * publications may be received, and how many people fit. Pure functions, so they can be tested
 * without a Durable Object. SFU session ids and track names are locators, never credentials. */
import {
  LAYERED_KINDS,
  RIDS,
  ROOM,
  TRACK_KINDS,
  trackNameFor,
  type ApiErrorCode,
  type CloseRequest,
  type LayerRequest,
  type PublishRequest,
  type PublishTrack,
  type ReceiveRequest,
  type ReceiveTrack,
  type RenegotiateRequest,
  type Rid,
  type SessionDescription,
  type SessionPurpose,
  type SessionRequest,
  type TrackKind,
} from '../shared/rooms.ts';
import type { PubRow, SessionRow, SubRow } from './store.ts';

export type Refusal = { ok: false; status: number; error: ApiErrorCode; detail?: string; state?: string };
export type Check<T> = { ok: true; value: T } | Refusal;

export const refuse = (status: number, error: ApiErrorCode, detail?: string): Refusal => ({ ok: false, status, error, ...(detail ? { detail } : {}) });
const bad = (detail: string) => refuse(400, 'bad_request', detail);
const ok = <T>(value: T): Check<T> => ({ ok: true, value });

/** At most [maxPeople] different people connected at once. Someone already connected (in another
 * tab, or reconnecting) always fits. */
export function capacityAllows(connected: Iterable<string>, maxPeople: number, userId: string): boolean {
  const people = new Set(connected);
  return people.has(userId) || people.size < maxPeople;
}

/** The caller's own session (of the right purpose, when one is asked for). Someone else's session
 * and a session the room has never seen get the same answer, so ids can't be probed. */
export function ownSession(row: SessionRow | null, userId: string, purpose?: SessionPurpose): Check<SessionRow> {
  if (!row || row.userId !== userId) return refuse(403, 'not_your_session');
  if (purpose && row.purpose !== purpose) return bad(`that session is for ${row.purpose === 'publish' ? 'publishing' : 'receiving'}`);
  return ok(row);
}

// ── Shapes ──────────────────────────────────────────────────────────────

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MID = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_SDP = 200_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sdp(v: unknown, type: SessionDescription['type']): SessionDescription | null {
  if (!isObject(v) || v.type !== type || typeof v.sdp !== 'string' || v.sdp.length === 0 || v.sdp.length > MAX_SDP) return null;
  return { type, sdp: v.sdp };
}

function sessionId(body: Record<string, unknown>): string | null {
  return typeof body.sessionId === 'string' && SESSION_ID.test(body.sessionId) ? body.sessionId : null;
}

function list(v: unknown, max: number): unknown[] | null {
  return Array.isArray(v) && v.length > 0 && v.length <= max ? v : null;
}

const isRid = (v: unknown): v is Rid => typeof v === 'string' && (RIDS as readonly string[]).includes(v);

export function readSession(body: unknown): Check<SessionRequest> {
  if (!isObject(body) || (body.purpose !== 'publish' && body.purpose !== 'receive')) return bad('purpose must be publish or receive');
  return ok({ purpose: body.purpose });
}

/** A publish request. Every track must be named `<userId>:<kind>` for the caller, once each. */
export function readPublish(body: unknown, userId: string): Check<PublishRequest> {
  if (!isObject(body)) return bad('expected an object');
  const id = sessionId(body);
  const offer = sdp(body.offer, 'offer');
  const raw = list(body.tracks, ROOM.maxPublishTracks);
  if (!id) return bad('sessionId');
  if (!offer) return bad('offer must be an SDP offer');
  if (!raw) return bad(`tracks: 1 to ${ROOM.maxPublishTracks}`);
  const tracks: PublishTrack[] = [];
  const names = new Set<string>();
  const mids = new Set<string>();
  for (const t of raw) {
    if (!isObject(t) || typeof t.mid !== 'string' || !MID.test(t.mid)) return bad('each track needs a mid');
    if (typeof t.kind !== 'string' || !TRACK_KINDS.includes(t.kind as TrackKind)) return bad('kind must be audio, video, screen or screen-audio');
    const kind = t.kind as TrackKind;
    if (t.trackName !== trackNameFor(userId, kind)) return refuse(403, 'not_your_track', 'track names are <your user id>:<kind>');
    let rids: Rid[] | undefined;
    if (t.rids !== undefined) {
      if (!LAYERED_KINDS.includes(kind)) return bad('only video and screen have simulcast layers');
      if (!Array.isArray(t.rids) || t.rids.length === 0 || !t.rids.every(isRid) || new Set(t.rids).size !== t.rids.length) return bad('rids are some of f, h, q');
      rids = [...(t.rids as Rid[])].sort();
    }
    if (names.has(t.trackName) || mids.has(t.mid)) return bad('each track once');
    names.add(t.trackName);
    mids.add(t.mid);
    tracks.push({ mid: t.mid, trackName: t.trackName, kind, ...(rids ? { rids } : {}) });
  }
  return ok({ sessionId: id, offer, tracks });
}

export function readReceive(body: unknown): Check<ReceiveRequest> {
  if (!isObject(body)) return bad('expected an object');
  const id = sessionId(body);
  const raw = list(body.tracks, ROOM.maxTracksPerCall);
  if (!id) return bad('sessionId');
  if (!raw) return bad(`tracks: 1 to ${ROOM.maxTracksPerCall}`);
  const tracks: ReceiveTrack[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (!isObject(t) || typeof t.publisherSessionId !== 'string' || !SESSION_ID.test(t.publisherSessionId) || typeof t.trackName !== 'string' || t.trackName.length > 200) {
      return bad('each track needs publisherSessionId and trackName');
    }
    if (t.rid !== undefined && !isRid(t.rid)) return bad('rid is f, h or q');
    const key = `${t.publisherSessionId}\n${t.trackName}`;
    if (seen.has(key)) return bad('each publication once');
    seen.add(key);
    tracks.push({ publisherSessionId: t.publisherSessionId, trackName: t.trackName, ...(t.rid ? { rid: t.rid } : {}) });
  }
  return ok({ sessionId: id, tracks });
}

export function readRenegotiate(body: unknown): Check<RenegotiateRequest> {
  if (!isObject(body)) return bad('expected an object');
  const id = sessionId(body);
  const answer = sdp(body.answer, 'answer');
  if (!id) return bad('sessionId');
  if (!answer) return bad('answer must be an SDP answer');
  return ok({ sessionId: id, answer });
}

export function readLayer(body: unknown): Check<LayerRequest> {
  if (!isObject(body)) return bad('expected an object');
  const id = sessionId(body);
  const raw = list(body.tracks, ROOM.maxTracksPerCall);
  if (!id) return bad('sessionId');
  if (!raw) return bad(`tracks: 1 to ${ROOM.maxTracksPerCall}`);
  const tracks: { mid: string; rid: Rid }[] = [];
  for (const t of raw) {
    if (!isObject(t) || typeof t.mid !== 'string' || !MID.test(t.mid) || !isRid(t.rid)) return bad('each track needs a mid and a rid (f, h or q)');
    tracks.push({ mid: t.mid, rid: t.rid });
  }
  return ok({ sessionId: id, tracks });
}

export function readClose(body: unknown): Check<CloseRequest> {
  if (!isObject(body)) return bad('expected an object');
  const id = sessionId(body);
  const offer = sdp(body.offer, 'offer');
  const raw = list(body.tracks, ROOM.maxTracksPerCall);
  if (!id) return bad('sessionId');
  if (!offer) return bad('offer must be an SDP offer');
  if (!raw) return bad(`tracks: 1 to ${ROOM.maxTracksPerCall}`);
  const tracks: { mid: string }[] = [];
  for (const t of raw) {
    if (!isObject(t) || typeof t.mid !== 'string' || !MID.test(t.mid)) return bad('each track needs a mid');
    tracks.push({ mid: t.mid });
  }
  return ok({ sessionId: id, offer, tracks });
}

// ── What may be received, and at which layer ───────────────────────────

/** Each requested publication must be in this room's discovery state now. The layer must be one it
 * was published with; a layered publication asked for without one gets the smallest, `q`. */
export function checkReceive(req: ReceiveRequest, find: (sessionId: string, trackName: string) => PubRow | null): Check<{ pub: PubRow; rid: Rid | null }[]> {
  const out: { pub: PubRow; rid: Rid | null }[] = [];
  const missing: string[] = [];
  for (const t of req.tracks) {
    const pub = find(t.publisherSessionId, t.trackName);
    if (!pub) {
      missing.push(t.trackName);
      continue;
    }
    if (pub.rids.length === 0) {
      if (t.rid) return bad(`${t.trackName} has no simulcast layers`);
      out.push({ pub, rid: null });
    } else {
      const rid = t.rid ?? 'q';
      if (!pub.rids.includes(rid)) return bad(`${t.trackName} has no layer ${rid}`);
      out.push({ pub, rid });
    }
  }
  if (missing.length) return refuse(404, 'unknown_publication', missing.join(', '));
  return ok(out);
}

/** Each layer change must be for a track received on this session, of a publication still in the
 * room, at a layer it has. */
export function checkLayer(
  req: LayerRequest,
  findSub: (sessionId: string, mid: string) => SubRow | null,
  findPub: (sessionId: string, trackName: string) => PubRow | null,
): Check<{ sub: SubRow; pub: PubRow; rid: Rid }[]> {
  const out: { sub: SubRow; pub: PubRow; rid: Rid }[] = [];
  for (const t of req.tracks) {
    const sub = findSub(req.sessionId, t.mid);
    if (!sub) return refuse(404, 'unknown_track', t.mid);
    const pub = findPub(sub.pubSessionId, sub.trackName);
    if (!pub) return refuse(404, 'unknown_publication', sub.trackName);
    if (!pub.rids.includes(t.rid)) return bad(`${pub.trackName} has no layer ${t.rid}`);
    out.push({ sub, pub, rid: t.rid });
  }
  return ok(out);
}

/** Counts what each person does, to cap how often (kept in memory: a room that sleeps forgets). */
export class RateLimits {
  private hits = new Map<string, number[]>();

  /** True if [key] may act now: at most [count] times in [windowMs]. */
  take(key: string, count: number, windowMs: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs);
    const allowed = recent.length < count;
    if (allowed) recent.push(now);
    this.hits.set(key, recent);
    return allowed;
  }
}

/** The SFU's simulcast preference for a layer: that layer, falling back alphabetically (f, then h,
 * then q) when it isn't there or bandwidth is short. */
export const simulcast = (rid: Rid) => ({ preferredRid: rid, priorityOrdering: 'asciibetical' as const, ridNotAvailable: 'asciibetical' as const });
