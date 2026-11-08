// Two people editing one document live, in two real browsers, through the real room server:
// `wrangler dev` runs the Worker and its Durable Object and serves the app (the e2e build), the
// database's room checks, the study-rooms function, the SFU and TURN are tests/integration/mock.ts,
// and each browser's Supabase is e2e/mock.ts (in the page). An edit in one browser has to cross the
// real room socket and Durable Object to reach the other, and the room's save has to carry it.
//
//   npm run test:rooms
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join as joinPath, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockBackend } from '../../e2e/mock';
import { Mock, type MockMember } from './mock';

const ROOT = resolve(__dirname, '../..');
const ASSETS = joinPath(ROOT, 'dist-e2e');
const secret = () => randomBytes(24).toString('hex');
const SETTINGS = { anon: 'test-anon-key', roomSecret: secret(), appId: 'test-app', appSecret: secret(), turnKey: 'test-turn-key', turnToken: secret() };

const ROOM_ID = randomUUID();
const TOKEN = `live${randomBytes(12).toString('hex')}`;
const ASSIGNMENT = randomUUID();
const DOC = randomUUID();

interface Who {
  userId: string;
  token: string;
  name: string;
  email: string;
  role: MockMember['role'];
}
const HANA: Who = { userId: randomUUID(), token: `token-hana-${randomUUID()}`, name: 'Hana Ito', email: 'hana@example.test', role: 'host' };
const ADA: Who = { userId: randomUUID(), token: `token-ada-${randomUUID()}`, name: 'Ada Lovelace', email: 'ada@example.test', role: 'member' };

let mock: Mock;
let wrangler: ChildProcess | null = null;
let browser: Browser | null = null;
let base = '';
let state = '';
let log = '';
const contexts: BrowserContext[] = [];

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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The newest change to anything the app's build is made from. */
function newest(dir: string): number {
  let t = 0;
  for (const name of readdirSync(dir)) {
    const p = joinPath(dir, name);
    const s = statSync(p);
    t = Math.max(t, s.isDirectory() ? newest(p) : s.mtimeMs);
  }
  return t;
}

/** The e2e build (Supabase answered in the page), made again if the code is newer. Vitest copies
 * the VITE_ settings of .env.local (the real Supabase) into this process, and Vite prefers settings
 * it's handed to .env.e2e's, so the build is made without them. */
function buildApp() {
  const built = existsSync(joinPath(ASSETS, 'index.html')) ? statSync(joinPath(ASSETS, 'index.html')).mtimeMs : 0;
  const source = Math.max(newest(joinPath(ROOT, 'src')), newest(joinPath(ROOT, 'shared')), statSync(joinPath(ROOT, 'index.html')).mtimeMs);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
  if (built < source) execFileSync('npx', ['vite', 'build', '--mode', 'e2e'], { cwd: ROOT, stdio: 'ignore', env });
}

/** A person's pretend Supabase: signed in as them, with the room and its assignment as the database has them. */
function backendFor(who: Who): MockBackend {
  const m = new MockBackend({ name: who.name });
  m.user = { id: who.userId, email: who.email };
  m.accessToken = who.token;
  m.inst.age.set(who.userId, 'adult');
  const at = new Date().toISOString();
  m.db.study_assignments.push({ id: ASSIGNMENT, user_id: HANA.userId, title: 'Water in cities', course: 'GEO 110', brief: '', rubric: '', due_at: null, word_target: null, style: 'apa', status: 'active', color: 'sky', kind: 'assignment', words: 3, focus_minutes: 0, created_at: at, updated_at: at });
  m.db.study_documents.push({ id: DOC, assignment_id: ASSIGNMENT, user_id: HANA.userId, kind: 'doc', title: 'Draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cities need water.' }] }] }, text: 'Cities need water.', words: 3, chip_words: 0, version: 1, sort: 0, created_at: at, updated_at: at });
  m.rooms.rooms.push({
    id: ROOM_ID,
    token: TOKEN,
    assignment_id: ASSIGNMENT,
    host_id: HANA.userId,
    institution_id: null,
    title: 'Water in cities',
    edit_mode: 'everyone',
    admission: 'link',
    max_people: 4,
    ends_at: null,
    status: 'open',
    members: [HANA, ADA].map((p) => ({ user_id: p.userId, name: p.name, role: p.role, state: 'in' as const, can_edit: true, joined_at: at })),
    invited_classes: [],
    invited_people: [],
    tutor: null,
  });
  return m;
}

async function person(who: Who): Promise<Page> {
  const context = await browser!.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-GB', serviceWorkers: 'block' });
  contexts.push(context);
  const page = await context.newPage();
  await backendFor(who).install(page);
  return page;
}

async function enter(page: Page) {
  await page.goto(`${base}/room/${TOKEN}`);
  await page.getByRole('button', { name: 'Join now' }).click();
  await page.getByRole('toolbar', { name: 'Room controls' }).waitFor({ timeout: 20_000 });
}

/** [page]'s document as text, without other people's cursors (their name labels sit in the text). */
const docText = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.doc-prose')?.cloneNode(true) as HTMLElement | undefined;
    if (!el) return '';
    el.querySelectorAll('.collab-caret').forEach((c) => c.remove());
    return el.textContent ?? '';
  });

/** Waits until [page]'s document holds [text]. */
async function shows(page: Page, text: string, ms = 15_000) {
  const deadline = Date.now() + ms;
  let now = '';
  while (Date.now() < deadline) {
    now = await docText(page);
    if (now.includes(text)) return;
    await wait(150);
  }
  throw new Error(`waited for ${JSON.stringify(text)}; the document holds ${JSON.stringify(now)}`);
}

beforeAll(async () => {
  mock = new Mock(SETTINGS.anon, SETTINGS.roomSecret, SETTINGS.appId, SETTINGS.appSecret, SETTINGS.turnKey, SETTINGS.turnToken);
  mock.addRoom({ id: ROOM_ID, live: true, maxPeople: 4, endsAt: null, editMode: 'everyone', members: [HANA, ADA].map((p) => ({ token: p.token, userId: p.userId, name: p.name, role: p.role, state: 'in', canEdit: true })) });
  await mock.start();
  buildApp();

  state = mkdtempSync(joinPath(tmpdir(), 'chip-study-live-'));
  const env = joinPath(state, 'test.env');
  writeFileSync(
    env,
    [
      `SUPABASE_URL=${mock.url}`,
      `SUPABASE_ANON_KEY=${SETTINGS.anon}`,
      `ROOM_SERVICE_URL=${mock.url}/functions/v1/study-rooms`,
      `ROOM_SERVER_SECRET=${SETTINGS.roomSecret}`,
      // Local runs can't place a room in a jurisdiction; the real one keeps rooms in the EU.
      'ROOMS_JURISDICTION=',
      `REALTIME_APP_ID=${SETTINGS.appId}`,
      `REALTIME_APP_SECRET=${SETTINGS.appSecret}`,
      `TURN_KEY_ID=${SETTINGS.turnKey}`,
      `TURN_KEY_API_TOKEN=${SETTINGS.turnToken}`,
      `REALTIME_API_BASE=${mock.url}/sfu/v1`,
      `TURN_API_BASE=${mock.url}/turn/v1`,
      '',
    ].join('\n'),
  );
  // wrangler.jsonc, serving the e2e build instead of the real one.
  const config = joinPath(state, 'wrangler.json');
  writeFileSync(
    config,
    JSON.stringify({
      name: 'chip-study-live-test',
      main: joinPath(ROOT, 'worker/index.ts'),
      compatibility_date: '2026-10-01',
      assets: { directory: ASSETS, binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
      durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'StudyRoom' }] },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['StudyRoom'] }],
    }),
  );
  const port = await freePort();
  const inspector = await freePort();
  base = `http://127.0.0.1:${port}`;
  wrangler = spawn(
    'npx',
    ['wrangler', 'dev', '-c', config, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--persist-to', joinPath(state, 'state'), '--env-file', env, '--show-interactive-dev-session=false', '--log-level', 'log'],
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
  browser = await chromium.launch({ channel: 'chrome' });
}, 240_000);

afterAll(async () => {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  if (wrangler && wrangler.exitCode === null) {
    wrangler.kill('SIGTERM');
    await wait(500);
    if (wrangler.exitCode === null) wrangler.kill('SIGKILL');
  }
  await mock?.stop();
  if (state) rmSync(state, { recursive: true, force: true });
  if (process.env.ROOMS_TEST_LOG) writeFileSync(process.env.ROOMS_TEST_LOG, log);
});

describe('studying together, in two browsers', () => {
  it('passes each person’s edits to the other through the real room server, and saves them', async () => {
    const hana = await person(HANA);
    const ada = await person(ADA);

    // Hana opens the room first: the server asks her screen to fill it with her work.
    await enter(hana);
    await shows(hana, 'Cities need water.');
    // Ada joins: she gets the room's document from the server, not from her own copy.
    await enter(ada);
    await shows(ada, 'Cities need water.');
    // Both are in the room, by the names the server's roster gives.
    await ada.getByRole('group', { name: /^Hana Ito, host/ }).waitFor({ timeout: 10_000 });
    await hana.getByRole('group', { name: /^Ada Lovelace/ }).waitFor({ timeout: 10_000 });

    // Hana types; Ada sees it.
    await hana.locator('.doc-prose').click();
    await hana.keyboard.press('End');
    await hana.keyboard.type(' Hana wrote this.');
    await shows(ada, 'Hana wrote this.');

    // Ada types at the start; Hana sees it, and Ada's name is on her cursor.
    await ada.locator('.doc-prose p').first().click({ position: { x: 2, y: 8 } });
    await ada.keyboard.press('Home');
    await ada.keyboard.type('Ada: ');
    await shows(hana, 'Ada: Cities need water. Hana wrote this.');
    expect(await docText(ada)).toBe(await docText(hana));
    await hana.locator('.collab-caret-label', { hasText: 'Ada Lovelace' }).waitFor({ timeout: 10_000 });

    // Chat crosses too.
    await ada.getByRole('toolbar', { name: 'Room controls' }).getByRole('button', { name: /^Chat/ }).click();
    await ada.getByRole('textbox', { name: 'Message to everyone in the room' }).fill('Looks good');
    await ada.keyboard.press('Enter');
    await hana.getByRole('toolbar', { name: 'Room controls' }).getByRole('button', { name: /^Chat/ }).click();
    await hana.getByLabel('Chat messages').getByText('Looks good').waitFor({ timeout: 10_000 });

    // The room saves both people's words to Hana's assignment (about every 20 seconds).
    const deadline = Date.now() + 40_000;
    let saved = '';
    while (Date.now() < deadline) {
      const docs = mock.saves.flatMap((s) => ((s.documents as { id: string; text: string }[] | undefined) ?? []).filter((d) => d.id === DOC));
      saved = docs.at(-1)?.text ?? '';
      if (saved.includes('Hana wrote this.') && saved.includes('Ada: ')) break;
      await wait(500);
    }
    expect(saved).toBe('Ada: Cities need water. Hana wrote this.');
  }, 120_000);
});
