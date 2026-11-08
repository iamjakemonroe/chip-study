import {
  ROOM,
  trackNameFor,
  type CloseAnswer,
  type CloseRequest,
  type IceServer,
  type LayerAnswer,
  type LayerRequest,
  type Publication,
  type PublishAnswer,
  type PublishRequest,
  type ReceiveAnswer,
  type ReceiveRequest,
  type RenegotiateRequest,
  type Rid,
  type SessionPurpose,
  type TrackKind,
} from '../../shared/rooms.ts';
import { RoomServerError } from './errors.ts';

/** Audio, video and screen sharing in a room, through Cloudflare Realtime's SFU by way of the room
 * server (docs/rooms.md, "Room server API" and "For the room screens"), in Cloudflare's own pattern:
 *
 * - Two PeerConnections: one publishes this screen's tracks, one receives everyone else's, each on
 *   its own SFU session.
 * - Each session's changes go one at a time (a queue per session): the SFU wants every call, and
 *   its renegotiation, finished before the next on the same session.
 * - Camera video goes up in three simulcast layers, f, h and q (full, half and quarter size). Small
 *   tiles ask for q (h when large), the stage for f. Video for a tile that isn't on screen is
 *   stopped until it is.
 * - ICE servers come from /turn and are fetched again before the hour they last is up.
 * - A receive whose track fails is tried again shortly (a publication is announced a moment before
 *   its media flows). A whole receive refused because a publication has gone is asked again
 *   without it.
 * - After a connection fails, or the socket was gone for more than 30 seconds (the server forgets
 *   this screen's sessions then), everything starts again: new sessions, publish, subscribe. */

export interface MediaApi {
  turn(): Promise<IceServer[]>;
  session(purpose: SessionPurpose): Promise<string>;
  publish(req: PublishRequest): Promise<PublishAnswer>;
  receive(req: ReceiveRequest): Promise<ReceiveAnswer>;
  renegotiate(req: RenegotiateRequest): Promise<unknown>;
  layer(req: LayerRequest): Promise<LayerAnswer>;
  close(req: CloseRequest): Promise<CloseAnswer>;
}

export interface MediaEnv {
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(t: unknown): void;
}

export const browserEnv: MediaEnv = {
  createPeerConnection: (config) => new RTCPeerConnection(config),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

/** Runs one change at a time, in order. A failed change doesn't stop the ones after it. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  run<T>(fn: () => Promise<T>): Promise<T> {
    this.waiting++;
    const next = this.tail.then(fn, fn).finally(() => this.waiting--);
    this.tail = next.catch(() => undefined);
    return next;
  }
  get busy(): boolean {
    return this.waiting > 0;
  }
}

export type MediaState = 'idle' | 'starting' | 'ready' | 'unavailable' | 'failed';

/** Video layers, best first. Bitrates keep a quarter-size tile cheap for everyone. */
const ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: 'f', maxBitrate: 1_200_000, maxFramerate: 30 },
  { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 450_000, maxFramerate: 24 },
  { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 150_000, maxFramerate: 15 },
];
const LAYERS: Rid[] = ['f', 'h', 'q'];

/** Waits before trying a failed receive again: a publication's media can lag its announcement. */
export const RETRY_MS = [700, 1500, 3000, 6000, 10_000, 15_000];
/** TURN credentials last an hour; new ones are fetched well before. */
export const TURN_REFRESH_MS = 50 * 60_000;
/** Video stopped for a tile that's been off screen this long. */
export const PAUSE_AFTER_MS = 3_000;

interface Local {
  kind: TrackKind;
  track: MediaStreamTrack;
  transceiver: RTCRtpTransceiver | null;
  published: boolean;
  /** Being published or withdrawn right now. */
  busy: boolean;
}

interface Remote {
  pub: Publication;
  mid: string | null;
  /** The layer wanted (layered video). */
  rid: Rid;
  /** Not wanted now (a tile off screen): not received until it is. */
  paused: boolean;
  /** The layer the SFU was last asked for. */
  asked: Rid | null;
  tries: number;
  retry: unknown;
  failed: boolean;
  pauseTimer: unknown;
}

const sdp = (d: RTCSessionDescriptionInit | null | undefined) => ({ type: d?.type as 'offer' | 'answer', sdp: d?.sdp ?? '' });

export class MediaClient {
  state: MediaState = 'idle';
  onState?: (s: MediaState) => void;
  /** A remote track arrived for a publication (by track name), or went (null). */
  onTrack?: (trackName: string, track: MediaStreamTrack | null) => void;
  /** Receiving a track has failed for good. */
  onTrackFailed?: (trackName: string) => void;
  /** Publishing a local track failed. */
  onPublishFailed?: (kind: TrackKind, error: unknown) => void;

  private epoch = 0;
  private pubPc: RTCPeerConnection | null = null;
  private recvPc: RTCPeerConnection | null = null;
  private pubSession: string | null = null;
  private recvSession: string | null = null;
  private pubQueue = new SerialQueue();
  private recvQueue = new SerialQueue();
  private local = new Map<TrackKind, Local>();
  private remotes = new Map<string, Remote>();
  private byMid = new Map<string, string>();
  private tracks = new Map<string, MediaStreamTrack>();
  private pubs: Publication[] = [];
  private turnTimer: unknown = null;
  private batch: unknown = null;
  private stopped = false;
  private starting: Promise<void> | null = null;

  constructor(
    private api: MediaApi,
    private userId: string,
    private env: MediaEnv = browserEnv,
  ) {}

  private setState(s: MediaState) {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
  }

  /** Makes the sessions and connections, then publishes and subscribes to what's wanted. */
  start(): Promise<void> {
    this.stopped = false;
    this.starting ??= this.begin().finally(() => (this.starting = null));
    return this.starting;
  }

  private async begin(): Promise<void> {
    const epoch = ++this.epoch;
    this.setState('starting');
    let ice: IceServer[];
    try {
      ice = await this.api.turn();
    } catch (e) {
      if (epoch !== this.epoch) return;
      if (e instanceof RoomServerError && e.code === 'not_configured') return this.setState('unavailable');
      ice = [];
    }
    if (epoch !== this.epoch) return;
    const config: RTCConfiguration = { iceServers: ice as RTCIceServer[], bundlePolicy: 'max-bundle' };
    try {
      this.pubPc = this.env.createPeerConnection(config);
      this.recvPc = this.env.createPeerConnection(config);
      this.watch(this.pubPc, epoch);
      this.watch(this.recvPc, epoch);
      this.recvPc.ontrack = (e) => this.arrived(e.transceiver?.mid ?? null, e.track);
      const [pub, recv] = await Promise.all([this.api.session('publish'), this.api.session('receive')]);
      if (epoch !== this.epoch) return;
      this.pubSession = pub;
      this.recvSession = recv;
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.teardown();
      if (e instanceof RoomServerError && e.code === 'not_configured') return this.setState('unavailable');
      this.setState('failed');
      throw e;
    }
    this.setState('ready');
    this.scheduleTurn(epoch);
    for (const l of this.local.values()) void this.publishNow(l.kind);
    this.setPubs(this.pubs);
  }

  private watch(pc: RTCPeerConnection, epoch: number) {
    pc.onconnectionstatechange = () => {
      if (epoch === this.epoch && pc.connectionState === 'failed') void this.restart();
    };
  }

  private scheduleTurn(epoch: number) {
    if (this.turnTimer) this.env.clearTimeout(this.turnTimer);
    this.turnTimer = this.env.setTimeout(async () => {
      if (epoch !== this.epoch) return;
      try {
        const ice = (await this.api.turn()) as RTCIceServer[];
        for (const pc of [this.pubPc, this.recvPc]) pc?.setConfiguration({ ...pc.getConfiguration(), iceServers: ice });
      } catch {
        // The old ones work until they run out; tried again next time.
      }
      this.scheduleTurn(epoch);
    }, TURN_REFRESH_MS);
  }

  /** Starts again from nothing: new sessions, publish again, subscribe again. */
  async restart(): Promise<void> {
    if (this.stopped) return;
    this.teardown();
    await this.start().catch(() => undefined);
  }

  /** The room socket is back after [awayMs]; the server forgot this screen's sessions if it was
   * away for more than 30 seconds. */
  socketBack(awayMs: number | null): void {
    if (awayMs !== null && awayMs > ROOM.pubGraceMs && this.state !== 'idle' && this.state !== 'unavailable') void this.restart();
  }

  private teardown() {
    this.epoch++;
    if (this.turnTimer) this.env.clearTimeout(this.turnTimer);
    this.turnTimer = null;
    for (const pc of [this.pubPc, this.recvPc]) {
      if (!pc) continue;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Already closed.
      }
    }
    this.pubPc = this.recvPc = null;
    this.pubSession = this.recvSession = null;
    this.pubQueue = new SerialQueue();
    this.recvQueue = new SerialQueue();
    for (const l of this.local.values()) {
      l.transceiver = null;
      l.published = false;
      l.busy = false;
    }
    for (const [name, r] of this.remotes) {
      if (r.retry) this.env.clearTimeout(r.retry);
      r.retry = null;
      r.mid = null;
      r.asked = null;
      r.tries = 0;
      r.failed = false;
      if (this.tracks.delete(name)) this.onTrack?.(name, null);
    }
    this.byMid.clear();
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
    for (const r of this.remotes.values()) if (r.pauseTimer) this.env.clearTimeout(r.pauseTimer);
    this.remotes.clear();
    this.local.clear();
    this.setState('idle');
  }

  // ── Publishing ───────────────────────────────────────────────────────

  /** Sends [track] as this screen's [kind] (replacing any it had). */
  publish(kind: TrackKind, track: MediaStreamTrack): Promise<void> {
    const had = this.local.get(kind);
    if (had && had.published && had.transceiver) {
      // Same kind, new device: swap the track without asking the SFU anything.
      had.track = track;
      return had.transceiver.sender.replaceTrack(track).catch(() => undefined);
    }
    this.local.set(kind, { kind, track, transceiver: null, published: false, busy: false });
    return this.publishNow(kind);
  }

  private publishNow(kind: TrackKind): Promise<void> {
    if (this.state !== 'ready') return Promise.resolve();
    const epoch = this.epoch;
    return this.pubQueue.run(async () => {
      const l = this.local.get(kind);
      if (!l || l.published || epoch !== this.epoch || !this.pubPc || !this.pubSession) return;
      l.busy = true;
      const pc = this.pubPc;
      const layered = kind === 'video';
      let transceiver: RTCRtpTransceiver;
      let rids: Rid[] | undefined;
      try {
        transceiver = pc.addTransceiver(l.track, { direction: 'sendonly', ...(layered ? { sendEncodings: ENCODINGS.map((e) => ({ ...e })) } : {}) });
        rids = layered ? LAYERS : undefined;
      } catch {
        // A browser without simulcast: one layer.
        transceiver = pc.addTransceiver(l.track, { direction: 'sendonly' });
        rids = undefined;
      }
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (epoch !== this.epoch) return;
        const mid = transceiver.mid;
        if (!mid) throw new Error('no mid');
        const res = await this.api.publish({
          sessionId: this.pubSession,
          offer: sdp(pc.localDescription ?? offer),
          tracks: [{ mid, trackName: trackNameFor(this.userId, kind), kind, ...(rids ? { rids } : {}) }],
        });
        if (epoch !== this.epoch) return;
        await pc.setRemoteDescription(res.answer);
        const result = res.tracks.find((t) => t.mid === mid) ?? res.tracks[0];
        if (result?.errorCode) throw new Error(result.errorCode);
        // Withdrawn while it was going up.
        if (this.local.get(kind) !== l) {
          l.transceiver = transceiver;
          l.published = true;
          l.busy = false;
          await this.closeLocal(l, epoch);
          return;
        }
        l.transceiver = transceiver;
        l.published = true;
      } catch (e) {
        if (epoch !== this.epoch) return;
        try {
          transceiver.stop();
        } catch {
          // Already stopped.
        }
        if (this.local.get(kind) === l) this.local.delete(kind);
        this.onPublishFailed?.(kind, e);
      } finally {
        l.busy = false;
      }
    });
  }

  /** Stops sending [kind]: the publication leaves the room. */
  unpublish(kind: TrackKind): Promise<void> {
    const l = this.local.get(kind);
    if (!l) return Promise.resolve();
    this.local.delete(kind);
    if (!l.published || this.state !== 'ready') return Promise.resolve();
    const epoch = this.epoch;
    return this.pubQueue.run(() => this.closeLocal(l, epoch));
  }

  private async closeLocal(l: Local, epoch: number): Promise<void> {
    const pc = this.pubPc;
    const t = l.transceiver;
    if (!pc || !t || !this.pubSession || epoch !== this.epoch) return;
    const mid = t.mid;
    try {
      t.direction = 'inactive';
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (epoch !== this.epoch || !mid) return;
      const res = await this.api.close({ sessionId: this.pubSession, offer: sdp(pc.localDescription ?? offer), tracks: [{ mid }] });
      if (epoch !== this.epoch) return;
      await pc.setRemoteDescription(res.answer);
    } catch {
      // The server drops it with the session anyway.
    } finally {
      try {
        t.stop();
      } catch {
        // Already stopped.
      }
      l.published = false;
      l.transceiver = null;
    }
  }

  published(kind: TrackKind): boolean {
    return !!this.local.get(kind)?.published;
  }

  // ── Receiving ────────────────────────────────────────────────────────

  /** The room's publications now (from the socket's hello and pubs): new ones are received, ones
   * that left are let go. */
  setPubs(pubs: Publication[]): void {
    this.pubs = pubs;
    const theirs = pubs.filter((p) => p.userId !== this.userId);
    for (const [name, r] of [...this.remotes]) {
      const now = theirs.find((p) => p.trackName === name);
      if (!now) this.forget(name);
      else if (now.sessionId !== r.pub.sessionId) {
        // Published again (a new session): receive the new one.
        this.forget(name);
      }
    }
    for (const p of theirs) {
      if (this.remotes.has(p.trackName)) continue;
      this.remotes.set(p.trackName, { pub: p, mid: null, rid: 'q', paused: false, asked: null, tries: 0, retry: null, failed: false, pauseTimer: null });
    }
    this.schedule();
  }

  /** What a screen wants of a video publication: a layer, or nothing while it's off screen (after
   * a short wait, so scrolling past doesn't stop and start it). */
  want(trackName: string, rid: Rid | null): void {
    const r = this.remotes.get(trackName);
    if (!r || r.pub.kind === 'audio' || r.pub.kind === 'screen-audio') return;
    if (r.pauseTimer) {
      this.env.clearTimeout(r.pauseTimer);
      r.pauseTimer = null;
    }
    if (rid === null) {
      if (r.paused) return;
      r.pauseTimer = this.env.setTimeout(() => {
        r.pauseTimer = null;
        r.paused = true;
        if (r.mid) void this.release([trackName]);
      }, PAUSE_AFTER_MS);
      return;
    }
    if (r.pub.rids.length) r.rid = r.pub.rids.includes(rid) ? rid : ([...r.pub.rids].sort().find((x) => x >= rid) ?? r.pub.rids[0]);
    const wasPaused = r.paused;
    r.paused = false;
    if (r.mid && r.pub.rids.length && r.asked !== r.rid) void this.changeLayer(trackName, r.rid);
    else if (!r.mid && wasPaused) this.schedule();
  }

  private wanted(r: Remote): boolean {
    return r.pub.kind === 'audio' || r.pub.kind === 'screen-audio' || !r.paused;
  }

  /** Receives what's wanted and not yet received, together, in a moment. */
  private schedule() {
    if (this.batch || this.state !== 'ready') return;
    this.batch = this.env.setTimeout(() => {
      this.batch = null;
      const names = [...this.remotes].filter(([, r]) => !r.mid && !r.retry && !r.failed && this.wanted(r)).map(([n]) => n);
      for (let i = 0; i < names.length; i += ROOM.maxTracksPerCall) void this.receive(names.slice(i, i + ROOM.maxTracksPerCall));
    }, 30);
  }

  private receive(names: string[]): Promise<void> {
    const epoch = this.epoch;
    return this.recvQueue.run(async () => {
      if (epoch !== this.epoch || !this.recvPc || !this.recvSession) return;
      const items = names.map((n) => [n, this.remotes.get(n)] as const).filter((x): x is readonly [string, Remote] => !!x[1] && !x[1].mid && this.wanted(x[1]));
      if (!items.length) return;
      const pc = this.recvPc;
      let res: ReceiveAnswer;
      try {
        res = await this.api.receive({
          sessionId: this.recvSession,
          tracks: items.map(([, r]) => ({ publisherSessionId: r.pub.sessionId, trackName: r.pub.trackName, ...(r.pub.rids.length ? { rid: r.rid } : {}) })),
        });
      } catch (e) {
        if (epoch !== this.epoch) return;
        if (e instanceof RoomServerError && e.code === 'unknown_publication') {
          // One of them has gone: ask again for those still in the room.
          for (const [n, r] of items) if (!this.pubs.some((p) => p.trackName === n && p.sessionId === r.pub.sessionId)) this.forget(n);
          for (const [n] of items) if (this.remotes.has(n)) this.retryLater(n);
          return;
        }
        for (const [n] of items) this.retryLater(n);
        return;
      }
      if (epoch !== this.epoch) return;
      for (const t of res.tracks) {
        const r = this.remotes.get(t.trackName);
        if (!r) continue;
        if (t.errorCode || !t.mid) {
          this.retryLater(t.trackName);
          continue;
        }
        r.mid = t.mid;
        r.asked = r.pub.rids.length ? r.rid : null;
        r.tries = 0;
        this.byMid.set(t.mid, t.trackName);
      }
      if (res.requiresImmediateRenegotiation && res.offer) {
        try {
          await pc.setRemoteDescription(res.offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (epoch !== this.epoch) return;
          await this.api.renegotiate({ sessionId: this.recvSession!, answer: sdp(pc.localDescription ?? answer) });
        } catch {
          if (epoch === this.epoch) void this.restart();
          return;
        }
      }
      // A track the SFU sent before its mid was known.
      for (const t of pc.getTransceivers()) {
        const name = t.mid ? this.byMid.get(t.mid) : undefined;
        if (name && !this.tracks.has(name) && t.receiver.track) this.arrived(t.mid, t.receiver.track);
      }
    });
  }

  private arrived(mid: string | null, track: MediaStreamTrack) {
    const name = mid ? this.byMid.get(mid) : undefined;
    if (!name) return;
    if (this.tracks.get(name) === track) return;
    this.tracks.set(name, track);
    this.onTrack?.(name, track);
  }

  private retryLater(name: string) {
    const r = this.remotes.get(name);
    if (!r || r.retry) return;
    if (r.tries >= RETRY_MS.length) {
      r.failed = true;
      this.onTrackFailed?.(name);
      return;
    }
    const wait = RETRY_MS[r.tries++];
    r.retry = this.env.setTimeout(() => {
      r.retry = null;
      if (this.remotes.get(name) === r && !r.mid) void this.receive([name]);
    }, wait);
  }

  /** Tries a failed track again (a person tapping "Try again" on a tile). */
  retry(name: string): void {
    const r = this.remotes.get(name);
    if (!r) return;
    r.failed = false;
    r.tries = 0;
    this.schedule();
  }

  private changeLayer(name: string, rid: Rid): Promise<void> {
    const epoch = this.epoch;
    return this.recvQueue.run(async () => {
      const r = this.remotes.get(name);
      if (!r?.mid || epoch !== this.epoch || !this.recvSession || r.asked === rid) return;
      try {
        const res = await this.api.layer({ sessionId: this.recvSession, tracks: [{ mid: r.mid, rid }] });
        if (!res.tracks[0]?.errorCode) r.asked = rid;
      } catch {
        // Stays on the layer it has.
      }
    });
  }

  /** Stops receiving [names] at the SFU (they stay known, to receive again later). */
  private release(names: string[]): Promise<void> {
    const epoch = this.epoch;
    return this.recvQueue.run(async () => {
      const pc = this.recvPc;
      if (!pc || !this.recvSession || epoch !== this.epoch) return;
      const items = names.map((n) => [n, this.remotes.get(n)] as const).filter((x): x is readonly [string, Remote] => !!x[1]?.mid);
      if (!items.length) return;
      const mids = items.map(([, r]) => r.mid!);
      for (const [n, r] of items) {
        this.byMid.delete(r.mid!);
        r.mid = null;
        r.asked = null;
        if (this.tracks.delete(n)) this.onTrack?.(n, null);
      }
      try {
        for (const t of pc.getTransceivers()) if (t.mid && mids.includes(t.mid)) t.direction = 'inactive';
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (epoch !== this.epoch) return;
        const res = await this.api.close({ sessionId: this.recvSession, offer: sdp(pc.localDescription ?? offer), tracks: mids.map((mid) => ({ mid })) });
        if (epoch !== this.epoch) return;
        await pc.setRemoteDescription(res.answer);
      } catch {
        // The SFU stops sending a closed session's tracks anyway.
      }
      // Wanted again while it was being let go.
      for (const [, r] of items) if (this.wanted(r)) this.schedule();
    });
  }

  private forget(name: string) {
    const r = this.remotes.get(name);
    if (!r) return;
    if (r.retry) this.env.clearTimeout(r.retry);
    if (r.pauseTimer) this.env.clearTimeout(r.pauseTimer);
    this.remotes.delete(name);
    if (r.mid) {
      const mid = r.mid;
      this.byMid.delete(mid);
      r.mid = null;
      const epoch = this.epoch;
      void this.recvQueue.run(async () => {
        const pc = this.recvPc;
        if (!pc || !this.recvSession || epoch !== this.epoch) return;
        try {
          for (const t of pc.getTransceivers()) if (t.mid === mid) t.direction = 'inactive';
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          const res = await this.api.close({ sessionId: this.recvSession, offer: sdp(pc.localDescription ?? offer), tracks: [{ mid }] });
          if (epoch === this.epoch) await pc.setRemoteDescription(res.answer);
        } catch {
          // Gone already (the server closes a withdrawn publication's tracks).
        }
      });
    }
    if (this.tracks.delete(name)) this.onTrack?.(name, null);
  }

  /** A received track, if it has arrived. */
  track(name: string): MediaStreamTrack | null {
    return this.tracks.get(name) ?? null;
  }

  /** Whether receiving [name] has failed for good. */
  failed(name: string): boolean {
    return !!this.remotes.get(name)?.failed;
  }

  /** The receivers, for audio levels (who's speaking). */
  receivers(): { trackName: string; receiver: RTCRtpReceiver }[] {
    const pc = this.recvPc;
    if (!pc) return [];
    const out: { trackName: string; receiver: RTCRtpReceiver }[] = [];
    for (const t of pc.getTransceivers()) {
      const name = t.mid ? this.byMid.get(t.mid) : undefined;
      if (name) out.push({ trackName: name, receiver: t.receiver });
    }
    return out;
  }
}
