import { expect, test, type Page } from '@playwright/test';
import { nothingClipped } from './layout';
import { MockBackend } from './mock';
import { MockRoomServer } from './mock-room-server';
import type { MRoom } from './mock-rooms';

/** Study rooms, end to end: the lobby, joining (by link, through the waiting room, after the age
 * question, and every reason someone can't), the room's layout, read-only, the people panel, chat,
 * the shared Chip relay, the countdown and ending, and reconnecting. Supabase is e2e/mock.ts and
 * the room server is e2e/mock-room-server.ts (real Yjs over a mocked WebSocket); Chrome uses its
 * pretend camera and microphone. */

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1100;
const GRACE = 'eeeeeeee-0000-4000-8000-000000000001';
const BEN = 'eeeeeeee-0000-4000-8000-000000000002';

interface Setup {
  m: MockBackend;
  server: MockRoomServer;
  room: MRoom;
  docId: string;
  assignmentId: string;
}

/** Ada's assignment in a room. By default Grace hosts it and Ada joins with the link; with [host],
 * Ada hosts it. */
async function setup(page: Page, o: { host?: boolean; tier?: 'free' | 'pro'; age?: 'adult' | 'guardian' | null; room?: Partial<MRoom>; seeded?: boolean; canEdit?: boolean } = {}): Promise<Setup> {
  const m = new MockBackend({ tier: o.tier ?? 'free', age: o.age === undefined ? 'adult' : o.age });
  const a = m.seedAssignment({ title: 'Coastal erosion essay' });
  const doc = m.db.study_documents.find((d) => d.assignment_id === a.id)!;
  doc.content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sea walls move the problem along the coast.' }] }] };
  m.insert('study_notes', { assignment_id: a.id, body: 'Ask about managed retreat', pinned: true });
  m.insert('study_tasks', { assignment_id: a.id, title: 'Read chapter 4', due_on: null });
  const room = o.host
    ? m.rooms.seed(a.id, o.room)
    : m.rooms.seed(a.id, { host_id: GRACE, hostName: 'Grace Hopper', ...o.room });
  if (!o.host && o.canEdit !== undefined) {
    room.members.push({ user_id: m.user.id, name: 'Ada Lovelace', role: 'member', state: 'in', can_edit: o.canEdit, joined_at: new Date().toISOString() });
  }
  const server = new MockRoomServer(m.rooms, () => ({ id: m.user.id, name: 'Ada Lovelace' }));
  if (!o.host) server.join({ userId: GRACE, name: 'Grace Hopper', role: 'host', canEdit: true });
  if (o.seeded) server.fill(String(doc.id), 'Draft', 'Sea walls move the problem along the coast.');
  await m.install(page);
  await server.install(page);
  return { m, server, room, docId: String(doc.id), assignmentId: String(a.id) };
}

/** Through the lobby into the room. */
async function enter(page: Page, s: Setup, label: RegExp | string = 'Join now') {
  await page.goto(`/room/${s.room.token}`);
  await expect(page.getByRole('heading', { name: s.room.title })).toBeVisible();
  await page.getByRole('button', { name: label }).click();
  await expect(page.getByRole('toolbar', { name: 'Room controls' })).toBeVisible();
  // In: the socket is open and the room has said hello.
  await expect.poll(() => s.server.open().length).toBeGreaterThan(0);
  await expect(page.locator('.room-live:not(.is-away)')).toBeVisible();
}

/** Nothing off the side of the screen, once panels have finished sliding in. */
async function laidOut(page: Page) {
  await page.waitForTimeout(500);
  await nothingClipped(page);
}

async function openPanel(page: Page, name: 'People' | 'Chat' | 'Chip') {
  await page.getByRole('toolbar', { name: 'Room controls' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

test('the lobby: preview, microphone level, devices, your name and the connection', async ({ page, browserName }) => {
  const s = await setup(page);
  await page.goto(`/room/${s.room.token}`);
  await expect(page.getByRole('heading', { name: 'Coastal erosion essay' })).toBeVisible();
  await expect(page.getByText('Grace Hopper’s study room')).toBeVisible();
  await expect(page.getByText(/Open until/)).toBeVisible();
  await expect(page.getByText('Others will see you as')).toContainText('Ada Lovelace');
  await expect(page.getByText(/Good connection|A slow connection/)).toBeVisible();
  // Asked once for both, unless the browser already allows them (then they start by themselves).
  const turnOn = page.getByRole('button', { name: 'Turn on camera and microphone' });
  await expect(page.getByLabel('Your camera', { exact: true }).or(turnOn).or(page.getByRole('alert')).first()).toBeVisible();
  if (await turnOn.isVisible()) await turnOn.click();
  if (browserName === 'chromium') {
    await expect(page.getByLabel('Your camera', { exact: true })).toBeVisible();
    await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    await expect(page.getByText('With your camera on')).toBeVisible();
    await expect(page.getByText('With your microphone on')).toBeVisible();
    await expect(page.getByRole('combobox', { name: /Camera/ })).toBeEnabled();
    await expect(page.getByRole('combobox', { name: /Microphone/ })).toBeEnabled();
    // Start muted, camera on.
    await page.getByRole('button', { name: 'Mute your microphone' }).click();
    await expect(page.getByText('Muted', { exact: true })).toBeVisible();
  } else {
    // No camera here, or the browser is asking: a clear word about it, and joining still works.
    await expect(page.getByLabel('Your camera', { exact: true }).or(page.getByRole('alert')).or(page.getByText('Your browser is asking to use your camera and microphone.')).first()).toBeVisible();
  }
  await laidOut(page);
  await page.getByRole('button', { name: 'Join now' }).click();
  await expect(page.getByRole('toolbar', { name: 'Room controls' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unmute' })).toBeVisible();
  if (browserName === 'chromium') await expect(page.getByRole('button', { name: 'Turn camera off' })).toBeVisible();
});

test('joining by link: the room fills with the host’s work, and edits pass both ways', async ({ page }) => {
  const s = await setup(page);
  await enter(page, s);
  // Ada can edit (everyone can, in a personal room) and was asked to fill the room.
  const editor = page.locator('.doc-prose');
  await expect(editor).toContainText('Sea walls move the problem along the coast.');
  await expect.poll(() => s.server.seeded()).toBe(true);
  expect(s.server.received.some((x) => x.t === 'seeded')).toBe(true);
  expect(s.m.made('/rest/v1/rpc/study_room_workspace').length).toBeGreaterThan(0);
  // Grace types: it shows here.
  s.server.edit((doc) => {
    const para = doc.getXmlFragment(`doc/${s.docId}`).get(0) as unknown as { get(i: number): { insert(at: number, t: string): void } };
    para.get(0).insert(0, 'Grace: ');
  });
  await expect(editor).toContainText('Grace: Sea walls');
  // Ada types: it reaches the room.
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Retreat is cheaper.');
  await expect.poll(() => s.server.text(s.docId)).toContain('Retreat is cheaper.');
  // The shared notes and plan are the room's.
  await page.getByRole('toolbar', { name: 'Room controls' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Shared notes' }).click();
  await expect(page.getByLabel('Note', { exact: true }).first()).toHaveValue('Ask about managed retreat');
});

test('joining through the waiting room', async ({ page }) => {
  const s = await setup(page, { room: { admission: 'ask' } });
  await page.goto(`/room/${s.room.token}`);
  await expect(page.getByText('The host lets each person in.')).toBeVisible();
  await page.getByRole('button', { name: 'Ask to join' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting to be let in' })).toBeVisible();
  await laidOut(page);
  // Grace lets Ada in.
  s.room.members.find((x) => x.user_id === s.m.user.id)!.state = 'in';
  await expect(page.getByRole('toolbar', { name: 'Room controls' })).toBeVisible({ timeout: 12_000 });
});

test('the age question comes first for a personal room', async ({ page }) => {
  const s = await setup(page, { age: null });
  await page.goto(`/room/${s.room.token}`);
  await expect(page.getByRole('dialog', { name: 'One question first' })).toBeVisible();
  await page.getByRole('radio', { name: 'I’m 18 or over' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Join now' })).toBeVisible();
});

test('a kind word for every reason someone can’t join', async ({ page }) => {
  const s = await setup(page);
  const cases: [string, () => void, string][] = [
    ['ended', () => void (s.room.status = 'ended'), 'This room has ended'],
    ['removed', () => s.room.members.push({ user_id: s.m.user.id, name: 'Ada', role: 'member', state: 'removed', can_edit: false, joined_at: '' }), 'You can’t rejoin this room'],
    ['not invited', () => void (s.room.institution_id = 'ffffffff-0000-4000-8000-000000000009'), 'This room is for invited classes'],
    ['adults only', () => s.m.inst.age.set(s.m.user.id, 'guardian'), 'This room is for adults'],
  ];
  for (const [, make, title] of cases) {
    s.room.status = 'open';
    s.room.institution_id = null;
    s.room.members = s.room.members.filter((x) => x.user_id !== s.m.user.id);
    s.m.inst.age.set(s.m.user.id, 'adult');
    make();
    await page.goto(`/room/${s.room.token}`);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
  await laidOut(page);
  await page.goto('/room/not-a-real-link');
  await expect(page.getByRole('heading', { name: 'This link doesn’t work' })).toBeVisible();
});

test('the room: shared work in the middle, video tiles with names, controls and panels', async ({ page }) => {
  const s = await setup(page);
  s.server.join({ userId: BEN, name: 'Ben Okafor', role: 'member' });
  // Grace's microphone is on; Ben's isn't.
  s.server.pubs = [{ userId: GRACE, sessionId: 's-grace', trackName: `${GRACE}:audio`, kind: 'audio', rids: [] }];
  await enter(page, s);
  await expect(page.locator('.doc-prose')).toBeVisible();
  const strip = page.getByRole('region', { name: 'People’s video' });
  await expect(strip.getByRole('group', { name: /^Ada Lovelace \(you\)/ })).toBeVisible();
  await expect(strip.getByRole('group', { name: 'Grace Hopper, host, camera off' })).toBeVisible();
  await expect(strip.getByRole('group', { name: 'Ben Okafor, muted, camera off' })).toBeVisible();
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.getByText('Video and voice aren’t switched on for rooms yet.')).toBeVisible();
  const controls = page.getByRole('toolbar', { name: 'Room controls' });
  for (const name of [/^(Mute|Unmute)$/, /Turn camera (on|off)/, /Raise your hand/, 'Chat', 'People', 'Chip', 'More', 'Leave the room']) await expect(controls.getByRole('button', { name })).toBeVisible();
  await laidOut(page);
  // Raising a hand shows on your tile and goes to the room.
  await controls.getByRole('button', { name: 'Raise your hand' }).click();
  await expect(strip.getByRole('group', { name: /Ada Lovelace \(you\).*hand raised/ })).toBeVisible();
  expect(s.server.received).toContainEqual({ t: 'hand', up: true });
  // Pinning puts someone on the stage.
  if (wide(page)) {
    await strip.getByRole('group', { name: /^Grace Hopper/ }).hover();
    await strip.getByRole('button', { name: 'Pin Grace Hopper to the stage' }).click();
    await expect(page.getByRole('region', { name: 'Grace Hopper' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to the work' }).click();
    await expect(page.locator('.doc-prose')).toBeVisible();
  }
  // Keyboard: P opens People, Esc closes it.
  if (wide(page)) {
    await page.locator('body').click({ position: { x: 5, y: 200 } });
    await page.keyboard.press('p');
    await expect(page.getByRole('navigation', { name: 'Room panels' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Room panels' })).toBeHidden();
  }
});

test('read-only until a host lets you edit', async ({ page }) => {
  const s = await setup(page, { room: { edit_mode: 'chosen' }, canEdit: false, seeded: true });
  await enter(page, s);
  const editor = page.locator('.doc-prose');
  await expect(editor).toContainText('Sea walls move the problem');
  await expect(page.getByText('You’re viewing. A host can let you edit.')).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  // Nothing was sent to change the work.
  // Grace lets Ada edit.
  s.room.members.find((x) => x.user_id === s.m.user.id)!.can_edit = true;
  s.server.reread();
  await expect(page.getByText('You can edit the work now.')).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Now I can write.');
  await expect.poll(() => s.server.text(s.docId)).toContain('Now I can write.');
  // And stops it: viewing again, on a fresh copy of the room.
  s.room.members.find((x) => x.user_id === s.m.user.id)!.can_edit = false;
  s.server.reread();
  await expect(page.getByText('You’re viewing. A host can let you edit.')).toBeVisible();
  await expect(page.locator('.doc-prose')).toContainText('Now I can write.');
});

test('a host runs the room from People: let in, choose who edits, remove, mute everyone', async ({ page }) => {
  const s = await setup(page, { host: true });
  const ben = s.m.rooms.member(s.room, 'Ben Okafor', { user_id: BEN });
  const wren = s.m.rooms.member(s.room, 'Wren Adeyemi', { state: 'waiting' });
  s.server.join({ userId: BEN, name: 'Ben Okafor' });
  await enter(page, s);
  // The invite sheet opens for a host who's alone; close it.
  const invite = page.getByRole('dialog', { name: 'Invite people to study with you' });
  if (await invite.isVisible().catch(() => false)) await invite.getByRole('button', { name: 'Close' }).click();
  await openPanel(page, 'People');
  const panel = page.getByRole('region', { name: 'Waiting to join' });
  await expect(panel.getByText('Wren Adeyemi')).toBeVisible();
  const perms = () => s.server.received.filter((x) => x.t === 'perm').length;
  await panel.getByRole('button', { name: 'Let in' }).click();
  await expect.poll(() => wren.state).toBe('in');
  await expect.poll(perms).toBe(1);
  // Chosen people edit.
  await page.getByRole('radio', { name: 'People I choose' }).click();
  await expect.poll(() => s.room.edit_mode).toBe('chosen');
  await expect.poll(perms).toBe(2);
  await page.getByRole('button', { name: 'More for Ben Okafor' }).click();
  await page.getByRole('menuitem', { name: 'Let them edit' }).click();
  await expect.poll(() => ben.can_edit).toBe(true);
  // How people join.
  await page.getByRole('radio', { name: 'I let them in' }).click();
  await expect.poll(() => s.room.admission).toBe('ask');
  // Mute everyone.
  await page.getByRole('button', { name: 'Mute everyone' }).click();
  await expect.poll(() => s.server.received.some((x) => x.t === 'mute-all')).toBe(true);
  // Remove, after asking.
  await page.getByRole('button', { name: 'More for Ben Okafor' }).click();
  await page.getByRole('menuitem', { name: 'Remove from the room' }).click();
  await expect(page.getByRole('dialog', { name: 'Remove Ben Okafor?' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Remove Ben Okafor?' }).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => ben.state).toBe('removed');
  await laidOut(page);
});

test('chat: names and times, unread counts, and only safe links', async ({ page }) => {
  const s = await setup(page);
  await enter(page, s);
  const controls = page.getByRole('toolbar', { name: 'Room controls' });
  s.server.push({ t: 'chat', id: 'g1', from: { userId: GRACE, name: 'Grace Hopper' }, text: 'Notes here: https://example.com/notes. Not this: javascript:alert(1)', at: Date.now() });
  await expect(controls.getByRole('button', { name: 'Chat' }).locator('.room-ctl-badge')).toHaveText('1');
  await openPanel(page, 'Chat');
  await expect(controls.getByRole('button', { name: 'Chat' }).locator('.room-ctl-badge')).toHaveCount(0);
  const messages = page.getByRole('log').or(page.getByLabel('Chat messages'));
  await expect(messages.getByText('Grace Hopper')).toBeVisible();
  const link = messages.getByRole('link', { name: 'https://example.com/notes' });
  await expect(link).toHaveAttribute('href', 'https://example.com/notes');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(messages.getByRole('link', { name: /javascript/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message to everyone in the room' }).fill('On it.');
  await page.keyboard.press('Enter');
  await expect(messages.getByText('On it.')).toBeVisible();
  expect(s.server.received).toContainEqual({ t: 'chat', text: 'On it.' });
  await laidOut(page);
});

test('the shared Chip: the asker’s answer is relayed to everyone, and only editors put it in', async ({ page }) => {
  const s = await setup(page);
  s.room.tutor = { class: 'Geography 201', institution: 'Lagos Bay University', course_brief: '', help_level: 'guide', tutor_notes: '' };
  await enter(page, s);
  await expect(page.locator('.doc-prose')).toBeVisible();
  // Someone else's question shows for everyone.
  s.server.push({ t: 'chip', id: 'grace1', from: { userId: GRACE, name: 'Grace Hopper' }, question: 'What is a groyne?', answer: 'A low wall that traps sand.', done: true, at: Date.now() });
  await expect(page.getByRole('toolbar', { name: 'Room controls' }).getByRole('button', { name: 'Chip' }).locator('.room-ctl-badge')).toHaveText('1');
  await openPanel(page, 'Chip');
  await expect(page.getByText('Chip follows Geography 201’s guidance')).toBeVisible();
  await expect(page.getByText('What is a groyne?')).toBeVisible();
  await expect(page.getByText('A low wall that traps sand.')).toBeVisible();
  // Ada asks for a draft.
  await page.getByRole('tab', { name: 'Write' }).click();
  await page.getByRole('textbox', { name: 'Message to Chip, for everyone' }).fill('Help us start the introduction');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Coastal towns face a hard choice')).toBeVisible();
  // The function was asked for the room, never an assignment or thread.
  const call = s.m.made('/functions/v1/chip-study').at(-1)!.body as Record<string, unknown>;
  expect(call.room).toBe(s.room.id);
  expect('assignment' in call || 'thread' in call).toBe(false);
  // The relay: ask, then the growing answer, then done with the whole of it.
  await expect.poll(() => s.server.received.some((x) => x.t === 'chip-done')).toBe(true);
  const relay = s.server.received.filter((x) => x.t === 'chip-ask' || x.t === 'chip-chunk' || x.t === 'chip-done') as { t: string; id: string; text: string }[];
  expect(relay[0]).toMatchObject({ t: 'chip-ask', text: 'Help us start the introduction' });
  const done = relay.at(-1)!;
  expect(done.t).toBe('chip-done');
  expect(done.text).toContain('Coastal towns face a hard choice');
  for (const c of relay.filter((x) => x.t === 'chip-chunk')) expect(done.text.startsWith(c.text)).toBe(true);
  expect(new Set(relay.map((x) => x.id)).size).toBe(1);
  // Ada can edit: she puts it in (where her cursor is), and the record notes it.
  await page.getByRole('button', { name: 'Put in the document' }).click();
  if (!wide(page)) await page.getByRole('button', { name: 'Close the panel' }).click();
  await expect(page.locator('.doc-prose')).toContainText('Coastal towns face a hard choice');
  await expect.poll(() => s.m.rooms.uses.length).toBe(1);
  expect(s.m.rooms.uses[0]).toMatchObject({ p_room: s.room.id, p_action: 'inserted' });
  await laidOut(page);
});

test('a free room counts down, warns at five minutes, and ends for everyone', async ({ page }) => {
  const s = await setup(page, { host: true, room: { ends_at: new Date(Date.now() + 4 * 60_000).toISOString() } });
  await enter(page, s);
  const invite = page.getByRole('dialog', { name: 'Invite people to study with you' });
  if (await invite.isVisible().catch(() => false)) await invite.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('timer')).toHaveClass(/is-soon/);
  await expect(page.getByText(/About 5 minutes left/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pro rooms have no time limit.' })).toBeVisible();
  await page.getByRole('button', { name: 'Leave or end the room' }).click();
  await page.getByRole('menuitem', { name: 'End for everyone' }).click();
  await page.getByRole('dialog', { name: 'End the room for everyone?' }).getByRole('button', { name: 'End for everyone' }).click();
  await expect(page.getByRole('heading', { name: 'The room has ended' })).toBeVisible();
  expect(s.room.status).toBe('ended');
  expect(s.server.received).toContainEqual({ t: 'end' });
  await expect(page.getByRole('link', { name: 'Open the assignment' })).toHaveAttribute('href', `/app/a/${s.assignmentId}`);
  await laidOut(page);
});

test('time’s up: the room ends itself', async ({ page }) => {
  const s = await setup(page);
  await enter(page, s);
  s.server.end('time');
  await expect(page.getByRole('heading', { name: 'Time’s up' })).toBeVisible();
  await expect(page.getByText(/saved to Grace Hopper’s assignment/)).toBeVisible();
});

test('reconnecting and offline: a calm banner, and back in with a new ticket', async ({ page, context }) => {
  const s = await setup(page);
  await enter(page, s);
  await expect.poll(() => s.server.open().length).toBe(1);
  const tickets = () => s.server.calls.filter((c) => c.endsWith('/ticket')).length;
  const before = tickets();
  s.server.down = true;
  s.server.drop();
  await expect(page.getByText(/Reconnecting to the room/)).toBeVisible();
  s.server.down = false;
  await expect(page.getByText(/Reconnecting to the room/)).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => s.server.open().length).toBe(1);
  expect(tickets()).toBeGreaterThan(before + 1);
  // Offline: said plainly, and the work stays editable here.
  await context.setOffline(true);
  await expect(page.getByText(/You’re offline/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/You’re offline/)).toBeHidden();
});

test('study together from the workspace, and live now on the desk', async ({ page }) => {
  const m = new MockBackend({ tier: 'pro' });
  const a = m.seedAssignment({ title: 'Coastal erosion essay' });
  const server = new MockRoomServer(m.rooms, () => ({ id: m.user.id, name: 'Ada Lovelace' }));
  await m.install(page);
  await server.install(page);
  await page.goto(`/app/a/${a.id}`);
  await expect(page.locator('.doc-prose')).toBeVisible();
  await page.getByRole('button', { name: /Study together/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Study together' });
  await expect(dialog.getByText('up to 10 people, with no time limit')).toBeVisible();
  await dialog.getByRole('button', { name: 'Open the room' }).click();
  const share = page.getByRole('dialog', { name: 'Invite people to study with you' });
  await expect(share).toBeVisible();
  const room = m.rooms.rooms[0];
  await expect(share.getByRole('textbox', { name: 'The room’s link' })).toHaveValue(new RegExp(`/room/${room.token}$`));
  await share.getByRole('button', { name: 'New link' }).click();
  await expect(share.getByRole('textbox', { name: 'The room’s link' })).toHaveValue(new RegExp(`/room/${m.rooms.rooms[0].token}$`));
  expect(m.made('/rest/v1/rpc/study_room_new_link').length).toBe(1);
  await laidOut(page);
  await share.getByRole('button', { name: 'Close' }).click();
  await page.goto('/app');
  const live = page.getByRole('region', { name: 'Live now' });
  await expect(live.getByText('Coastal erosion essay')).toBeVisible();
  await expect(live.getByText('Your room')).toBeVisible();
  await live.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/room/${m.rooms.rooms[0].token}$`));
});
