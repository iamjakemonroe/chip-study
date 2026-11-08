// @vitest-environment node
// The room server's rules: how many fit, whose SFU sessions and publications are whose, signed
// tickets, what the database answers, and the exact requests sent to Cloudflare's SFU and TURN.
import { describe, expect, it } from 'vitest';
import { capacityAllows, checkLayer, checkReceive, ownSession, RateLimits, readClose, readLayer, readPublish, readReceive, readRenegotiate, readSession } from '../../worker/rules';
import { SfuClient, SfuError, turnCredentials, withoutPort53 } from '../../worker/sfu';
import type { PubRow, SubRow } from '../../worker/store';
import { parseAccess, parseRoster } from '../../worker/supabase';
import { newNonce, readTicket, signTicket } from '../../worker/tickets';
import { ROOM } from '../../shared/rooms';

const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROOM_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OFFER = { type: 'offer', sdp: 'v=0\r\n' };
const ANSWER = { type: 'answer', sdp: 'v=0\r\n' };

describe('capacity', () => {
  it('lets at most max_people different people in', () => {
    expect(capacityAllows([], 4, ADA)).toBe(true);
    expect(capacityAllows(['p1', 'p2', 'p3'], 4, ADA)).toBe(true);
    expect(capacityAllows(['p1', 'p2', 'p3', 'p4'], 4, ADA)).toBe(false);
  });

  it('always fits someone already connected (another tab, or coming back)', () => {
    expect(capacityAllows(['p1', 'p2', 'p3', ADA], 4, ADA)).toBe(true);
  });

  it('counts people, not sockets', () => {
    expect(capacityAllows(['p1', 'p1', 'p1', 'p2'], 3, ADA)).toBe(true);
    expect(capacityAllows(['p1', 'p1', 'p2', 'p3'], 3, ADA)).toBe(false);
  });
});

describe('who owns which session', () => {
  const adaPub = { sessionId: 's-ada', userId: ADA, purpose: 'publish' as const };

  it('lets people use only their own sessions', () => {
    expect(ownSession(adaPub, ADA, 'publish')).toEqual({ ok: true, value: adaPub });
    expect(ownSession(adaPub, BO, 'publish')).toMatchObject({ ok: false, status: 403, error: 'not_your_session' });
  });

  it('answers an unknown session exactly like someone else’s', () => {
    expect(ownSession(null, ADA)).toEqual(ownSession(adaPub, BO));
  });

  it('keeps publishing and receiving sessions apart', () => {
    expect(ownSession(adaPub, ADA, 'receive')).toMatchObject({ ok: false, status: 400 });
    expect(ownSession(adaPub, ADA)).toMatchObject({ ok: true });
  });
});

describe('publishing', () => {
  const body = (tracks: unknown[]) => ({ sessionId: 's-ada', offer: OFFER, tracks });

  it('takes tracks named <userId>:<kind>, with simulcast layers for video and screens', () => {
    const r = readPublish(body([{ mid: '0', trackName: `${ADA}:audio`, kind: 'audio' }, { mid: '1', trackName: `${ADA}:video`, kind: 'video', rids: ['q', 'f', 'h'] }]), ADA);
    expect(r).toEqual({
      ok: true,
      value: {
        sessionId: 's-ada',
        offer: OFFER,
        tracks: [
          { mid: '0', trackName: `${ADA}:audio`, kind: 'audio' },
          { mid: '1', trackName: `${ADA}:video`, kind: 'video', rids: ['f', 'h', 'q'] },
        ],
      },
    });
  });

  it('refuses publishing under someone else’s name', () => {
    expect(readPublish(body([{ mid: '0', trackName: `${BO}:video`, kind: 'video' }]), ADA)).toMatchObject({ ok: false, status: 403, error: 'not_your_track' });
    expect(readPublish(body([{ mid: '0', trackName: `${ADA}:audio`, kind: 'video' }]), ADA)).toMatchObject({ ok: false, status: 403, error: 'not_your_track' });
    expect(readPublish(body([{ mid: '0', trackName: 'camera', kind: 'video' }]), ADA)).toMatchObject({ ok: false, error: 'not_your_track' });
  });

  it('refuses bad shapes', () => {
    const bad = [
      body([]),
      body([{ mid: '0', trackName: `${ADA}:audio`, kind: 'audio', rids: ['f'] }]),
      body([{ mid: '0', trackName: `${ADA}:video`, kind: 'video', rids: ['x'] }]),
      body([{ mid: '0', trackName: `${ADA}:video`, kind: 'video', rids: ['f', 'f'] }]),
      body([{ mid: '0', trackName: `${ADA}:mic`, kind: 'mic' }]),
      body([{ mid: '0', trackName: `${ADA}:audio`, kind: 'audio' }, { mid: '0', trackName: `${ADA}:video`, kind: 'video' }]),
      body([{ mid: '0', trackName: `${ADA}:audio`, kind: 'audio' }, { mid: '1', trackName: `${ADA}:audio`, kind: 'audio' }]),
      body(Array.from({ length: 5 }, (_, i) => ({ mid: String(i), trackName: `${ADA}:audio`, kind: 'audio' }))),
      { sessionId: 's-ada', offer: ANSWER, tracks: [{ mid: '0', trackName: `${ADA}:audio`, kind: 'audio' }] },
      { sessionId: '../../apps', offer: OFFER, tracks: [{ mid: '0', trackName: `${ADA}:audio`, kind: 'audio' }] },
      null,
    ];
    for (const b of bad) expect(readPublish(b, ADA)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('receiving', () => {
  const pubs: PubRow[] = [
    { userId: ADA, sessionId: 's-ada', trackName: `${ADA}:video`, kind: 'video', rids: ['f', 'h', 'q'], mid: '1' },
    { userId: ADA, sessionId: 's-ada', trackName: `${ADA}:audio`, kind: 'audio', rids: [], mid: '0' },
  ];
  const find = (s: string, n: string) => pubs.find((p) => p.sessionId === s && p.trackName === n) ?? null;
  const req = (tracks: unknown[]) => {
    const r = readReceive({ sessionId: 's-bo', tracks });
    if (!r.ok) throw new Error(r.detail);
    return r.value;
  };

  it('only subscribes to publications in this room', () => {
    expect(checkReceive(req([{ publisherSessionId: 's-ada', trackName: `${ADA}:video` }]), find)).toMatchObject({ ok: true });
    expect(checkReceive(req([{ publisherSessionId: 's-elsewhere', trackName: `${ADA}:video` }]), find)).toMatchObject({ ok: false, status: 404, error: 'unknown_publication' });
    expect(checkReceive(req([{ publisherSessionId: 's-ada', trackName: `${ADA}:screen` }]), find)).toMatchObject({ ok: false, status: 404 });
    // One bad one refuses the whole call.
    expect(checkReceive(req([{ publisherSessionId: 's-ada', trackName: `${ADA}:audio` }, { publisherSessionId: 'x', trackName: 'y' }]), find)).toMatchObject({ ok: false, status: 404 });
  });

  it('picks the smallest layer unless asked, and only layers the publication has', () => {
    const r = checkReceive(req([{ publisherSessionId: 's-ada', trackName: `${ADA}:video` }, { publisherSessionId: 's-ada', trackName: `${ADA}:audio` }]), find);
    expect(r.ok && r.value.map((x) => x.rid)).toEqual(['q', null]);
    const f = checkReceive(req([{ publisherSessionId: 's-ada', trackName: `${ADA}:video`, rid: 'f' }]), find);
    expect(f.ok && f.value[0].rid).toBe('f');
    expect(checkReceive(req([{ publisherSessionId: 's-ada', trackName: `${ADA}:audio`, rid: 'f' }]), find)).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses bad shapes', () => {
    expect(readReceive({ sessionId: 's', tracks: [] })).toMatchObject({ ok: false });
    expect(readReceive({ sessionId: 's', tracks: [{ publisherSessionId: 's-ada' }] })).toMatchObject({ ok: false });
    expect(readReceive({ sessionId: 's', tracks: [{ publisherSessionId: 's-ada', trackName: 'a', rid: 'z' }] })).toMatchObject({ ok: false });
    expect(readReceive({ sessionId: 's', tracks: [{ publisherSessionId: 's-ada', trackName: 'a' }, { publisherSessionId: 's-ada', trackName: 'a' }] })).toMatchObject({ ok: false });
  });

  it('changes layers only on tracks received on that session, of publications still here', () => {
    const subs: SubRow[] = [{ sessionId: 's-bo', mid: '7', pubSessionId: 's-ada', trackName: `${ADA}:video`, rid: 'q' }, { sessionId: 's-bo', mid: '8', pubSessionId: 's-gone', trackName: 'x:video', rid: 'q' }];
    const findSub = (s: string, m: string) => subs.find((x) => x.sessionId === s && x.mid === m) ?? null;
    const layer = (tracks: unknown[], sessionId = 's-bo') => {
      const r = readLayer({ sessionId, tracks });
      if (!r.ok) throw new Error(r.detail);
      return r.value;
    };
    expect(checkLayer(layer([{ mid: '7', rid: 'f' }]), findSub, find)).toMatchObject({ ok: true });
    expect(checkLayer(layer([{ mid: '7', rid: 'f' }], 's-ada'), findSub, find)).toMatchObject({ ok: false, status: 404, error: 'unknown_track' });
    expect(checkLayer(layer([{ mid: '9', rid: 'f' }]), findSub, find)).toMatchObject({ ok: false, error: 'unknown_track' });
    expect(checkLayer(layer([{ mid: '8', rid: 'f' }]), findSub, find)).toMatchObject({ ok: false, error: 'unknown_publication' });
    expect(readLayer({ sessionId: 's', tracks: [{ mid: '7', rid: 'x' }] })).toMatchObject({ ok: false, status: 400 });
  });

  it('reads the other requests', () => {
    expect(readSession({ purpose: 'publish' })).toEqual({ ok: true, value: { purpose: 'publish' } });
    expect(readSession({ purpose: 'both' })).toMatchObject({ ok: false });
    expect(readRenegotiate({ sessionId: 's', answer: ANSWER })).toMatchObject({ ok: true });
    expect(readRenegotiate({ sessionId: 's', answer: OFFER })).toMatchObject({ ok: false });
    expect(readClose({ sessionId: 's', offer: OFFER, tracks: [{ mid: '0' }] })).toMatchObject({ ok: true });
    expect(readClose({ sessionId: 's', offer: OFFER, tracks: [] })).toMatchObject({ ok: false });
    expect(readClose({ sessionId: 's', offer: { type: 'offer', sdp: 'x'.repeat(200_001) }, tracks: [{ mid: '0' }] })).toMatchObject({ ok: false });
  });
});

describe('tickets', () => {
  const SECRET = 'test-secret-that-is-long-enough-for-hmac-0123456789';

  it('are signed for one room and expire', async () => {
    const nonce = newNonce();
    const ticket = await signTicket(SECRET, ROOM_ID, nonce, 2_000);
    expect(await readTicket(SECRET, ROOM_ID, ticket, 1_999)).toBe(nonce);
    expect(await readTicket(SECRET, ROOM_ID, ticket, 2_000)).toBeNull();
    expect(await readTicket(SECRET, ADA, ticket, 1_000)).toBeNull();
    expect(await readTicket('another-secret-entirely-xxxxxxxxxxxxxxxxxxxx', ROOM_ID, ticket, 1_000)).toBeNull();
  });

  it('can’t be altered', async () => {
    const nonce = newNonce();
    const ticket = await signTicket(SECRET, ROOM_ID, nonce, 9_000);
    const [n, e, s] = ticket.split('.');
    expect(await readTicket(SECRET, ROOM_ID, `${n}.${Number(e) + 1}.${s}`, 1)).toBeNull();
    expect(await readTicket(SECRET, ROOM_ID, `${newNonce()}.${e}.${s}`, 1)).toBeNull();
    expect(await readTicket(SECRET, ROOM_ID, `${n}.${e}.${s.slice(0, -2)}AA`, 1)).toBeNull();
    for (const junk of ['', 'a.b.c', `${n}.${e}`, `${ticket}.x`, 'x'.repeat(500)]) expect(await readTicket(SECRET, ROOM_ID, junk, 1)).toBeNull();
  });

  it('nonces are fresh', () => {
    expect(newNonce()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newNonce()).not.toBe(newNonce());
  });
});

describe('what the database answers', () => {
  const raw = {
    room_id: ROOM_ID.toUpperCase(),
    user_id: ADA,
    name: '  Ada  ',
    role: 'host',
    state: 'in',
    can_edit: true,
    live: true,
    max_people: 4,
    ends_at: '2026-11-07T18:00:00+00:00',
    assignment_id: 'x',
    host_id: ADA,
    title: 'T',
    class_room: false,
    edit_mode: 'everyone',
  };

  it('reads study_room_access', () => {
    expect(parseAccess(raw, ROOM_ID, 1234)).toEqual({
      roomId: ROOM_ID,
      userId: ADA,
      name: 'Ada',
      role: 'host',
      state: 'in',
      canEdit: true,
      live: true,
      maxPeople: 4,
      endsAt: Date.parse('2026-11-07T18:00:00Z'),
      editMode: 'everyone',
      classRoom: false,
      checkedAt: 1234,
    });
    expect(parseAccess({ ...raw, ends_at: null }, ROOM_ID)?.endsAt).toBeNull();
  });

  it('refuses an answer for another room, or one it can’t read', () => {
    expect(parseAccess(raw, BO)).toBeNull();
    expect(parseAccess({ ...raw, role: 'owner' }, ROOM_ID)).toBeNull();
    expect(parseAccess({ ...raw, user_id: 'me' }, ROOM_ID)).toBeNull();
    expect(parseAccess({ ...raw, max_people: '4' }, ROOM_ID)).toBeNull();
    expect(parseAccess(null, ROOM_ID)).toBeNull();
  });

  it('reads the roster', () => {
    const roster = parseRoster({ live: true, ends_at: null, max_people: 10, edit_mode: 'chosen', assignment_id: 'a', host_id: ADA, members: [{ user_id: BO, name: 'Bo', role: 'member', state: 'removed', can_edit: false }] });
    expect(roster).toEqual({ live: true, endsAt: null, maxPeople: 10, editMode: 'chosen', members: { [BO]: { name: 'Bo', role: 'member', state: 'removed', canEdit: false } } });
    expect(parseRoster({ live: true, max_people: 10, edit_mode: 'chosen', members: [{ user_id: BO, role: 'x', state: 'in' }] })).toBeNull();
  });
});

describe('Cloudflare Realtime requests', () => {
  function recorder(answer: unknown = {}, status = 200) {
    const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method!, auth: new Headers(init.headers).get('authorization'), body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(answer), { status });
    }) as typeof fetch;
    return { calls, f };
  }

  it('sends the SFU the documented requests, with the app secret', async () => {
    const { calls, f } = recorder({ sessionId: 'abc', tracks: [] });
    const sfu = new SfuClient('https://rtc.example/v1/', 'app-1', 'app-secret', f);
    expect(await sfu.newSession()).toBe('abc');
    await sfu.addTracks('abc', { sessionDescription: { type: 'offer', sdp: 'o' }, tracks: [{ location: 'local', mid: '0', trackName: 'u:video' }] });
    await sfu.addTracks('abc', { tracks: [{ location: 'remote', sessionId: 'p', trackName: 'u:video', simulcast: { preferredRid: 'q', priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' } }] });
    await sfu.renegotiate('abc', { type: 'answer', sdp: 'a' });
    await sfu.updateTracks('abc', [{ location: 'remote', sessionId: 'p', trackName: 'u:video', mid: '3', simulcast: { preferredRid: 'f' } }]);
    await sfu.closeTracks('abc', ['3'], { offer: { type: 'offer', sdp: 'o2' } });
    await sfu.closeTracks('abc', ['0', '1'], { force: true });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://rtc.example/v1/apps/app-1/sessions/new',
      'POST https://rtc.example/v1/apps/app-1/sessions/abc/tracks/new',
      'POST https://rtc.example/v1/apps/app-1/sessions/abc/tracks/new',
      'PUT https://rtc.example/v1/apps/app-1/sessions/abc/renegotiate',
      'PUT https://rtc.example/v1/apps/app-1/sessions/abc/tracks/update',
      'PUT https://rtc.example/v1/apps/app-1/sessions/abc/tracks/close',
      'PUT https://rtc.example/v1/apps/app-1/sessions/abc/tracks/close',
    ]);
    expect(calls.every((c) => c.auth === 'Bearer app-secret')).toBe(true);
    expect(calls[0].body).toBeUndefined();
    expect(calls[3].body).toEqual({ sessionDescription: { type: 'answer', sdp: 'a' } });
    expect(calls[5].body).toEqual({ tracks: [{ mid: '3' }], sessionDescription: { type: 'offer', sdp: 'o2' }, force: false });
    expect(calls[6].body).toEqual({ tracks: [{ mid: '0' }, { mid: '1' }], force: true });
  });

  it('turns SFU refusals and failures into errors', async () => {
    const refused = new SfuClient('https://x/v1', 'a', 's', recorder({ errorCode: 'session_error', errorDescription: 'nope' }, 406).f);
    await expect(refused.renegotiate('s', { type: 'answer', sdp: '' })).rejects.toMatchObject({ status: 406, code: 'session_error', refused: true });
    const errorIn200 = new SfuClient('https://x/v1', 'a', 's', recorder({ errorCode: 'invalid_request' }).f);
    await expect(errorIn200.addTracks('s', { tracks: [] })).rejects.toBeInstanceOf(SfuError);
    const down = new SfuClient('https://x/v1', 'a', 's', (async () => {
      throw new TypeError('connection refused');
    }) as typeof fetch);
    await expect(down.newSession()).rejects.toMatchObject({ status: 0, refused: false });
  });

  it('asks TURN for a day of credentials and drops port 53', async () => {
    const { calls, f } = recorder(
      {
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
          {
            urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp', 'turn:turn.cloudflare.com:53?transport=tcp'],
            username: 'u',
            credential: 'c',
          },
        ],
      },
      201,
    );
    const servers = await turnCredentials('https://rtc.example/v1', 'key-1', 'key-token', ROOM.turnTtlSeconds, f);
    expect(calls[0]).toEqual({ url: 'https://rtc.example/v1/turn/keys/key-1/credentials/generate-ice-servers', method: 'POST', auth: 'Bearer key-token', body: { ttl: 86_400 } });
    expect(servers).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
    ]);
    expect(withoutPort53([{ urls: 'turn:x:53' }, { urls: 'turn:x:5349' }])).toEqual([{ urls: ['turn:x:5349'] }]);
  });
});

describe('rate limits', () => {
  it('allow so many in a window, then again after it', () => {
    const limits = new RateLimits();
    expect([1, 2, 3].map((t) => limits.take('chat:a', 2, 10, t))).toEqual([true, true, false]);
    expect(limits.take('chat:b', 2, 10, 3)).toBe(true);
    expect(limits.take('chat:a', 2, 10, 12)).toBe(true);
  });
});
