// The room server end to end: `wrangler dev` (local) runs the real Worker and Durable Object, with
// Supabase, the study-rooms function, the SFU and TURN played by small mock servers, and room
// clients talking to it over real WebSockets with real Yjs documents.
//
//   npm run test:rooms
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join as joinPath, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CLOSE, YDOC, type Publication } from '../../shared/rooms';
import { api, RoomClient, ticket } from './client';
import { Mock, type MockMember, type MockRoom } from './mock';

const ROOT = resolve(__dirname, '../..');
const secret = () => randomBytes(24).toString('hex');
const SETTINGS = { anon: 'test-anon-key', roomSecret: secret(), appId: 'test-app', appSecret: secret(), turnKey: 'test-turn-key', turnToken: secret() };

const person = (name: string, role: MockMember['role'], canEdit: boolean, state: MockMember['state'] = 'in'): MockMember => ({
  token: `token-${name.toLowerCase()}-${randomUUID()}`,
  userId: randomUUID(),
  name,
  role,
  state,
  canEdit,
});

// Room A: the main room. Editing is for chosen people: the host, Ada; not Vic (yet).
const H = person('Hana', 'host', true);
const A = person('Ada', 'member', true);
const V = person('Vic', 'member', false);
const X = person('Xen', 'member', true); // taken out later
const P = person('Pat', 'member', false); // publishes, then leaves
const W = person('Wren', 'member', false, 'waiting');
const roomA: MockRoom = { id: randomUUID(), live: true, maxPeople: 6, endsAt: null, editMode: 'chosen', members: [H, A, V, X, P, W] };
// Room B: two people at most.
const B1 = person('Bea', 'host', true);
const B2 = person('Ben', 'member', true);
const B3 = person('Bo', 'member', true);
const roomB: MockRoom = { id: randomUUID(), live: true, maxPeople: 2, endsAt: null, editMode: 'everyone', members: [B1, B2, B3] };
// Room C: a free room whose time is nearly up.
const C1 = person('Cal', 'host', true);
const roomC: MockRoom = { id: randomUUID(), live: true, maxPeople: 4, endsAt: null, editMode: 'everyone', members: [C1] };
// Room D: already ended.
const D1 = person('Dee', 'host', true);
const roomD: MockRoom = { id: randomUUID(), live: false, maxPeople: 4, endsAt: null, editMode: 'everyone', members: [D1] };

const DOC_ID = randomUUID();
const CODE_ID = randomUUID();
const SHEET_ID = randomUUID();
const NOTE_ID = randomUUID();
const TASK_ID = randomUUID();
const NEW_NOTE_ID = randomUUID();

let mock: Mock;
let wrangler: ChildProcess | null = null;
let base = '';
let state = '';
let log = '';
const clients: RoomClient[] = [];

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => done(port));
    });
  });
}

async function join(name: string, room: MockRoom, who: MockMember): Promise<RoomClient> {
  const c = await RoomClient.join(name, base, room.id, who.token);
  clients.push(c);
  return c;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventually<T>(what: string, check: () => T | undefined | null | false, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await wait(100);
  }
}

const text = (c: RoomClient, id = CODE_ID) => c.doc.getText(YDOC.code(id)).toString();
const pubsOf = (c: RoomClient) => c.all('pubs').at(-1)?.publications ?? [];

/** Fills the room the way the seeder does: every type in one transaction, with room.seeded. */
function seed(c: RoomClient, opts: { docId?: string; codeId?: string } = {}): void {
  const doc = c.doc;
  doc.transact(() => {
    const docs = doc.getMap(YDOC.documents);
    const entry = (fields: Record<string, unknown>) => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(fields)) m.set(k, v);
      return m;
    };
    const docId = opts.docId ?? DOC_ID;
    const codeId = opts.codeId ?? CODE_ID;
    docs.set(docId, entry({ kind: 'doc', title: 'Essay', sort: 0 }));
    docs.set(codeId, entry({ kind: 'code', title: 'main.py', sort: 1, lang: 'python' }));
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    p.insert(0, [t]);
    doc.getXmlFragment(YDOC.doc(docId)).insert(0, [p]);
    t.insert(0, 'Cities need water.');
    doc.getText(YDOC.code(codeId)).insert(0, 'print("hi")\n');
    if (!opts.docId) {
      docs.set(SHEET_ID, entry({ kind: 'sheet', title: 'Budget', sort: 2, header: true }));
      const rows = doc.getArray<Y.Array<string>>(YDOC.sheet(SHEET_ID));
      for (const r of [['Item', 'Cost'], ['Pens', '2'], ['Total', '=SUM(B2:B2)']]) {
        const row = new Y.Array<string>();
        row.push(r);
        rows.push([row]);
      }
      doc.getArray(YDOC.notes).push([entry({ id: NOTE_ID, body: 'Read chapter 2', pinned: true })]);
      doc.getArray(YDOC.tasks).push([entry({ id: TASK_ID, title: 'Outline', due_on: '2026-11-20', done: false })]);
    }
    doc.getMap(YDOC.room).set('seeded', true);
  });
  c.send({ t: 'seeded' });
}

beforeAll(async () => {
  mock = new Mock(SETTINGS.anon, SETTINGS.roomSecret, SETTINGS.appId, SETTINGS.appSecret, SETTINGS.turnKey, SETTINGS.turnToken);
  for (const r of [roomA, roomB, roomC, roomD]) mock.addRoom(r);
  await mock.start();

  if (!existsSync(joinPath(ROOT, 'dist', 'index.html'))) execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });

  state = mkdtempSync(joinPath(tmpdir(), 'chip-study-rooms-'));
  const env = joinPath(state, 'test.env');
  writeFileSync(
    env,
    [
      `SUPABASE_URL=${mock.url}`,
      `SUPABASE_ANON_KEY=${SETTINGS.anon}`,
      `ROOM_SERVICE_URL=${mock.url}/functions/v1/study-rooms`,
      `ROOM_SERVER_SECRET=${SETTINGS.roomSecret}`,
      `REALTIME_APP_ID=${SETTINGS.appId}`,
      `REALTIME_APP_SECRET=${SETTINGS.appSecret}`,
      `TURN_KEY_ID=${SETTINGS.turnKey}`,
      `TURN_KEY_API_TOKEN=${SETTINGS.turnToken}`,
      `REALTIME_API_BASE=${mock.url}/sfu/v1`,
      `TURN_API_BASE=${mock.url}/turn/v1`,
      '',
    ].join('\n'),
  );
  const port = await freePort();
  const inspector = await freePort();
  base = `http://127.0.0.1:${port}`;
  wrangler = spawn(
    'npx',
    ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--persist-to', joinPath(state, 'state'), '--env-file', env, '--show-interactive-dev-session=false', '--log-level', 'log'],
    { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  wrangler.stdout!.on('data', (d: Buffer) => (log += d.toString()));
  wrangler.stderr!.on('data', (d: Buffer) => (log += d.toString()));
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/`)).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline || wrangler.exitCode !== null) throw new Error(`wrangler dev did not start:\n${log}`);
    await wait(250);
  }
}, 180_000);

afterAll(async () => {
  for (const c of clients) c.close();
  if (wrangler && wrangler.exitCode === null) {
    wrangler.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (wrangler.exitCode === null) wrangler.kill('SIGKILL');
  }
  await mock?.stop();
  if (state) rmSync(state, { recursive: true, force: true });
  // ROOMS_TEST_LOG=<file> keeps wrangler's output (the Worker's own logs included) for a look.
  if (process.env.ROOMS_TEST_LOG) writeFileSync(process.env.ROOMS_TEST_LOG, log);
});

describe('the room server', () => {
  let h: RoomClient;
  let a: RoomClient;
  let v: RoomClient;
  let x: RoomClient;
  let c1: RoomClient;
  let seededAt = 0;
  let sessionH = '';
  let sessionX = '';
  let sessionXr = '';
  let sessionP = '';
  let pLeftAt = 0;

  it('still serves the app exactly as before', async () => {
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toContain('text/html');
    const deep = await fetch(`${base}/app/assignments/some-id`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('<div id="root"');
    const icon = await fetch(`${base}/favicon.svg`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toContain('svg');
    expect((await api(base, '/api/nope', null)).json).toEqual({ error: 'not_found' });
    expect((await api(base, `/api/rooms/not-a-uuid/ticket`, H.token, { method: 'POST' })).status).toBe(404);
  });

  it('refuses anyone who isn’t in the room', async () => {
    const path = `/api/rooms/${roomA.id}/ticket`;
    expect(await api(base, path, null, { method: 'POST' })).toMatchObject({ status: 401, json: { error: 'unauthorized' } });
    expect(await api(base, path, 'not-a-real-token', { method: 'POST' })).toMatchObject({ status: 401, json: { error: 'unauthorized' } });
    expect(await api(base, path, 'outsider-token', { method: 'POST' })).toMatchObject({ status: 403, json: { error: 'not_in_room' } });
    expect(await api(base, path, W.token, { method: 'POST' })).toMatchObject({ status: 403, json: { error: 'not_in_room', state: 'waiting' } });
    expect(await api(base, path, D1.token, { method: 'POST' })).toMatchObject({ status: 403 }); // D1 isn't in room A
    expect(await api(base, `/api/rooms/${roomD.id}/ticket`, D1.token, { method: 'POST' })).toMatchObject({ status: 410, json: { error: 'ended' } });
    expect(await api(base, path, H.token)).toMatchObject({ status: 405 });
    expect((await fetch(`${base}/api/rooms/${roomA.id}/ws?ticket=x`)).status).toBe(426);
    // A made-up ticket is turned away before it reaches the room.
    const junk = new WebSocket(`${base.replace('http', 'ws')}/api/rooms/${roomA.id}/ws?ticket=made.up.ticket`);
    const opened = await new Promise<boolean>((r) => {
      junk.addEventListener('open', () => r(true));
      junk.addEventListener('error', () => r(false));
    });
    expect(opened).toBe(false);
  });

  it('gives TURN credentials without the port 53 URLs', async () => {
    const r = await api(base, `/api/rooms/${roomA.id}/turn`, H.token);
    expect(r.status).toBe(200);
    const servers = r.json.iceServers as { urls: string[]; username?: string }[];
    expect(servers.flatMap((s) => s.urls).some((u) => /:53(\?|$)/.test(u))).toBe(false);
    expect(servers.flatMap((s) => s.urls)).toContain('turns:turn.cloudflare.com:443?transport=tcp');
    expect(servers[1].username).toBe('mock-user');
  });

  it('starts a free room that is nearly over (its end is checked later)', async () => {
    roomC.endsAt = new Date(Date.now() + 14_000).toISOString();
    c1 = await join('Cal', roomC, C1);
    const hello = await c1.next('hello');
    expect(hello.endsAt).toBe(Date.parse(roomC.endsAt));
    await c1.next('ending'); // inside the last five minutes from the start
    await c1.next('seed');
    seed(c1, { docId: randomUUID(), codeId: randomUUID() });
    await c1.until('the seeded room', () => c1.doc.getMap(YDOC.room).get('seeded') === true);
  });

  it('asks the first editor to seed, and passes everyone’s edits around', async () => {
    h = await join('Hana', roomA, H);
    const hello = h.messages[0];
    expect(hello).toMatchObject({ t: 'hello', you: { userId: H.userId, name: 'Hana', role: 'host', canEdit: true }, seeded: false, editMode: 'chosen', endsAt: null, publications: [], chat: [] });
    await h.next('seed');

    a = await join('Ada', roomA, A);
    v = await join('Vic', roomA, V);
    expect(v.messages[0]).toMatchObject({ t: 'hello', you: { canEdit: false, role: 'member' } });
    expect(a.all('seed')).toHaveLength(0); // one seeder at a time

    seed(h);
    seededAt = Date.now();
    await a.until('the seeded document', () => text(a) === 'print("hi")\n');
    await v.until('the seeded document', () => text(v) === 'print("hi")\n');
    expect(v.doc.getXmlFragment(YDOC.doc(DOC_ID)).toString()).toContain('Cities need water.');
    expect(h.all('error')).toEqual([]); // {t: "seeded"} was accepted

    h.doc.getText(YDOC.code(CODE_ID)).insert(0, '# by Hana\n');
    await a.until('Hana’s edit', () => text(a).startsWith('# by Hana'));
    await v.until('Hana’s edit', () => text(v).startsWith('# by Hana'));
    a.doc.getText(YDOC.code(CODE_ID)).insert(text(a).length, '# by Ada\n');
    await h.until('Ada’s edit', () => text(h).endsWith('# by Ada\n'));
    const note = new Y.Map<unknown>();
    note.set('id', NEW_NOTE_ID);
    note.set('body', 'Ada’s new note');
    note.set('pinned', false);
    a.doc.getArray(YDOC.notes).push([note]);
    await h.until('Ada’s note', () => h.doc.getArray(YDOC.notes).length === 2);
  });

  it('drops a viewer’s edit and tells them once', async () => {
    v.doc.getText(YDOC.code(CODE_ID)).insert(0, 'VIEWER WAS HERE ');
    await v.next('readonly');
    v.doc.getText(YDOC.code(CODE_ID)).insert(0, 'AGAIN ');
    await wait(400);
    expect(v.all('readonly')).toHaveLength(1);
    expect(text(h)).not.toContain('VIEWER');
    expect(text(a)).not.toContain('VIEWER');
    const fresh = await join('Ada again', roomA, A); // a second tab syncs from the room
    await fresh.until('the room’s document', () => text(fresh).startsWith('# by Hana'));
    expect(text(fresh)).not.toContain('VIEWER');
    fresh.close();
  });

  it('relays cursors with the verified person, whatever the client claims', async () => {
    a.awareness.setLocalState({ user: { id: H.userId, name: 'Not Ada', color: '#123456' }, cursor: { anchor: 3 } });
    const seen = await h.until('Ada’s cursor', () => h.awareness.getStates().get(a.doc.clientID));
    expect(seen).toEqual({ user: { id: A.userId, name: 'Ada', color: '#123456' }, cursor: { anchor: 3 } });
  });

  it('carries chat and hands', async () => {
    a.send({ t: 'chat', text: '  Shall we start with the outline?  ' });
    for (const c of [h, a, v]) {
      const m = await c.next('chat');
      expect(m).toMatchObject({ from: { userId: A.userId, name: 'Ada' }, text: 'Shall we start with the outline?' });
      expect(typeof m.id).toBe('string');
    }
    a.send({ t: 'chat', text: 'x'.repeat(2_001) });
    await a.next('error', (m) => m.code === 'too_long');
    a.send({ t: 'hand', up: true });
    await v.next('hand', (m) => m.userId === A.userId && m.up);
    a.send({ t: 'chat', text: 'Second message' });
    a.ws.send('{"t":"dance"}');
    await a.next('error', (m) => m.code === 'bad_message');
    const late = await join('Ada third tab', roomA, A);
    const hello = late.messages[0] as Extract<(typeof late.messages)[number], { t: 'hello' }>;
    expect(hello.chat.map((m) => m.text)).toEqual(['Shall we start with the outline?', 'Second message']);
    expect(hello.hands).toEqual([A.userId]);
    expect(hello.people.find((p) => p.userId === A.userId)).toMatchObject({ hand: true, connected: true, canEdit: true });
    late.close();
  });

  it('keeps SFU sessions and publications to their owners', async () => {
    const rtc = (who: MockMember, op: string, body: unknown) => api(base, `/api/rooms/${roomA.id}/rtc/${op}`, who.token, { body });

    const s = await rtc(H, 'session', { purpose: 'publish' });
    expect(s.status).toBe(200);
    sessionH = String(s.json.sessionId);
    const published = await rtc(H, 'publish', {
      sessionId: sessionH,
      offer: { type: 'offer', sdp: 'v=0\r\n' },
      tracks: [
        { mid: '0', trackName: `${H.userId}:audio`, kind: 'audio' },
        { mid: '1', trackName: `${H.userId}:video`, kind: 'video', rids: ['f', 'h', 'q'] },
      ],
    });
    expect(published).toMatchObject({ status: 200, json: { answer: { type: 'answer' }, tracks: [{ mid: '0' }, { mid: '1' }] } });
    const pubs = await v.until('two publications', () => pubsOf(v).length === 2 && pubsOf(v));
    expect(pubs).toEqual(
      expect.arrayContaining<Publication>([
        { userId: H.userId, sessionId: sessionH, trackName: `${H.userId}:audio`, kind: 'audio', rids: [] },
        { userId: H.userId, sessionId: sessionH, trackName: `${H.userId}:video`, kind: 'video', rids: ['f', 'h', 'q'] },
      ]),
    );

    const r = await rtc(A, 'session', { purpose: 'receive' });
    const sessionA = String(r.json.sessionId);
    const received = await rtc(A, 'receive', { sessionId: sessionA, tracks: [{ publisherSessionId: sessionH, trackName: `${H.userId}:video` }] });
    expect(received).toMatchObject({ status: 200, json: { offer: { type: 'offer' }, requiresImmediateRenegotiation: true, tracks: [{ publisherSessionId: sessionH, trackName: `${H.userId}:video` }] } });
    const mid = String((received.json.tracks as { mid: string }[])[0].mid);
    const pull = mock.sfuCalls.findLast((c) => c.path.endsWith(`/sessions/${sessionA}/tracks/new`))!;
    expect(pull.body).toEqual({ tracks: [{ location: 'remote', sessionId: sessionH, trackName: `${H.userId}:video`, simulcast: { preferredRid: 'q', priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' } }] });
    expect(await rtc(A, 'renegotiate', { sessionId: sessionA, answer: { type: 'answer', sdp: 'v=0\r\n' } })).toMatchObject({ status: 200, json: {} });
    expect(await rtc(A, 'layer', { sessionId: sessionA, tracks: [{ mid, rid: 'f' }] })).toMatchObject({ status: 200, json: { tracks: [{ mid }] } });
    expect(mock.sfuCalls.at(-1)!.body).toEqual({ tracks: [{ location: 'remote', sessionId: sessionH, trackName: `${H.userId}:video`, mid, simulcast: { preferredRid: 'f', priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' } }] });

    // Refused, without the SFU ever being asked:
    const calls = mock.sfuCalls.length;
    expect(await rtc(A, 'receive', { sessionId: sessionH, tracks: [{ publisherSessionId: sessionH, trackName: `${H.userId}:video` }] })).toMatchObject({ status: 403, json: { error: 'not_your_session' } });
    expect(await rtc(A, 'renegotiate', { sessionId: sessionH, answer: { type: 'answer', sdp: 'v=0\r\n' } })).toMatchObject({ status: 403, json: { error: 'not_your_session' } });
    expect(await rtc(A, 'close', { sessionId: sessionH, offer: { type: 'offer', sdp: 'v=0\r\n' }, tracks: [{ mid: '1' }] })).toMatchObject({ status: 403 });
    expect(await rtc(A, 'receive', { sessionId: 'f00d', tracks: [{ publisherSessionId: sessionH, trackName: `${H.userId}:video` }] })).toMatchObject({ status: 403 });
    expect(await rtc(A, 'receive', { sessionId: sessionA, tracks: [{ publisherSessionId: sessionH, trackName: `${H.userId}:screen` }] })).toMatchObject({ status: 404, json: { error: 'unknown_publication' } });
    expect(await rtc(A, 'receive', { sessionId: sessionA, tracks: [{ publisherSessionId: 'deadbeef', trackName: `${H.userId}:video` }] })).toMatchObject({ status: 404 });
    expect(await rtc(A, 'layer', { sessionId: sessionA, tracks: [{ mid: '999', rid: 'h' }] })).toMatchObject({ status: 404, json: { error: 'unknown_track' } });
    const ownPublish = String((await rtc(A, 'session', { purpose: 'publish' })).json.sessionId);
    const afterSession = mock.sfuCalls.length;
    expect(await rtc(A, 'publish', { sessionId: ownPublish, offer: { type: 'offer', sdp: 'v=0\r\n' }, tracks: [{ mid: '0', trackName: `${H.userId}:video`, kind: 'video' }] })).toMatchObject({ status: 403, json: { error: 'not_your_track' } });
    expect(await rtc(A, 'publish', { sessionId: sessionA, offer: { type: 'offer', sdp: 'v=0\r\n' }, tracks: [{ mid: '0', trackName: `${A.userId}:audio`, kind: 'audio' }] })).toMatchObject({ status: 400 });
    expect(mock.sfuCalls.length).toBe(afterSession);
    expect(afterSession).toBe(calls + 1); // only the session A made for itself

    // Xen publishes and receives; Pat publishes and then leaves.
    x = await join('Xen', roomA, X);
    sessionX = String((await rtc(X, 'session', { purpose: 'publish' })).json.sessionId);
    expect((await rtc(X, 'publish', { sessionId: sessionX, offer: { type: 'offer', sdp: 'v=0\r\n' }, tracks: [{ mid: '0', trackName: `${X.userId}:video`, kind: 'video', rids: ['h', 'q'] }] })).status).toBe(200);
    sessionXr = String((await rtc(X, 'session', { purpose: 'receive' })).json.sessionId);
    expect((await rtc(X, 'receive', { sessionId: sessionXr, tracks: [{ publisherSessionId: sessionH, trackName: `${H.userId}:audio` }] })).status).toBe(200);

    const p = await join('Pat', roomA, P);
    sessionP = String((await rtc(P, 'session', { purpose: 'publish' })).json.sessionId);
    expect((await rtc(P, 'publish', { sessionId: sessionP, offer: { type: 'offer', sdp: 'v=0\r\n' }, tracks: [{ mid: '0', trackName: `${P.userId}:audio`, kind: 'audio' }] })).status).toBe(200);
    await h.until('Pat’s publication', () => pubsOf(h).some((x) => x.userId === P.userId));
    p.close();
    pLeftAt = Date.now();

    // Hana stops her microphone: the publication leaves discovery.
    const closed = await rtc(H, 'close', { sessionId: sessionH, offer: { type: 'offer', sdp: 'v=0\r\n' }, tracks: [{ mid: '0' }] });
    expect(closed).toMatchObject({ status: 200, json: { answer: { type: 'answer' }, tracks: [{ mid: '0' }] } });
    await a.until('Hana’s audio gone', () => !pubsOf(a).some((x) => x.trackName === `${H.userId}:audio`) && pubsOf(a).some((x) => x.trackName === `${H.userId}:video`));
  });

  it('lets only hosts send host messages', async () => {
    a.send({ t: 'mute-all' });
    await a.next('error', (m) => m.code === 'not_allowed');
    a.send({ t: 'perm' });
    a.send({ t: 'end' });
    await a.until('three refusals', () => a.all('error').filter((m) => m.code === 'not_allowed').length === 3);
    // A host's end before the database has ended the room (study_room_end) is refused.
    h.send({ t: 'end' });
    await h.next('error', (m) => m.code === 'still_live');
    expect(h.all('ended')).toHaveLength(0);
    h.send({ t: 'mute-all' });
    await a.next('mute-request', (m) => m.by === H.userId);
    await v.next('mute-request');
    expect(h.all('mute-request')).toHaveLength(0);
  });

  it('relays Chip from the asker only', async () => {
    a.send({ t: 'chip-ask', id: 'q1', text: 'What is a thesis statement?' });
    await v.next('chip', (m) => m.id === 'q1' && m.question === 'What is a thesis statement?' && m.answer === '' && !m.done);
    a.send({ t: 'chip-chunk', id: 'q1', text: 'A thesis statement is' });
    await h.next('chip', (m) => m.id === 'q1' && m.answer === 'A thesis statement is');
    v.send({ t: 'chip-chunk', id: 'q1', text: 'hijacked' });
    await v.next('error', (m) => m.code === 'not_yours');
    await wait(300);
    a.send({ t: 'chip-done', id: 'q1', text: 'A thesis statement is the main claim of your essay.' });
    const done = await h.next('chip', (m) => m.id === 'q1' && m.done);
    expect(done).toMatchObject({ from: { userId: A.userId, name: 'Ada' }, answer: 'A thesis statement is the main claim of your essay.' });
    expect(h.all('chip').some((m) => m.answer === 'hijacked')).toBe(false);
  });

  it('applies permission changes when a host sends perm', async () => {
    V.canEdit = true;
    h.send({ t: 'perm' });
    await v.next('you', (m) => m.canEdit && m.role === 'member');
    await h.next('people', (m) => m.people.some((p) => p.userId === V.userId && p.canEdit));
    // Vic's old copy holds the edit that was dropped, so (like the screens) Vic starts afresh.
    v.close();
    v = await join('Vic', roomA, V);
    expect(v.messages[0]).toMatchObject({ you: { canEdit: true } });
    await v.until('the room’s document', () => text(v).startsWith('# by Hana'));
    v.doc.getText(YDOC.code(CODE_ID)).insert(0, '# by Vic\n');
    await h.until('Vic’s edit', () => text(h).startsWith('# by Vic'));
    expect(v.all('readonly')).toHaveLength(0);
  });

  it('disconnects someone taken out, and closes their tracks at the SFU', async () => {
    X.state = 'removed';
    h.send({ t: 'perm' });
    await x.next('ended', (m) => m.why === 'removed');
    expect((await x.closed).code).toBe(CLOSE.removed);
    await h.until('Xen’s publication gone', () => !pubsOf(h).some((p) => p.userId === X.userId));
    await eventually('force closes for Xen', () => mock.forceCloses().get(sessionX)?.includes('0') && mock.forceCloses().get(sessionXr)?.length === 1);
    expect(await api(base, `/api/rooms/${roomA.id}/ticket`, X.token, { method: 'POST' })).toMatchObject({ status: 403, json: { state: 'removed' } });
    const people = h.all('people').at(-1)!.people;
    expect(people.some((p) => p.userId === X.userId)).toBe(false);
  });

  it('uses each ticket once', async () => {
    const t = await ticket(base, roomA.id, A.token);
    const first = await RoomClient.open('Ada once', base, roomA.id, t);
    clients.push(first);
    await first.next('hello');
    const again = await RoomClient.open('Ada twice', base, roomA.id, t);
    await again.next('error', (m) => m.code === 'bad_ticket');
    expect((await again.closed).code).toBe(CLOSE.badTicket);
    first.close();
  });

  it('hands seeding on when the seeder leaves, and keeps to max_people', async () => {
    // Media is for people in the room: no SFU session without an open socket.
    expect(await api(base, `/api/rooms/${roomB.id}/rtc/session`, B3.token, { body: { purpose: 'receive' } })).toMatchObject({ status: 409, json: { error: 'not_connected' } });
    const b1 = await join('Bea', roomB, B1);
    await b1.next('seed');
    const b2 = await join('Ben', roomB, B2);
    expect(b2.all('seed')).toHaveLength(0);
    b1.close();
    await b2.next('seed');
    expect(await api(base, `/api/rooms/${roomB.id}/ticket`, B3.token, { method: 'POST' })).toMatchObject({ status: 200 }); // one connected: room for one more
    const b1again = await join('Bea again', roomB, B1);
    expect(await api(base, `/api/rooms/${roomB.id}/ticket`, B3.token, { method: 'POST' })).toMatchObject({ status: 409, json: { error: 'room_full' } });
    const secondTab = await join('Ben second tab', roomB, B2); // already connected: always fits
    expect(secondTab.messages[0]).toMatchObject({ t: 'hello' });

    // Ben seeds and edits; when everyone leaves, the room saves at once.
    const saves = mock.saves.length;
    const docId = randomUUID();
    seed(b2, { docId, codeId: randomUUID() });
    await b1again.until('the seeded room', () => b1again.doc.getMap(YDOC.room).get('seeded') === true);
    // A second filling (say Bea was asked too, and slow) is refused, so nothing is doubled.
    const otherDoc = randomUUID();
    seed(b1again, { docId: otherDoc, codeId: randomUUID() });
    await b1again.next('error', (m) => m.code === 'already_seeded');
    await wait(300);
    expect(b2.doc.getMap(YDOC.documents).has(otherDoc)).toBe(false);
    b1again.close();
    const bea = await join('Bea, afresh', roomB, B1); // as a screen does after already_seeded
    await bea.until('the room’s document', () => bea.doc.getMap(YDOC.documents).has(docId));
    expect(bea.doc.getMap(YDOC.documents).has(otherDoc)).toBe(false);
    const frag = b2.doc.getXmlFragment(YDOC.doc(docId));
    ((frag.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'Edited. ');
    await bea.until('Ben’s edit', () => bea.doc.getXmlFragment(YDOC.doc(docId)).toString().includes('Edited.'));
    for (const c of [bea, b2, secondTab]) c.close();
    const save = await eventually('the save when the last person left', () => mock.saves.slice(saves).find((s) => s.room_id === roomB.id));
    expect(save.documents).toEqual([
      {
        id: docId,
        kind: 'doc',
        title: 'Essay',
        sort: 0,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited. Cities need water.' }] }] },
        text: 'Edited. Cities need water.',
        words: 4,
      },
    ]);
    expect(save.notes).toBeUndefined(); // unchanged since seeding: never sent
  });

  it('saves about every 20 seconds while there are changes, in the editors’ formats', async () => {
    const save = await eventually('the first save of room A', () => mock.saves.find((s) => s.room_id === roomA.id), 40_000);
    const savedAt = Date.now();
    expect(savedAt - seededAt).toBeGreaterThanOrEqual(19_000);
    expect(save.action).toBe('save');
    // Only what changed since seeding: the code document and the notes. The essay, the sheet and
    // the tasks weren't touched, so they aren't sent.
    const docs = save.documents as { id: string; content: { code: string }; text: string }[];
    expect(docs.map((d) => d.id)).toEqual([CODE_ID]);
    expect(docs[0]).toMatchObject({ id: CODE_ID, kind: 'code', title: 'main.py', sort: 1, words: 0, content: { lang: 'python' } });
    expect(docs[0].content.code).toContain('# by Hana\n');
    expect(docs[0].content.code).toContain('# by Ada\n');
    expect(docs[0].content.code).not.toContain('VIEWER');
    expect(docs[0].text).toBe(docs[0].content.code);
    expect(save.notes).toEqual([
      { id: NOTE_ID, body: 'Read chapter 2', pinned: true },
      { id: NEW_NOTE_ID, body: 'Ada’s new note', pinned: false },
    ]);
    expect(save.tasks).toBeUndefined();
  });

  it('drops a departed person’s publications 30 seconds after they leave', async () => {
    await h.until('Pat’s publication gone', () => !pubsOf(h).some((p) => p.userId === P.userId), Math.max(1_000, pLeftAt + 40_000 - Date.now()));
    expect(Date.now() - pLeftAt).toBeGreaterThanOrEqual(29_000);
    await eventually('the force close for Pat', () => mock.forceCloses().get(sessionP)?.includes('0'));
  });

  it('ends a free room when its time is up: warned, saved, closed', async () => {
    const ended = await c1.next('ended', (m) => m.why === 'time', 30_000);
    expect(ended).toEqual({ t: 'ended', why: 'time' });
    expect((await c1.closed).code).toBe(CLOSE.ended);
    await eventually('room C closed', () => mock.closes.includes(roomC.id));
  });

  it('ends the room for everyone when a host ends it, saving first', async () => {
    h.doc.getText(YDOC.code(CODE_ID)).insert(0, '# last words\n');
    await a.until('the last edit', () => text(a).startsWith('# last words'));
    const saves = mock.saves.length;
    roomA.live = false; // what study_room_end does
    h.send({ t: 'end' });
    for (const c of [h, a, v]) {
      await c.next('ended', (m) => m.why === 'host');
      expect((await c.closed).code).toBe(CLOSE.ended);
    }
    await eventually('room A closed', () => mock.closes.includes(roomA.id));
    const last = mock.saves.slice(saves).find((s) => s.room_id === roomA.id) as { documents: { id: string; text: string }[] } | undefined;
    expect(last?.documents.find((d) => d.id === CODE_ID)?.text.startsWith('# last words')).toBe(true);
    const order = mock.events.filter((e) => e.endsWith(roomA.id));
    expect(order.at(-1)).toBe(`close:${roomA.id}`);
    expect(order.at(-2)).toBe(`save:${roomA.id}`);
    expect(await api(base, `/api/rooms/${roomA.id}/ticket`, H.token, { method: 'POST' })).toMatchObject({ status: 410 });
    // Every remaining track was closed at the SFU.
    await eventually('Hana’s video force-closed', () => mock.forceCloses().get(sessionH)?.includes('1'));
  });
});
