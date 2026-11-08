// The room's media client (src/rooms/media.ts) with a pretend browser (PeerConnections) and a
// pretend room server: one change at a time per session, simulcast layers, receiving in batches,
// retrying a failed receive, asking again without a publication that has gone, starting again after
// a long socket gap or a failed connection, TURN refreshed within the hour, and video paused for
// tiles off screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Publication, PublishRequest, ReceiveAnswer, ReceiveRequest } from '../../shared/rooms';
import { RoomServerError } from '../../src/rooms/errors';
import { MediaClient, PAUSE_AFTER_MS, RETRY_MS, SerialQueue, TURN_REFRESH_MS, type MediaApi, type MediaEnv } from '../../src/rooms/media';

const ME = 'me-0000';

class FakeTransceiver {
  mid: string | null = null;
  direction: string;
  stopped = false;
  init: RTCRtpTransceiverInit | undefined;
  sender = { track: null as unknown, replaceTrack: vi.fn(async (t: unknown) => void (this.sender.track = t)) };
  receiver = { track: null as unknown };
  constructor(direction = 'recvonly') {
    this.direction = direction;
  }
  stop() {
    this.stopped = true;
  }
}

class FakePC {
  static all: FakePC[] = [];
  transceivers: FakeTransceiver[] = [];
  ontrack: ((e: { transceiver: FakeTransceiver; track: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  closed = false;
  private mid = 0;
  constructor(public config: RTCConfiguration) {
    FakePC.all.push(this);
  }
  addTransceiver(track: unknown, init?: RTCRtpTransceiverInit) {
    const t = new FakeTransceiver(init?.direction);
    t.init = init;
    t.sender.track = track;
    this.transceivers.push(t);
    return t;
  }
  async createOffer() {
    return { type: 'offer' as const, sdp: `offer:${this.transceivers.length}` };
  }
  async createAnswer() {
    return { type: 'answer' as const, sdp: 'answer' };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d;
    for (const t of this.transceivers) if (t.mid === null) t.mid = `p${this.mid++}`;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    // The pretend SFU's offers list the mids they bring: "mids:5,6".
    if (d.type !== 'offer') return;
    for (const mid of (d.sdp ?? '').replace('mids:', '').split(',').filter(Boolean)) {
      if (this.transceivers.some((t) => t.mid === mid)) continue;
      const t = new FakeTransceiver();
      t.mid = mid;
      t.receiver.track = { id: `track-${mid}` };
      this.transceivers.push(t);
      this.ontrack?.({ transceiver: t, track: t.receiver.track });
    }
  }
  getTransceivers() {
    return this.transceivers;
  }
  getConfiguration() {
    return this.config;
  }
  setConfiguration(c: RTCConfiguration) {
    this.config = c;
  }
  close() {
    this.closed = true;
  }
  fail() {
    this.connectionState = 'failed';
    this.onconnectionstatechange?.();
  }
}

/** Timers the test moves by hand. */
function manualEnv(): MediaEnv & { advance: (ms: number) => Promise<void> } {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 1;
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return {
    createPeerConnection: (config) => new FakePC(config) as unknown as RTCPeerConnection,
    setTimeout: (fn, ms) => {
      timers.push({ at: now + ms, fn, id: id++ });
      return id - 1;
    },
    clearTimeout: (t) => {
      timers = timers.filter((x) => x.id !== t);
    },
    advance: async (ms) => {
      await settle();
      const until = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > until) break;
        timers.shift();
        now = t.at;
        t.fn();
        await settle();
      }
      now = until;
      await settle();
    },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

/** A pretend room server. [receive] answers each call in turn; by default, every track works. */
function fakeApi() {
  let sessions = 0;
  let mid = 10;
  const receives: ((req: ReceiveRequest) => Promise<ReceiveAnswer> | ReceiveAnswer)[] = [];
  const ok = (req: ReceiveRequest): ReceiveAnswer => {
    const tracks = req.tracks.map((t) => ({ ...t, mid: String(mid++) }));
    return { offer: { type: 'offer', sdp: `mids:${tracks.map((t) => t.mid).join(',')}` }, requiresImmediateRenegotiation: true, tracks };
  };
  const api = {
    turn: vi.fn(async () => [{ urls: 'turn:turn.example:3478', username: `u${api.turn.mock.calls.length}`, credential: 'c' }]),
    session: vi.fn(async (_purpose: string) => `session-${++sessions}`),
    publish: vi.fn(async (req: PublishRequest) => ({ answer: { type: 'answer' as const, sdp: 'answer' }, tracks: req.tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })) })),
    receive: vi.fn(async (req: ReceiveRequest) => (receives.length ? receives.shift()!(req) : ok(req))),
    renegotiate: vi.fn(async () => ({})),
    layer: vi.fn(async (req: { tracks: { mid: string }[] }) => ({ tracks: req.tracks.map((t) => ({ mid: t.mid })) })),
    close: vi.fn(async (req: { tracks: { mid: string }[] }) => ({ answer: { type: 'answer' as const, sdp: 'answer' }, tracks: req.tracks.map((t) => ({ mid: t.mid })) })),
  };
  return { api: api as unknown as MediaApi & typeof api, receives, ok };
}

const pub = (userId: string, kind: Publication['kind'], session = `pub-${userId}`): Publication => ({
  userId,
  sessionId: session,
  trackName: `${userId}:${kind}`,
  kind,
  rids: kind === 'video' ? ['f', 'h', 'q'] : [],
});

const track = (kind: string) => ({ kind, id: `local-${kind}` }) as unknown as MediaStreamTrack;

afterEach(() => {
  FakePC.all = [];
});

describe('the media client', () => {
  it('runs one change at a time, in order, even when one fails', async () => {
    const q = new SerialQueue();
    const order: string[] = [];
    const first = deferred<void>();
    const a = q.run(async () => {
      order.push('a start');
      await first.promise;
      order.push('a end');
    });
    const b = q.run(async () => {
      order.push('b');
      throw new Error('b failed');
    });
    const c = q.run(async () => void order.push('c'));
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['a start']);
    first.resolve();
    await a;
    await expect(b).rejects.toThrow('b failed');
    await c;
    expect(order).toEqual(['a start', 'a end', 'b', 'c']);
  });

  it('publishes on its own session, one change at a time, with simulcast for camera video', async () => {
    const env = manualEnv();
    const { api } = fakeApi();
    const media = new MediaClient(api, ME, env);
    await media.start();
    expect(api.session.mock.calls.map((c) => c[0]).sort()).toEqual(['publish', 'receive']);
    expect(FakePC.all).toHaveLength(2);
    expect(FakePC.all[0].config.iceServers?.[0]).toMatchObject({ urls: 'turn:turn.example:3478' });

    const gate = deferred<void>();
    api.publish.mockImplementationOnce(async (req: PublishRequest) => {
      await gate.promise;
      return { answer: { type: 'answer', sdp: 'a' }, tracks: req.tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })) };
    });
    const audio = media.publish('audio', track('audio'));
    const video = media.publish('video', track('video'));
    await env.advance(0);
    // The camera waits for the microphone's call to finish on the same session.
    expect(api.publish).toHaveBeenCalledTimes(1);
    gate.resolve();
    await audio;
    await video;
    expect(api.publish).toHaveBeenCalledTimes(2);
    const [first, second] = api.publish.mock.calls.map((c) => c[0] as PublishRequest);
    expect(first.tracks).toEqual([{ mid: 'p0', trackName: `${ME}:audio`, kind: 'audio' }]);
    expect(second.tracks).toEqual([{ mid: 'p1', trackName: `${ME}:video`, kind: 'video', rids: ['f', 'h', 'q'] }]);
    expect(first.sessionId).toBe(second.sessionId);
    const pubPc = FakePC.all[0];
    expect(pubPc.transceivers[1].init?.sendEncodings?.map((e) => e.rid)).toEqual(['f', 'h', 'q']);
    expect(pubPc.transceivers[1].init?.sendEncodings?.map((e) => e.scaleResolutionDownBy ?? 1)).toEqual([1, 2, 4]);
    expect(media.published('video')).toBe(true);

    // A new camera swaps the track without asking the server anything.
    await media.publish('video', track('video2'));
    expect(api.publish).toHaveBeenCalledTimes(2);
    expect(pubPc.transceivers[1].sender.replaceTrack).toHaveBeenCalled();

    // Withdrawing closes it at the SFU.
    await media.unpublish('video');
    expect(api.close).toHaveBeenCalledWith(expect.objectContaining({ tracks: [{ mid: 'p1' }] }));
    expect(media.published('video')).toBe(false);
  });

  it('receives new publications together, quarter size for tiles, and hands over each track', async () => {
    const env = manualEnv();
    const { api } = fakeApi();
    const media = new MediaClient(api, ME, env);
    const got: [string, unknown][] = [];
    media.onTrack = (name, t) => got.push([name, t]);
    await media.start();
    media.setPubs([pub('ada', 'video'), pub('ada', 'audio'), pub(ME, 'audio', 'mine')]);
    await env.advance(50);
    expect(api.receive).toHaveBeenCalledTimes(1);
    const req = api.receive.mock.calls[0][0] as ReceiveRequest;
    // Never your own publications.
    expect(req.tracks).toEqual([
      { publisherSessionId: 'pub-ada', trackName: 'ada:video', rid: 'q' },
      { publisherSessionId: 'pub-ada', trackName: 'ada:audio' },
    ]);
    expect(api.renegotiate).toHaveBeenCalledTimes(1);
    expect(got.map(([n]) => n).sort()).toEqual(['ada:audio', 'ada:video']);
    expect(media.track('ada:video')).not.toBeNull();

    // A bigger tile, or the stage: a better layer, through /rtc/layer.
    media.want('ada:video', 'f');
    await env.advance(0);
    expect(api.layer).toHaveBeenCalledWith(expect.objectContaining({ tracks: [{ mid: '10', rid: 'f' }] }));

    // The publication leaves: its track goes.
    media.setPubs([pub('ada', 'audio')]);
    await env.advance(0);
    expect(got.at(-1)).toEqual(['ada:video', null]);
    expect(api.close).toHaveBeenCalledWith(expect.objectContaining({ tracks: [{ mid: '10' }] }));
  });

  it('tries a receive again when a track comes back with an error', async () => {
    const env = manualEnv();
    const { api, receives, ok } = fakeApi();
    receives.push((req) => ({ requiresImmediateRenegotiation: false, tracks: req.tracks.map((t) => ({ ...t, errorCode: 'not_found', errorDescription: 'not yet' })) }));
    const media = new MediaClient(api, ME, env);
    const got: string[] = [];
    media.onTrack = (name, t) => t && got.push(name);
    await media.start();
    media.setPubs([pub('bo', 'audio')]);
    await env.advance(50);
    expect(api.receive).toHaveBeenCalledTimes(1);
    expect(got).toEqual([]);
    await env.advance(RETRY_MS[0]);
    expect(api.receive).toHaveBeenCalledTimes(2);
    expect(got).toEqual(['bo:audio']);
    void ok;
  });

  it('gives up after a few tries, and tries again when asked', async () => {
    const env = manualEnv();
    const { api } = fakeApi();
    api.receive.mockImplementation(async (req: ReceiveRequest) => ({ requiresImmediateRenegotiation: false, tracks: req.tracks.map((t) => ({ ...t, errorCode: 'not_found' })) }));
    const media = new MediaClient(api, ME, env);
    const failed: string[] = [];
    media.onTrackFailed = (n) => failed.push(n);
    await media.start();
    media.setPubs([pub('cy', 'audio')]);
    await env.advance(50 + RETRY_MS.reduce((a, b) => a + b, 0) + 100);
    expect(api.receive).toHaveBeenCalledTimes(RETRY_MS.length + 1);
    expect(failed).toEqual(['cy:audio']);
    expect(media.failed('cy:audio')).toBe(true);
    media.retry('cy:audio');
    await env.advance(50);
    expect(api.receive).toHaveBeenCalledTimes(RETRY_MS.length + 2);
  });

  it('asks again without a publication that has gone', async () => {
    const env = manualEnv();
    const { api, receives } = fakeApi();
    const media = new MediaClient(api, ME, env);
    receives.push(() => {
      // While the call was out, Dee's camera left the room.
      media.setPubs([pub('cal', 'audio')]);
      throw new RoomServerError(404, 'unknown_publication');
    });
    await media.start();
    media.setPubs([pub('cal', 'audio'), pub('dee', 'video')]);
    await env.advance(50);
    await env.advance(RETRY_MS[0] + 50);
    const calls = api.receive.mock.calls.map((c) => (c[0] as ReceiveRequest).tracks.map((t) => t.trackName));
    expect(calls[0].sort()).toEqual(['cal:audio', 'dee:video']);
    expect(calls.at(-1)).toEqual(['cal:audio']);
    expect(media.track('cal:audio')).not.toBeNull();
  });

  it('stops video for a tile off screen after a moment, and receives it again when it’s back', async () => {
    const env = manualEnv();
    const { api } = fakeApi();
    const media = new MediaClient(api, ME, env);
    await media.start();
    media.setPubs([pub('eve', 'video')]);
    await env.advance(50);
    expect(media.track('eve:video')).not.toBeNull();
    media.want('eve:video', null);
    await env.advance(PAUSE_AFTER_MS - 500);
    media.want('eve:video', 'q'); // scrolled back before the wait was over: nothing happens
    await env.advance(1000);
    expect(api.close).not.toHaveBeenCalled();
    media.want('eve:video', null);
    await env.advance(PAUSE_AFTER_MS + 10);
    expect(api.close).toHaveBeenCalledTimes(1);
    expect(media.track('eve:video')).toBeNull();
    media.want('eve:video', 'h');
    await env.advance(50);
    expect(api.receive).toHaveBeenCalledTimes(2);
    expect((api.receive.mock.calls[1][0] as ReceiveRequest).tracks[0].rid).toBe('h');
    expect(media.track('eve:video')).not.toBeNull();
  });

  it('starts again after the socket was away for more than 30 seconds: new sessions, publish, subscribe', async () => {
    const env = manualEnv();
    const { api } = fakeApi();
    const media = new MediaClient(api, ME, env);
    const got: [string, unknown][] = [];
    media.onTrack = (n, t) => got.push([n, t]);
    await media.start();
    await media.publish('audio', track('audio'));
    media.setPubs([pub('fay', 'audio')]);
    await env.advance(50);
    expect(api.session).toHaveBeenCalledTimes(2);

    media.socketBack(12_000); // a short gap: the server still has the sessions
    await env.advance(50);
    expect(api.session).toHaveBeenCalledTimes(2);

    media.socketBack(31_000);
    await env.advance(100);
    expect(api.session).toHaveBeenCalledTimes(4);
    expect(FakePC.all.slice(0, 2).every((pc) => pc.closed)).toBe(true);
    expect(api.publish).toHaveBeenCalledTimes(2);
    expect((api.publish.mock.calls[1][0] as PublishRequest).sessionId).toBe('session-3');
    expect(api.receive).toHaveBeenCalledTimes(2);
    // The old track went, and the new one came.
    expect(got.map(([n, t]) => `${n}:${t ? 'on' : 'off'}`)).toEqual(['fay:audio:on', 'fay:audio:off', 'fay:audio:on']);
  });

  it('starts again when a connection fails', async () => {
    const env = manualEnv();
    const { api } = fakeApi();
    const media = new MediaClient(api, ME, env);
    await media.start();
    FakePC.all[1].fail();
    await env.advance(50);
    expect(api.session).toHaveBeenCalledTimes(4);
    expect(media.state).toBe('ready');
  });

  it('fetches TURN again before the hour is up, and gives it to both connections', async () => {
    const env = manualEnv();
    const { api } = fakeApi();
    const media = new MediaClient(api, ME, env);
    await media.start();
    expect(TURN_REFRESH_MS).toBeLessThan(60 * 60_000);
    await env.advance(TURN_REFRESH_MS + 10);
    expect(api.turn).toHaveBeenCalledTimes(2);
    for (const pc of FakePC.all) expect(pc.config.iceServers?.[0]).toMatchObject({ username: 'u2' });
    await env.advance(TURN_REFRESH_MS + 10);
    expect(api.turn).toHaveBeenCalledTimes(3);
  });

  it('says media isn’t available when the room server has no video set up, and keeps the tracks', async () => {
    const env = manualEnv();
    const { api } = fakeApi();
    api.turn.mockRejectedValueOnce(new RoomServerError(503, 'not_configured'));
    const media = new MediaClient(api, ME, env);
    const states: string[] = [];
    media.onState = (s) => states.push(s);
    await media.start();
    expect(states).toEqual(['starting', 'unavailable']);
    await media.publish('audio', track('audio'));
    expect(api.publish).not.toHaveBeenCalled();
    expect(api.session).not.toHaveBeenCalled();
  });
});
