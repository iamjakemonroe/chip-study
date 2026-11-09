import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { nothingClipped } from './layout';
import { MockBackend } from './mock';

/** Chip Study's next round, on every browser and size: arriving from a learning platform (/lti),
 * connecting one, the age rule, invite links and campus reps, course tutors, class themes,
 * invoices, new class codes, the study guides, prices in naira, and the sign-in buttons. */

async function catchCopies(page: Page) {
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.assign(window, { copied });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
  });
  return () => page.evaluate(() => (window as unknown as { copied: string[] }).copied);
}

const rpcCalls = (m: MockBackend, fn: string) => m.made(`/rest/v1/rpc/${fn}`).filter((c) => c.path === `/rest/v1/rpc/${fn}`);

/** A hash change alone doesn't load the page again: start from a blank one. */
async function openLti(page: Page, fragment: string) {
  await page.goto('about:blank');
  await page.goto(`/lti#${fragment}`);
}

/** Opens a side panel: beside the document on wide screens, over it on smaller ones. */
async function openPanel(page: Page, name: 'Chip' | 'Brief') {
  const panels = page.getByRole('navigation', { name: 'Panels' });
  if (!(await panels.isVisible())) {
    const bar = page.getByRole('navigation', { name: 'Workspace' });
    if (name === 'Chip') await bar.getByRole('button', { name }).click();
    else await bar.getByRole('button', { name: 'More' }).click();
  }
  await panels.getByRole('button', { name }).click();
}

async function signInByCode(page: Page, m: MockBackend) {
  await page.getByLabel('Email').fill(m.user.email);
  await page.getByRole('button', { name: /Email me a code/ }).click();
  await page.getByLabel('Code').fill('12345678');
}

// ── Arriving from a learning platform ─────────────────────────────────

test('from a course, signed in by the platform: a teacher lands on their classes, and the fragment is gone', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, 'teacher');
  const cls = m.inst.klass(inst.id, 'Physics 110');
  m.inst.inClass(cls.id, m.user.id, 'teacher');
  m.tokenHashes.add('hash-1');
  await m.install(page, { signedIn: false });
  await page.goto(`/lti#token_hash=hash-1&type=magiclink&inst=${inst.id}&class=${cls.id}&role=teacher`);
  await expect(page).toHaveURL(new RegExp(`/app/institution/${inst.id}\\?tab=classes$`));
  await expect(page.getByText('You’re in, as a teacher of your course.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Physics 110' })).toBeVisible();
  expect(m.made('/auth/v1/verify', 'POST')[0].body).toMatchObject({ token_hash: 'hash-1', type: 'email' });
});

test('from a course in another browser: “Continue as …?” first, and “Not me” changes nothing', async ({ page }) => {
  const m = new MockBackend();
  m.inst.seed({}, 'student');
  m.tokenHashes.add('hash-2');
  await m.install(page, { signedIn: false });
  await page.goto(`/lti#token_hash=hash-2&type=magiclink&role=student&confirm=${encodeURIComponent(m.user.email)}`);
  await expect(page.getByRole('heading', { name: `Continue as ${m.user.email}?` })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await nothingClipped(page);
  await page.getByRole('button', { name: 'Not me' }).click();
  await expect(page.getByRole('heading', { name: 'No problem' })).toBeVisible();
  expect(m.made('/auth/v1/verify')).toHaveLength(0);
  expect(m.tokenHashes.has('hash-2')).toBe(true);

  m.tokenHashes.add('hash-3');
  await openLti(page, `token_hash=hash-3&type=magiclink&role=student&confirm=${encodeURIComponent(m.user.email)}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('You’re in, from your course.')).toBeVisible();
});

test('linking a course: what it’s for, sign in, link, then what the institution can see', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, null);
  m.inst.platforms.push({ id: 'p1', institution_id: inst.id, name: 'Moodle', issuer: 'https://moodle.lagosbay.edu.ng', client_id: 'c1', deployment_id: 'd1', auth_url: 'https://moodle.lagosbay.edu.ng/auth', jwks_url: 'https://moodle.lagosbay.edu.ng/certs', created_at: new Date().toISOString(), courses: 0 });
  m.inst.pending.push({ token: 'link-1', platform_id: 'p1', email: 'ada@personal.test', teacher: false, course: 'Physics 110' });
  await m.install(page, { signedIn: false });
  await page.goto('/lti#link=link-1');
  await expect(page.getByRole('heading', { name: 'Link your course to Chip Study' })).toBeVisible();
  await expect(page.getByText('Lagos Bay University')).toBeVisible();
  await expect(page.getByText('Physics 110')).toBeVisible();
  await expect(page.getByText('ada@personal.test')).toBeVisible();
  await nothingClipped(page);
  await page.getByRole('link', { name: 'Sign in to link it' }).click();
  await expect(page).toHaveURL(/\/signin\?next=%2Flti$/);
  await expect(page.getByText('Sign in once to link your course.')).toBeVisible();
  await signInByCode(page, m);
  await expect(page).toHaveURL(/\/lti$/);
  await page.getByRole('button', { name: `Link and open as ${m.user.email}` }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(m.inst.roleOf(inst.id, m.user.id)).toBe('student');
  // Joined from a platform: what it can see, shown on the first visit.
  const consent = page.getByRole('dialog', { name: 'What Lagos Bay University can see' });
  await expect(consent.getByText('Your chats with Chip', { exact: true })).toBeVisible();
  await consent.getByRole('button', { name: 'I understand' }).click();
  await expect(consent).toHaveCount(0);
  expect(rpcCalls(m, 'study_consent_accept')[0].body).toEqual({ p_inst: inst.id });
});

test('a link that ran out, one linked to someone else, and each error code, say what happened', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, null);
  m.inst.platforms.push({ id: 'p1', institution_id: inst.id, name: 'Canvas', issuer: 'https://canvas.instructure.com', client_id: 'c1', deployment_id: 'd1', auth_url: 'https://sso.canvaslms.com/a', jwks_url: 'https://sso.canvaslms.com/j', created_at: new Date().toISOString(), courses: 0 });
  m.inst.pending.push({ token: 'taken', platform_id: 'p1', email: null, teacher: false, course: null, owner: 'someone-else' });
  await m.install(page);
  await page.goto('/lti#link=gone');
  await expect(page.getByRole('heading', { name: 'That link has run out' })).toBeVisible();
  await openLti(page, 'link=taken');
  await page.getByRole('button', { name: /Link and open as/ }).click();
  await expect(page.getByRole('alert')).toContainText('already linked to a different Chip Study account');
  for (const [code, heading] of [
    ['no_seats', 'No seats left'],
    ['unknown_platform', 'This platform isn’t connected yet'],
    ['unknown_deployment', 'This deployment isn’t registered'],
    ['linked_elsewhere', 'Linked to another account'],
    ['brand_new_code', 'Something went wrong'],
  ]) {
    await openLti(page, `error=${code}`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
  }
  await nothingClipped(page);
});

test('an admin connects Blackboard (all but the deployment filled in) and removes it', async ({ page }) => {
  const m = new MockBackend();
  const { inst } = m.inst.seedSchool();
  const copies = await catchCopies(page);
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}?tab=settings`);
  const section = page.getByRole('region', { name: 'Learning platform' });
  await expect(section.getByText('https://mock-study.supabase.test/functions/v1/study-lti/launch')).toBeVisible();
  await section.getByRole('button', { name: 'Copy the launch address' }).click();
  await expect.poll(copies).toContain('https://mock-study.supabase.test/functions/v1/study-lti/launch');
  await section.getByRole('radio', { name: 'Canvas' }).click();
  await expect(section.getByLabel('Issuer (platform ID)')).toHaveValue('https://canvas.instructure.com');
  await expect(section.getByLabel('Client ID')).toHaveValue('');
  await section.getByRole('radio', { name: 'Blackboard' }).click();
  await expect(section.getByLabel('Client ID')).toHaveValue('6b29b222-febd-4a33-b399-6e1951fc3898');
  await expect(section.getByLabel('Keyset URL')).toHaveValue('https://developer.blackboard.com/api/v1/management/applications/6b29b222-febd-4a33-b399-6e1951fc3898/jwks.json');
  await section.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect.poll(copies).toContain('6b29b222-febd-4a33-b399-6e1951fc3898');
  await section.getByRole('button', { name: 'Connect Blackboard' }).click();
  await expect(section.getByText('Copy it from the platform.')).toBeVisible();
  await section.getByLabel('Deployment ID').fill('bb-deploy-42');
  await nothingClipped(page);
  await section.getByRole('button', { name: 'Connect Blackboard' }).click();
  await expect(page.getByText('Connected. Lecturers can add Chip Study to their courses now.')).toBeVisible();
  expect(m.inst.platforms).toHaveLength(1);
  expect(m.inst.platforms[0]).toMatchObject({ name: 'Blackboard', issuer: 'https://blackboard.com', deployment_id: 'bb-deploy-42' });
  await expect(section.getByText(/deployment bb-deploy-42/)).toBeVisible();
  await section.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog', { name: 'Remove Blackboard?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(section.getByText('None yet.')).toBeVisible();
  expect(m.inst.platforms).toHaveLength(0);
});

// ── The age rule ──────────────────────────────────────────────────────

test('the age question, once after signing in', async ({ page }) => {
  const m = new MockBackend({ age: null });
  await m.install(page);
  await page.goto('/app');
  const sheet = page.getByRole('dialog', { name: 'One question first' });
  await expect(sheet).toBeVisible();
  await nothingClipped(page);
  await sheet.getByRole('radio', { name: /I’m 18 or over/ }).click();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(sheet).toHaveCount(0);
  expect(rpcCalls(m, 'study_age_confirm')[0].body).toEqual({ p_answer: 'adult' });
  await page.goto('/app/settings');
  await expect(page.getByText('18 or over')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('under 13: told kindly, then signed out', async ({ page }) => {
  const m = new MockBackend({ age: null });
  await m.install(page);
  await page.goto('/app');
  const sheet = page.getByRole('dialog', { name: 'One question first' });
  await sheet.getByRole('radio', { name: /I’m under 13/ }).click();
  await expect(page.getByRole('dialog', { name: 'Chip Study is for 13 and over' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(rpcCalls(m, 'study_age_confirm')).toHaveLength(0);
  expect(m.made('/auth/v1/logout').length).toBeGreaterThan(0);
});

test('joining asks the age first; under 18 can’t join where the institution hasn’t said they will', async ({ page }) => {
  const m = new MockBackend({ age: null });
  const inst = m.inst.seed({}, null);
  const invite = m.inst.invite(inst.id, m.user.email, 'student');
  await m.install(page);
  await page.goto(`/join/${invite.token}`);
  // The one-time question is put off, so Join asks it.
  await page.getByRole('dialog', { name: 'One question first' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Join Lagos Bay University' }).click();
  const sheet = page.getByRole('dialog', { name: 'One question first' });
  await sheet.getByRole('radio', { name: /under 18, and a parent or guardian agrees/ }).click();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Join Lagos Bay University' }).click();
  await expect(page.getByRole('alert')).toContainText('hasn’t said students under 18 will join');
  expect(m.inst.roleOf(inst.id, m.user.id)).toBeNull();
  inst.minors_consent = true;
  await page.getByRole('button', { name: 'Join Lagos Bay University' }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(m.inst.roleOf(inst.id, m.user.id)).toBe('student');
});

test('an admin says under-18s will join; a school’s stays on; staff see it', async ({ page }) => {
  const m = new MockBackend();
  const { inst } = m.inst.seedSchool();
  const school = m.inst.seed({ name: 'St Anne’s School', kind: 'school', minors_consent: true }, 'admin');
  m.inst.staff.add(m.user.id);
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}?tab=settings`);
  const section = page.getByRole('region', { name: 'Students under 18' });
  await section.getByRole('radio', { name: 'Under 18s too' }).click();
  await expect(page.getByText('Saved: students under 18 can join.')).toBeVisible();
  expect(inst.minors_consent).toBe(true);
  await page.goto(`/app/institution/${school.id}?tab=settings`);
  await expect(page.getByRole('region', { name: 'Students under 18' }).getByText(/On, as for every school/)).toBeVisible();
  await page.goto('/app/kaivon');
  await page.getByRole('tab', { name: 'Approved', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'St Anne’s School' }).getByText('Will join, with parents’ consent confirmed')).toBeVisible();
});

// ── Invites from friends, and campus reps ─────────────────────────────

test('a friend’s link: kept from the landing page through signing in, used once', async ({ page }) => {
  const m = new MockBackend();
  const grace = m.inst.person('Grace Hopper', 'grace@lagosbay.edu.ng');
  m.inst.codes.set(grace.id, 'GRACE234');
  await m.install(page, { signedIn: false });
  await page.goto('/?ref=grace234');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/signin');
  await signInByCode(page, m);
  await expect(page.getByText('Welcome. You came through Grace Hopper: you’ll both get a week of Pro once you’ve asked Chip 3 questions.')).toBeVisible();
  expect(rpcCalls(m, 'study_referral_redeem').map((c) => c.body)).toEqual([{ p_code: 'GRACE234' }]);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Up late/ })).toBeVisible();
  expect(rpcCalls(m, 'study_referral_redeem')).toHaveLength(1);
});

test('a code that can’t be used is dropped without a word', async ({ page }) => {
  const m = new MockBackend();
  m.inst.oldAccount = true;
  const grace = m.inst.person('Grace Hopper', 'grace@lagosbay.edu.ng');
  m.inst.codes.set(grace.id, 'GRACE234');
  await m.install(page);
  await page.goto('/app?ref=GRACE234');
  await expect.poll(() => rpcCalls(m, 'study_referral_redeem').length).toBe(1);
  await expect(page.getByText(/came through/)).toHaveCount(0);
  await expect(page.getByText(/can’t be used/)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('chip-study-ref'))).toBeNull();
});

test('your invite link: on the desk and in Settings, with how it’s going', async ({ page }) => {
  const m = new MockBackend();
  m.inst.codes.set(m.user.id, 'ADA23456');
  m.inst.referrals.push({ user_id: 'x1', referrer: m.user.id, rewarded: true, created_at: new Date().toISOString() }, { user_id: 'x2', referrer: m.user.id, rewarded: false, created_at: new Date().toISOString() });
  const copies = await catchCopies(page);
  await m.install(page);
  await page.goto('/app');
  const strip = page.getByRole('region', { name: 'Invite a friend' });
  await expect(strip.getByText(/You both get a week of Pro/)).toBeVisible();
  await strip.getByRole('button', { name: 'Hide this' }).click();
  await expect(strip).toHaveCount(0);
  await page.goto('/app/settings');
  const section = page.locator('#invite');
  await expect(section.getByText('https://study.kaivon.app/?ref=ADA23456')).toBeVisible();
  await section.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect.poll(copies).toContain('https://study.kaivon.app/?ref=ADA23456');
  await expect(section.getByText('1 of 12')).toBeVisible();
  await expect(section.getByText('11 more weeks of Pro to earn this year.')).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await nothingClipped(page);
});

test('Kaivon staff make a campus rep, see their sign-ups, and stop it', async ({ page }) => {
  const m = new MockBackend();
  m.inst.staff.add(m.user.id);
  const grace = m.inst.person('Grace Hopper', 'grace@lagosbay.edu.ng');
  m.inst.referrals.push({ user_id: 'x1', referrer: grace.id, rewarded: true, created_at: new Date().toISOString() });
  await m.install(page);
  await page.goto('/app/kaivon');
  await page.getByRole('radio', { name: 'Campus reps' }).click();
  await expect(page.getByText('No campus reps yet')).toBeVisible();
  await page.getByLabel('Who').fill('grace@lagosbay.edu.ng');
  await page.getByLabel('Name to show').fill('Grace, Lagos Bay');
  await page.getByRole('button', { name: 'Make a rep' }).click();
  await expect(page.getByRole('heading', { name: 'Grace, Lagos Bay' })).toBeVisible();
  await expect(page.getByText('Really used it')).toBeVisible();
  await nothingClipped(page);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('No campus reps yet')).toBeVisible();
  await page.getByLabel('Who').fill('nobody@nowhere.test');
  await page.getByLabel('Name to show').fill('Nobody');
  await page.getByRole('button', { name: 'Make a rep' }).click();
  await expect(page.getByRole('alert')).toContainText('No account has that email');
});

// ── Course tutors, class themes, new codes ────────────────────────────

test('a teacher sets how Chip helps in their course; a student links an assignment and sees it', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, 'teacher');
  const bio = m.inst.klass(inst.id, 'Biology 101');
  m.inst.inClass(bio.id, m.user.id, 'teacher');
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}?tab=classes`);
  await page.getByRole('button', { name: 'More for Biology 101' }).click();
  await page.getByRole('menuitem', { name: 'Chip for this course' }).click();
  const dialog = page.getByRole('dialog', { name: 'Chip for Biology 101' });
  await dialog.getByRole('radio', { name: 'Hints only' }).click();
  await expect(dialog.getByText(/never a worked solution/)).toBeVisible();
  await dialog.getByLabel('About the course').fill('First-year cell biology.');
  await nothingClipped(page);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. Chip follows it for Biology 101.')).toBeVisible();
  expect(bio).toMatchObject({ help_level: 'hints', course_brief: 'First-year cell biology.' });
});

test('a student links an assignment to their class, and Chip says whose guidance it follows', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, 'student');
  const bio = m.inst.klass(inst.id, 'Biology 101');
  bio.help_level = 'hints';
  m.inst.inClass(bio.id, m.user.id, 'student');
  const a = m.seedAssignment();
  await m.install(page);
  await page.goto(`/app/a/${a.id}`);
  await expect(page.locator('.doc-prose')).toBeVisible();
  await openPanel(page, 'Brief');
  await page.getByLabel('Class', { exact: true }).selectOption({ label: 'Biology 101 · Lagos Bay University' });
  await expect(page.getByText('Linked to Biology 101. Chip follows your lecturer’s guidance for it.')).toBeVisible();
  expect(m.db.study_assignments[0].class_id).toBe(bio.id);
  await expect(page.getByText('Chip follows your lecturer’s guidance for Biology 101.')).toBeVisible();
  await page.reload();
  await expect(page.locator('.doc-prose')).toBeVisible();
  await openPanel(page, 'Chip');
  await expect(page.getByText('Chip follows your lecturer’s guidance for Biology 101', { exact: true })).toBeVisible();
});

test('what a class is asking: not until 5 students have, then themes, never anyone’s chats', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, 'teacher');
  const bio = m.inst.klass(inst.id, 'Biology 101');
  m.inst.inClass(bio.id, m.user.id, 'teacher');
  m.inst.askers.set(bio.id, 3);
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}?tab=classes`);
  await page.getByRole('button', { name: 'More for Biology 101' }).click();
  await page.getByRole('menuitem', { name: 'What the class is asking' }).click();
  const dialog = page.getByRole('dialog', { name: 'What Biology 101 is asking' });
  await expect(dialog.getByText(/You never see anyone’s chats or questions/)).toBeVisible();
  await dialog.getByRole('button', { name: 'See what they’re asking' }).click();
  await expect(dialog.getByText(/Not enough yet: 3 students have asked/)).toBeVisible();
  m.inst.askers.set(bio.id, 7);
  await dialog.getByRole('button', { name: 'See what they’re asking' }).click();
  await expect(dialog.getByRole('heading', { name: 'Reading the brief' })).toBeVisible();
  await expect(dialog.getByText(/from 42 questions by 7 students/)).toBeVisible();
  await nothingClipped(page);
  expect(m.made('/functions/v1/chip-study', 'POST').map((c) => c.body)).toEqual([
    { action: 'class_themes', class_id: bio.id },
    { action: 'class_themes', class_id: bio.id },
  ]);
});

test('a class gets a new code after asking first; everyone stays in it', async ({ page }) => {
  const m = new MockBackend();
  const { inst, bio } = m.inst.seedSchool();
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}?tab=classes`);
  await page.getByRole('button', { name: 'More for Biology 101' }).click();
  await page.getByRole('menuitem', { name: 'New code' }).click();
  const ask = page.getByRole('dialog', { name: 'Give Biology 101 a new code?' });
  await expect(ask.getByText(/stops working straight away\. Everyone already in the class stays in it/)).toBeVisible();
  await ask.getByRole('button', { name: 'Make a new code' }).click();
  const shown = page.getByRole('dialog', { name: 'The new code' });
  await expect(shown).toBeVisible();
  expect(bio.code).not.toBe('K7Q2MD');
  await expect(shown.getByText(bio.code, { exact: true })).toBeVisible();
  expect(m.inst.classMembers.filter((c) => c.class_id === bio.id)).toHaveLength(3);
});

// ── Invoices ──────────────────────────────────────────────────────────

test('staff issue an invoice; the admin pays it and comes back to a confirmation; staff can cancel one', async ({ page }) => {
  const m = new MockBackend({ payOn: true });
  const { inst } = m.inst.seedSchool();
  m.inst.staff.add(m.user.id);
  await m.install(page);
  await page.route('https://checkout.flutterwave.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Checkout</h1>' }));
  await page.goto('/app/kaivon');
  await page.getByRole('tab', { name: 'Approved', exact: true }).click();
  await page.getByRole('listitem').filter({ hasText: 'Lagos Bay University' }).getByRole('button', { name: 'Invoices' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invoices for Lagos Bay University' });
  // In the institution's own currency (Nigeria's: naira), which staff can change; never euros.
  await expect(dialog.getByRole('radio', { name: '₦' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('radio')).toHaveText(['£', 'US$', '₦']);
  await dialog.getByLabel('Seats').fill('200');
  await expect(dialog.getByLabel('Amount')).toHaveValue('9000000');
  // Seats × the yearly price × months ÷ 12, in the chosen currency, until it's changed by hand.
  await dialog.getByRole('radio', { name: 'US$' }).click();
  await expect(dialog.getByLabel('Amount')).toHaveValue('9000');
  await dialog.getByRole('radio', { name: '£' }).click();
  await expect(dialog.getByLabel('Amount')).toHaveValue('7200');
  await dialog.getByRole('radio', { name: '₦' }).click();
  await expect(dialog.getByLabel('Amount')).toHaveValue('9000000');
  await dialog.getByLabel('Seats').fill('20');
  await expect(dialog.getByLabel('Amount')).toHaveValue('2250000');
  await dialog.getByLabel('Seats').fill('200');
  await dialog.getByLabel('Amount').fill('1,500,000');
  await dialog.getByLabel('Months').fill('6');
  await expect(dialog.getByLabel('Amount')).toHaveValue('1,500,000');
  await dialog.getByLabel('Months').fill('12');
  await nothingClipped(page);
  await dialog.getByRole('button', { name: 'Make the invoice' }).click();
  await expect(page.getByText('Invoice made for ₦1,500,000. Its admins can pay it in Chip Study.')).toBeVisible();
  expect(m.inst.invoices[0]).toMatchObject({ seats: 200, months: 12, currency: 'NGN', amount: 1500000, status: 'open' });
  // Picking the currency never sends the form.
  expect(rpcCalls(m, 'study_staff_invoice_create')).toHaveLength(1);
  await page.keyboard.press('Escape');

  await page.goto(`/app/institution/${inst.id}?tab=settings`);
  const invoices = page.getByRole('region', { name: 'Invoices' });
  await invoices.getByRole('button', { name: 'Pay ₦1,500,000' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  const ref = m.inst.invoices[0].ref;
  await page.goto(`/app/institution/${inst.id}?invoice=1&status=successful&tx_ref=${ref}&transaction_id=9876`);
  await expect(page.getByText(/^Paid, thank you\. Your seats run until/)).toBeVisible();
  await expect(page).toHaveURL(/\?tab=settings$/);
  expect(m.inst.invoices[0].status).toBe('paid');
  expect(inst).toMatchObject({ plan: 'paid', seats: 200 });
  await expect(invoices.getByText(/^Paid/)).toBeVisible();

  const v2 = m.inst.invoices.length;
  m.inst.invoices.push({ ...m.inst.invoices[0], id: 'inv-2', ref: 'kaivon-inv-000000000000000000000002', status: 'open', label: 'Extra seats', paid_at: null });
  await page.goto('/app/kaivon');
  await page.getByRole('tab', { name: 'Approved', exact: true }).click();
  await page.getByRole('listitem').filter({ hasText: 'Lagos Bay University' }).getByRole('button', { name: 'Invoices' }).click();
  await page.getByRole('button', { name: 'Cancel invoice' }).click();
  await page.getByRole('dialog', { name: 'Cancel this invoice?' }).getByRole('button', { name: 'Cancel invoice' }).click();
  await expect.poll(() => m.inst.invoices[v2].status).toBe('void');
});

// ── The price for institutions ────────────────────────────────────────

test.describe('from London', () => {
  test.use({ timezoneId: 'Europe/London' });

  test('the institutions page shows the price in pounds, and only pounds', async ({ page }) => {
    const m = new MockBackend();
    await m.install(page, { signedIn: false });
    await page.goto('/institutions#pricing');
    const pricing = page.locator('#pricing');
    await pricing.scrollIntoViewIfNeeded();
    await expect(pricing.getByText('£36', { exact: true }).first()).toBeVisible();
    await expect(pricing.getByText('per student per year')).toBeVisible();
    for (const other of ['$45', '€42', '₦45,000']) await expect(page.getByText(other)).toHaveCount(0);
    const faq = page.locator('details', { hasText: 'What does it cost?' });
    await faq.locator('summary').click();
    await expect(faq.getByText(/After that, £36 per student per year, billed yearly by invoice, from 50 students/)).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/[$€₦]\s?\d/);
    await page.waitForTimeout(1200);
    await nothingClipped(page);
  });
});

// ── The landing page, for schools ─────────────────────────────────────

test('the landing page shows what’s new for schools, honestly, and leads to /institutions', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/');
  const section = page.locator('#schools');
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('heading', { name: 'Bring Chip Study to your students.' })).toBeVisible();
  for (const point of [/A free pilot first/, /never chats, notes or documents/, /Moodle, Canvas, Blackboard or Brightspace/, /invite link, class code or school email/, /a lecturer’s guidance shapes Chip/]) {
    await expect(section.getByText(point).first()).toBeVisible();
  }
  const text = (await section.textContent()) ?? '';
  expect(text).not.toMatch(/[$₦]\s?\d|room/i);
  await page.waitForTimeout(1200);
  await nothingClipped(page);
  // In the nav: beside the sections on wide screens, in the menu on smaller ones; and in the footer.
  if ((page.viewportSize()?.width ?? 0) < 1024) await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'For institutions' }).filter({ visible: true })).toHaveCount(1);
  await expect(page.locator('footer').getByRole('link', { name: 'For institutions' })).toBeAttached();
  await section.getByRole('link', { name: /Chip Study for institutions/ }).click();
  await expect(page).toHaveURL(/\/institutions$/);
});

// ── Study guides, prices in naira, sign-in buttons ────────────────────

test('the study guides: their own title, description and address, linked from every footer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: 'Spaced repetition' }).click();
  await expect(page).toHaveURL(/\/guides\/spaced-repetition$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Spaced repetition: remember what you learn');
  await expect(page).toHaveTitle('Spaced repetition explained, and how to use it · Chip Study');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /reviewing at growing intervals/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://study.kaivon.app/guides/spaced-repetition');
  expect(JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}')).toMatchObject({ '@type': 'Article', headline: 'Spaced repetition: remember what you learn' });
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await nothingClipped(page);
  for (const slug of ['how-to-study-for-exams', 'active-recall', 'using-ai-without-cheating']) {
    await page.goto(`/guides/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await nothingClipped(page);
  }
  await page.goto('/guides/not-a-guide');
  await expect(page.getByRole('heading', { name: 'This page wandered off' })).toBeVisible();
  const sitemap = readFileSync('public/sitemap.xml', 'utf8');
  for (const slug of ['how-to-study-for-exams', 'spaced-repetition', 'active-recall', 'using-ai-without-cheating']) expect(sitemap).toContain(`https://study.kaivon.app/guides/${slug}`);
  expect(errors).toEqual([]);
});

test('in Nigeria, prices are in naira, and the note says so', async ({ page }) => {
  const m = new MockBackend({ payOn: true });
  await m.install(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByText('₦7,990', { exact: true })).toBeAttached();
  await expect(page.getByText('Prices in naira. Payments by Flutterwave.')).toBeAttached();
  await expect(page.getByText(/Prices in US dollars/)).toHaveCount(0);
});

test('in Nigeria, Pro is bought in naira', async ({ page }) => {
  const m = new MockBackend({ payOn: true });
  await m.install(page);
  await page.route('https://checkout.flutterwave.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Checkout</h1>' }));
  await page.goto('/app/plan');
  await expect(page.getByText('Prices in naira. Payments by Flutterwave.')).toBeVisible();
  await page.getByRole('button', { name: 'Go Pro for ₦7,990 a month' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  const asked = m.made('/functions/v1/web-pay', 'POST').map((r) => r.body as { action: string; currency?: string }).filter((b) => b.action === 'subscribe');
  expect(asked.at(-1)).toMatchObject({ plan: 'study.pro.monthly', currency: 'NGN' });
});

test('sign-in with Google and Microsoft stays hidden until it’s switched on', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: 'Sign in to Chip Study' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with (Google|Microsoft)/ })).toHaveCount(0);
});
