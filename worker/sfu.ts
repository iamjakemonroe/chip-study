/** A small typed client for Cloudflare Realtime: the SFU's session and track API, and TURN
 * credentials. The App Secret and TURN key token stay here, on the server.
 * https://developers.cloudflare.com/realtime/sfu/api/ */
import type { IceServer, SessionDescription } from '../shared/rooms.ts';

export const REALTIME_API = 'https://rtc.live.cloudflare.com/v1';

export interface SfuTrack {
  location?: 'local' | 'remote';
  mid?: string;
  sessionId?: string;
  trackName?: string;
  kind?: string;
  simulcast?: { preferredRid: string; priorityOrdering?: 'none' | 'asciibetical'; ridNotAvailable?: 'none' | 'asciibetical' };
}

export interface SfuTrackResult extends SfuTrack {
  errorCode?: string;
  errorDescription?: string;
}

export interface TracksResponse {
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: SessionDescription;
  tracks?: SfuTrackResult[];
}

/** The SFU refused a request (status 4xx) or failed (5xx, or no answer). */
export class SfuError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly description: string,
  ) {
    super(`${status} ${code}${description ? `: ${description}` : ''}`);
  }
  /** The SFU answered and refused; anything else is a failure on its side or on the way. */
  get refused(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 10_000;

async function call<T>(f: Fetch, url: string, method: string, token: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await f(url, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new SfuError(0, 'unreachable', e instanceof Error ? e.message : String(e));
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    if (res.ok) throw new SfuError(502, 'bad_response', 'not JSON');
  }
  const code = typeof json.errorCode === 'string' ? json.errorCode : '';
  if (!res.ok) throw new SfuError(res.status, code || `http_${res.status}`, typeof json.errorDescription === 'string' ? json.errorDescription : '');
  // A request-level error can come with a 200; per-track errors are the caller's to read.
  if (code) throw new SfuError(400, code, typeof json.errorDescription === 'string' ? json.errorDescription : '');
  return json as T;
}

export class SfuClient {
  private readonly app: string;

  constructor(
    base: string,
    appId: string,
    private readonly secret: string,
    // fetch must not be called as a method of this object (Workers: illegal invocation)
    private readonly f: Fetch = (input, init) => fetch(input, init),
  ) {
    this.app = `${base.replace(/\/+$/, '')}/apps/${encodeURIComponent(appId)}`;
  }

  private session(sessionId: string, path: string): string {
    return `${this.app}/sessions/${encodeURIComponent(sessionId)}/${path}`;
  }

  async newSession(): Promise<string> {
    const res = await call<{ sessionId?: unknown }>(this.f, `${this.app}/sessions/new`, 'POST', this.secret);
    if (typeof res.sessionId !== 'string' || !res.sessionId) throw new SfuError(502, 'bad_response', 'no sessionId');
    return res.sessionId;
  }

  /** Publishes (local tracks, with the endpoint's offer) or subscribes (remote tracks). */
  addTracks(sessionId: string, body: { sessionDescription?: SessionDescription; tracks: SfuTrack[] }): Promise<TracksResponse> {
    return call<TracksResponse>(this.f, this.session(sessionId, 'tracks/new'), 'POST', this.secret, body);
  }

  async renegotiate(sessionId: string, answer: SessionDescription): Promise<void> {
    await call(this.f, this.session(sessionId, 'renegotiate'), 'PUT', this.secret, { sessionDescription: answer });
  }

  updateTracks(sessionId: string, tracks: SfuTrack[]): Promise<TracksResponse> {
    return call<TracksResponse>(this.f, this.session(sessionId, 'tracks/update'), 'PUT', this.secret, { tracks });
  }

  /** Closes tracks by mid: with the endpoint's offer (negotiated), or forced without SDP. */
  closeTracks(sessionId: string, mids: readonly string[], how: { offer: SessionDescription } | { force: true }): Promise<TracksResponse> {
    const body = 'offer' in how ? { tracks: mids.map((mid) => ({ mid })), sessionDescription: how.offer, force: false } : { tracks: mids.map((mid) => ({ mid })), force: true };
    return call<TracksResponse>(this.f, this.session(sessionId, 'tracks/close'), 'PUT', this.secret, body);
  }
}

/** A close result that means the track is gone: closed now, or already closed or never there. */
export const closedOrGone = (t: SfuTrackResult): boolean => !t.errorCode || t.errorCode === 'close_track_error';

/** Short-lived TURN credentials (the given TTL), as RTCPeerConnection's iceServers. */
export async function turnCredentials(base: string, keyId: string, token: string, ttlSeconds: number, f: Fetch = fetch): Promise<IceServer[]> {
  const url = `${base.replace(/\/+$/, '')}/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
  const res = await call<{ iceServers?: unknown }>(f, url, 'POST', token, { ttl: ttlSeconds });
  if (!Array.isArray(res.iceServers)) throw new SfuError(502, 'bad_response', 'no iceServers');
  return withoutPort53(res.iceServers as IceServer[]);
}

/** Port 53 is blocked by browsers, and a TURN URL on it only times out: they're taken out. */
export function withoutPort53(servers: IceServer[]): IceServer[] {
  const on53 = (url: string) => /^(stun|stuns|turn|turns):[^?]*:53(\?|$)/i.test(url);
  const out: IceServer[] = [];
  for (const s of servers) {
    if (!s || (typeof s.urls !== 'string' && !Array.isArray(s.urls))) continue;
    const urls = (typeof s.urls === 'string' ? [s.urls] : s.urls).filter((u) => typeof u === 'string' && !on53(u));
    if (!urls.length) continue;
    out.push({ ...s, urls });
  }
  return out;
}
