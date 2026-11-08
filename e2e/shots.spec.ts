import { expect, test, type Page } from '@playwright/test';
import { nothingClipped } from './layout';
import { MockBackend } from './mock';
import { MockRoomServer } from './mock-room-server';

/** Every main screen at each size, saved under shots/ to look at, and checked for anything
 * pushed off the side of the screen. */

const dir = (name: string, project: string) => `${process.env.SHOTS_DIR ?? 'shots'}/${project}/${name}.png`;

async function noSideScroll(page: Page) {
  await nothingClipped(page);
}

test('landing', async ({ page }, info) => {
  test.setTimeout(240_000);
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Understand anything');
  await page.waitForTimeout(1600);
  await noSideScroll(page);
  await page.screenshot({ path: dir('landing-top', info.project.name) });
  // Down the page a screen at a time: each screenful saved, and checked once it has risen in.
  const height = await page.evaluate(() => document.body.scrollHeight);
  const screen = page.viewportSize()!.height;
  for (let i = 0, y = 0; y < height && i < 40; i++, y += screen) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    await page.waitForTimeout(1100);
    await noSideScroll(page);
    await page.screenshot({ path: dir(`landing-${String(i + 1).padStart(2, '0')}`, info.project.name) });
  }
  await page.locator('#pricing').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: dir('pricing', info.project.name) });
});

test('sign in', async ({ page }, info) => {
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: 'Sign in to Chip Study' })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: dir('signin', info.project.name) });
});

test('dashboard', async ({ page }, info) => {
  const m = new MockBackend();
  const a = m.seedAssignment();
  m.insert('study_tasks', { assignment_id: a.id, title: 'Read the set chapters', due_on: new Date().toISOString().slice(0, 10) });
  m.insert('study_tasks', { assignment_id: a.id, title: 'Outline', done: true });
  m.seedAssignment({ title: 'Lab report: enzyme kinetics', course: 'BIO 110', color: 'mint', words: 640, word_target: 2000, due_at: new Date(Date.now() + 9 * 86_400_000).toISOString() });
  m.insert('study_focus', { minutes: 50, started_at: new Date(Date.now() - 2 * 3_600_000).toISOString() });
  await m.install(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Up late/ })).toBeVisible();
  await expect(page.getByText('Coastal erosion essay').first()).toBeVisible();
  await page.waitForTimeout(900);
  await noSideScroll(page);
  await page.screenshot({ path: dir('dashboard', info.project.name), fullPage: true });
});

test('workspace with Chip', async ({ page }, info) => {
  const m = new MockBackend({ tier: 'pro' });
  m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('link', { name: /Coastal erosion essay/ }).first().click();
  const editor = page.locator('.doc-prose');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('Coastal towns face a hard choice. ');
  const isWide = (page.viewportSize()?.width ?? 0) >= 1100;
  if (!isWide) await page.getByRole('button', { name: 'Chip', exact: true }).click();
  await page.getByRole('tab', { name: 'Check' }).click();
  await page.getByRole('textbox', { name: 'Message to Chip' }).fill('Check my draft against the rubric');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Against your rubric')).toBeVisible();
  await page.waitForTimeout(1200);
  await noSideScroll(page);
  await page.screenshot({ path: dir('workspace-chip', info.project.name) });
});

test('focus mode', async ({ page }, info) => {
  const m = new MockBackend();
  m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('link', { name: /Coastal erosion essay/ }).first().click();
  await expect(page.locator('.doc-prose')).toBeVisible();
  const wide = (page.viewportSize()?.width ?? 0) >= 1100;
  if (wide) await page.getByRole('banner').getByRole('button', { name: 'Focus' }).click();
  else await page.locator('.ws-mobilebar').getByRole('button', { name: 'Focus' }).click();
  await expect(page.locator('.focus-bar')).toBeVisible();
  await page.waitForTimeout(800);
  await noSideScroll(page);
  await page.screenshot({ path: dir('focus', info.project.name) });
});

test('plan page', async ({ page }, info) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app/plan');
  await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible();
  await expect(page.getByText('Coming soon')).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: dir('plan', info.project.name), fullPage: true });
});

test('review and progress', async ({ page }, info) => {
  const m = new MockBackend();
  for (const [front, back, reps, interval] of [
    ['What is the product rule?', '(uv)′ = u·v′ + v·u′', 0, 0],
    ['Chain rule', 'd/dx f(g(x)) = f′(g(x))·g′(x)', 3, 30],
    ['Derivative of $\\sin x$', '$\\cos x$', 2, 6],
  ] as const) {
    m.insert('study_cards', { front, back, reps, interval_days: interval, due_at: interval ? new Date(Date.now() + interval * 86_400_000).toISOString() : new Date().toISOString() });
  }
  m.insert('study_practice', { kind: 'quiz', correct: 4, total: 5 });
  m.insert('study_focus', { minutes: 50 });
  await m.install(page);
  await page.goto('/app/review');
  await expect(page.getByText('1 card to review')).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: dir('review', info.project.name), fullPage: true });
  await page.getByRole('button', { name: 'Start reviewing' }).click();
  await page.getByRole('button', { name: 'Show the answer' }).click();
  await noSideScroll(page);
  await page.screenshot({ path: dir('review-card', info.project.name) });
});

test('something to learn, with Chip guiding', async ({ page }, info) => {
  const m = new MockBackend();
  m.seedAssignment({ title: 'Calculus: derivatives', course: 'MATH 120', kind: 'topic', brief: 'Differentiate products and compositions for my exam.', rubric: '', word_target: null });
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('link', { name: /Calculus: derivatives/ }).first().click();
  await expect(page.locator('.doc-prose')).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 1100) await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Chip' }).click();
  await page.getByRole('textbox', { name: 'Message to Chip' }).fill('How do I differentiate x·eˣ?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Before I tell you')).toBeVisible();
  await page.waitForTimeout(600);
  await noSideScroll(page);
  await page.screenshot({ path: dir('topic-guide', info.project.name) });
});

// ── Institutions ──────────────────────────────────────────────────────

test('institutions page', async ({ page }, info) => {
  test.setTimeout(120_000);
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/institutions');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Learning with AI');
  await page.waitForTimeout(1600);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institutions-top', info.project.name) });
  for (const id of ['why', 'get', 'privacy', 'pilot', 'pricing', 'faq']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.evaluate((x) => document.getElementById(x)?.scrollIntoView({ block: 'start', behavior: 'instant' }), id);
    await page.waitForTimeout(1200);
    await noSideScroll(page);
    await page.screenshot({ path: dir(`institutions-${id}`, info.project.name) });
  }
});

test('registering an institution', async ({ page }, info) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app/institutions/new');
  await expect(page.getByRole('heading', { name: 'Register your institution' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institution-register', info.project.name), fullPage: true });
});

test('an institution’s dashboard', async ({ page }, info) => {
  test.setTimeout(120_000);
  const m = new MockBackend();
  const { inst } = m.inst.seedSchool();
  m.inst.invite(inst.id, 'waiting@lagosbay.edu.ng', 'student', m.inst.classes[0].id);
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}`);
  await expect(page.getByRole('heading', { name: 'Study time, week by week' })).toBeVisible();
  await page.waitForTimeout(900);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institution-overview', info.project.name), fullPage: true });

  await page.getByRole('tab', { name: 'Students' }).click();
  await expect(page.getByText('Grace Hopper').filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(400);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institution-students', info.project.name), fullPage: true });
  await page.getByRole('button', { name: 'Open Grace Hopper', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('dialog').getByText('AI-use record').first()).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institution-student', info.project.name) });
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Classes' }).click();
  await expect(page.getByText('K7Q2MD')).toBeVisible();
  await page.waitForTimeout(400);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institution-classes', info.project.name), fullPage: true });
  await page.getByLabel('New class').fill('Chemistry 201');
  await page.getByRole('button', { name: 'Make class' }).click();
  await expect(page.getByRole('dialog', { name: 'Your class is ready' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institution-class-made', info.project.name) });
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Invite' }).click();
  await page.getByRole('textbox', { name: 'Emails' }).fill('ada.long.name@lagosbay.edu.ng\ngrace@lagosbay.edu.ng\nnew2@lagosbay.edu.ng, oops.lagosbay.edu.ng');
  await page.getByRole('button', { name: /Make \d invite links?/ }).click();
  await expect(page.getByRole('heading', { name: /links? ready/ })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institution-invite', info.project.name), fullPage: true });

  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await page.waitForTimeout(400);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institution-settings', info.project.name), fullPage: true });
});

test('a pending institution', async ({ page }, info) => {
  const m = new MockBackend();
  const inst = m.inst.seed({ status: 'pending', seats: 0, pilot_ends: null }, 'admin');
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}`);
  await expect(page.getByText(/Kaivon is checking/)).toBeVisible();
  await page.waitForTimeout(600);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institution-pending', info.project.name), fullPage: true });
});

test('joining: an invite link, a class code and a school email', async ({ page }, info) => {
  const m = new MockBackend();
  const inst = m.inst.seed({ email_domain: 'school.edu' }, null);
  const bio = m.inst.klass(inst.id, 'Biology 101', 'K7Q2MD');
  const invite = m.inst.invite(inst.id, m.user.email, 'student', bio.id);
  await m.install(page);
  await page.goto(`/join/${invite.token}`);
  await expect(page.getByRole('heading', { name: 'Join Lagos Bay University' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('join-invite', info.project.name), fullPage: true });

  await page.goto('/app');
  await expect(page.getByRole('region', { name: 'Your school is on Chip Study' })).toBeVisible();
  await page.waitForTimeout(900);
  await noSideScroll(page);
  await page.screenshot({ path: dir('join-school-card', info.project.name) });
  await page.getByRole('button', { name: 'Join a class' }).click();
  await page.getByLabel('Class code').fill('K7Q2MD');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Join Biology 101?' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('join-class', info.project.name) });
});

test('settings and the plan, with an institution', async ({ page }, info) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, 'student');
  const bio = m.inst.klass(inst.id, 'Biology 101');
  m.inst.inClass(bio.id, m.user.id, 'student');
  await m.install(page);
  await page.goto('/app/settings');
  await expect(page.locator('#institution').getByText('Biology 101')).toBeVisible();
  await page.locator('#institution').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await noSideScroll(page);
  await page.screenshot({ path: dir('settings-institution', info.project.name) });
  await page.goto('/app/plan');
  await expect(page.getByText(/It’s yours while you’re part of/)).toBeVisible();
  await page.waitForTimeout(400);
  await noSideScroll(page);
  await page.screenshot({ path: dir('plan-institution', info.project.name), fullPage: true });
});

test('Kaivon review', async ({ page }, info) => {
  const m = new MockBackend();
  m.inst.staff.add(m.user.id);
  m.inst.seed({ name: 'Harbour College', kind: 'college', country: 'GB', status: 'pending', seats: 0, pilot_ends: null, reviewed_at: null, domain_requested: 'harbour.ac.uk', contact_name: 'Femi Ade', contact_role: 'Registrar', students_estimate: 800 }, null);
  m.inst.seed({ name: 'St Anne’s Secondary School', kind: 'school', status: 'pending', seats: 0, pilot_ends: null, reviewed_at: null, domain_requested: '', website: '' }, null);
  await m.install(page);
  await page.goto('/app/kaivon');
  await expect(page.getByRole('heading', { name: 'Harbour College' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('kaivon-review', info.project.name), fullPage: true });
  await page.getByRole('listitem').filter({ hasText: 'Harbour College' }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('dialog', { name: 'Approve Harbour College' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('kaivon-approve', info.project.name) });
});

// ── Batch 2: platforms, age, invites, tutors, themes, invoices, guides ──

test('arriving from a course', async ({ page }, info) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, null);
  m.inst.platforms.push({ id: 'p1', institution_id: inst.id, name: 'Moodle', issuer: 'https://moodle.lagosbay.edu.ng', client_id: 'c1', deployment_id: 'd1', auth_url: 'https://moodle.lagosbay.edu.ng/auth', jwks_url: 'https://moodle.lagosbay.edu.ng/certs', created_at: new Date().toISOString(), courses: 0 });
  m.inst.pending.push({ token: 'link-1', platform_id: 'p1', email: 'ada@personal.test', teacher: false, course: 'Physics 110: Mechanics' });
  await m.install(page, { signedIn: false });
  await page.goto('/lti#link=link-1');
  await expect(page.getByRole('heading', { name: 'Link your course to Chip Study' })).toBeVisible();
  await page.waitForTimeout(400);
  await noSideScroll(page);
  await page.screenshot({ path: dir('lti-link', info.project.name), fullPage: true });
  await page.goto('about:blank');
  await page.goto(`/lti#token_hash=x&type=magiclink&role=student&confirm=${encodeURIComponent(m.user.email)}`);
  await expect(page.getByRole('heading', { name: /Continue as/ })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: dir('lti-confirm', info.project.name) });
  await page.goto('about:blank');
  await page.goto('/lti#error=unknown_platform');
  await expect(page.getByRole('heading', { name: 'This platform isn’t connected yet' })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: dir('lti-error', info.project.name) });
});

test('the age question and the platform consent', async ({ page }, info) => {
  const m = new MockBackend({ age: null });
  const inst = m.inst.seed({}, null);
  m.inst.join(inst.id, m.user.id, 'student', false);
  await m.install(page);
  await page.goto('/app');
  await expect(page.getByRole('dialog', { name: 'One question first' })).toBeVisible();
  await page.getByRole('radio', { name: /under 18, and a parent/ }).click();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('age-question', info.project.name) });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('dialog', { name: 'What Lagos Bay University can see' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('platform-consent', info.project.name) });
});

test('an admin’s platform, under-18s and invoices settings', async ({ page }, info) => {
  const m = new MockBackend();
  const { inst } = m.inst.seedSchool();
  m.inst.platforms.push({ id: 'p1', institution_id: inst.id, name: 'Canvas', issuer: 'https://canvas.instructure.com', client_id: '10000000000123', deployment_id: '42:7db438071375c02373713c12c73869ff2f470b68', auth_url: 'https://sso.canvaslms.com/api/lti/authorize_redirect', jwks_url: 'https://sso.canvaslms.com/api/lti/security/jwks', created_at: new Date().toISOString(), courses: 3 });
  m.inst.invoices.push({ id: 'inv-1', institution_id: inst.id, ref: 'kaivon-inv-000000000000000000000001', label: 'Lagos Bay University: 200 seats, 12 months', seats: 200, months: 12, currency: 'NGN', amount: 1500000, status: 'open', created_at: new Date().toISOString(), paid_at: null });
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}?tab=settings`);
  await expect(page.getByRole('region', { name: 'Learning platform' })).toBeVisible();
  await page.getByRole('region', { name: 'Learning platform' }).getByRole('radio', { name: 'Blackboard' }).click();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('institution-settings-2', info.project.name), fullPage: true });
});

test('invites, tutors and themes', async ({ page }, info) => {
  const m = new MockBackend();
  m.inst.codes.set(m.user.id, 'ADA23456');
  m.inst.referrals.push({ user_id: 'x1', referrer: m.user.id, rewarded: true, created_at: new Date().toISOString() });
  const inst = m.inst.seed({}, 'teacher');
  const bio = m.inst.klass(inst.id, 'Biology 101');
  m.inst.inClass(bio.id, m.user.id, 'teacher');
  m.inst.askers.set(bio.id, 9);
  await m.install(page);
  await page.goto('/app/settings');
  await page.locator('#invite').scrollIntoViewIfNeeded();
  await expect(page.locator('#invite').getByText('https://study.kaivon.app/?ref=ADA23456')).toBeVisible();
  await page.waitForTimeout(400);
  await noSideScroll(page);
  await page.screenshot({ path: dir('settings-invite', info.project.name) });
  await page.goto(`/app/institution/${inst.id}?tab=classes`);
  await page.getByRole('button', { name: 'More for Biology 101' }).click();
  await page.getByRole('menuitem', { name: 'Chip for this course' }).click();
  await expect(page.getByRole('dialog', { name: 'Chip for Biology 101' }).getByText('How much Chip may help', { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('class-tutor', info.project.name) });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'More for Biology 101' }).click();
  await page.getByRole('menuitem', { name: 'What the class is asking' }).click();
  await page.getByRole('button', { name: 'See what they’re asking' }).click();
  await expect(page.getByRole('heading', { name: 'Reading the brief' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('class-themes', info.project.name) });
});

test('Kaivon reps and invoices', async ({ page }, info) => {
  const m = new MockBackend();
  m.inst.staff.add(m.user.id);
  m.inst.seedSchool();
  const grace = m.inst.person('Grace Hopper', 'grace@lagosbay.edu.ng');
  m.inst.reps.set(grace.id, { name: 'Grace, Lagos Bay', since: new Date().toISOString() });
  m.inst.referrals.push({ user_id: 'x1', referrer: grace.id, rewarded: true, created_at: new Date().toISOString() });
  await m.install(page);
  await page.goto('/app/kaivon');
  await page.getByRole('radio', { name: 'Campus reps' }).click();
  await expect(page.getByRole('heading', { name: 'Grace, Lagos Bay' })).toBeVisible();
  await page.waitForTimeout(400);
  await noSideScroll(page);
  await page.screenshot({ path: dir('kaivon-reps', info.project.name), fullPage: true });
  await page.getByRole('radio', { name: 'Institutions' }).click();
  await page.getByRole('tab', { name: 'Approved', exact: true }).click();
  await page.getByRole('listitem').filter({ hasText: 'Lagos Bay University' }).getByRole('button', { name: 'Invoices' }).click();
  await expect(page.getByRole('dialog', { name: 'Invoices for Lagos Bay University' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('kaivon-invoices', info.project.name) });
});

test('study guide', async ({ page }, info) => {
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/guides/active-recall');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('guide-top', info.project.name) });
  await page.getByRole('heading', { name: 'Sources' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: dir('guide-end', info.project.name) });
});

test('landing, for schools', async ({ page }, info) => {
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/');
  await page.locator('#schools').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById('schools')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.waitForTimeout(1400);
  await noSideScroll(page);
  await page.screenshot({ path: dir('landing-schools', info.project.name) });
});

// ── Study rooms ───────────────────────────────────────────────────────


const GRACE_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const BEN_ID = 'eeeeeeee-0000-4000-8000-000000000002';

/** Ada's essay in a room Grace hosts (or Ada, with [host]), with Grace and Ben there. */
async function roomSetup(page: Page, o: { host?: boolean; tier?: 'free' | 'pro' } = {}) {
  const m = new MockBackend({ tier: o.tier ?? 'free' });
  const a = m.seedAssignment({ title: 'Coastal erosion essay' });
  const doc = m.db.study_documents.find((d) => d.assignment_id === a.id)!;
  doc.content = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Holding the line, or stepping back' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Sea walls protect the town behind them, but they move the problem along the coast: the beach in front narrows, and the next town loses its sand.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Managed retreat costs less over fifty years, yet it asks people to leave homes their families have lived in for generations.' }] },
    ],
  };
  m.insert('study_notes', { assignment_id: a.id, body: 'Ask about managed retreat in Lagos', pinned: true });
  m.insert('study_tasks', { assignment_id: a.id, title: 'Read chapter 4 on groynes', due_on: new Date().toISOString().slice(0, 10) });
  m.insert('study_tasks', { assignment_id: a.id, title: 'Draft the counter-argument', due_on: null });
  const room = o.host ? m.rooms.seed(a.id, {}) : m.rooms.seed(a.id, { host_id: GRACE_ID, hostName: 'Grace Hopper', ends_at: new Date(Date.now() + 47 * 60_000).toISOString() });
  const server = new MockRoomServer(m.rooms, () => ({ id: m.user.id, name: 'Ada Lovelace' }));
  if (!o.host) server.join({ userId: GRACE_ID, name: 'Grace Hopper', role: 'host', canEdit: true });
  server.join({ userId: BEN_ID, name: 'Ben Okafor', role: 'member' });
  if (o.host) m.rooms.member(room, 'Ben Okafor', { user_id: BEN_ID });
  server.pubs = [{ userId: GRACE_ID, sessionId: 's-grace', trackName: `${GRACE_ID}:audio`, kind: 'audio', rids: [] }];
  await m.install(page);
  await server.install(page);
  return { m, server, room, a };
}

/** Opens a room panel: from its tab when the panels are showing, or from the controls. */
async function roomPanel(page: Page, name: 'People' | 'Chat' | 'Chip') {
  const tabs = page.getByRole('navigation', { name: 'Room panels' });
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  else await page.getByRole('toolbar', { name: 'Room controls' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

async function roomEnter(page: Page, token: string) {
  await page.goto(`/room/${token}`);
  await page.getByRole('button', { name: 'Join now' }).click();
  await expect(page.getByRole('toolbar', { name: 'Room controls' })).toBeVisible();
  await expect(page.locator('.doc-prose')).toBeVisible();
}

test('room lobby and waiting room', async ({ page, browserName }, info) => {
  const { room, m } = await roomSetup(page);
  await page.goto(`/room/${room.token}`);
  await expect(page.getByRole('heading', { name: 'Coastal erosion essay' })).toBeVisible();
  await expect(page.getByText(/Good connection|A slow connection/)).toBeVisible();
  // Settled: the camera on (a browser that already allows it), or the button to turn it on.
  const turnOn = page.getByRole('button', { name: 'Turn on camera and microphone' });
  await expect(page.getByLabel('Your camera', { exact: true }).or(turnOn).first()).toBeVisible();
  await page.waitForTimeout(600);
  await noSideScroll(page);
  await page.screenshot({ path: dir('room-lobby', info.project.name), fullPage: true });
  if (browserName === 'chromium') {
    if (await turnOn.isVisible()) await turnOn.click();
    await expect(page.getByLabel('Your camera', { exact: true })).toBeVisible();
    await page.waitForTimeout(700);
    await noSideScroll(page);
    await page.screenshot({ path: dir('room-lobby-camera', info.project.name), fullPage: true });
  }
  room.admission = 'ask';
  await page.goto(`/room/${room.token}`);
  await page.getByRole('button', { name: 'Ask to join' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting to be let in' })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: dir('room-waiting', info.project.name) });
  room.status = 'ended';
  room.members = room.members.filter((x) => x.user_id !== m.user.id);
  await page.goto(`/room/${room.token}`);
  await expect(page.getByRole('heading', { name: 'This room has ended' })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: dir('room-ended-link', info.project.name) });
});

test('room: the shared work, tiles and controls', async ({ page }, info) => {
  const { room, server } = await roomSetup(page);
  await roomEnter(page, room.token);
  await page.waitForTimeout(900);
  await noSideScroll(page);
  await page.screenshot({ path: dir('room', info.project.name) });
  // Someone else's cursor in the document, with their name.
  server.push({ t: 'hand', userId: BEN_ID, up: true });
  await roomPanel(page, 'People');
  await expect(page.getByText('Ben Okafor').first()).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.mouse.move(2, 2);
  await page.screenshot({ path: dir('room-people', info.project.name) });
});

test('room: chat and the shared Chip', async ({ page }, info) => {
  const { room, server } = await roomSetup(page);
  room.tutor = { class: 'Geography 201', institution: 'Lagos Bay University', course_brief: '', help_level: 'guide', tutor_notes: '' };
  await roomEnter(page, room.token);
  server.push({ t: 'chat', id: 'g1', from: { userId: GRACE_ID, name: 'Grace Hopper' }, text: 'I’ll take the counter-argument. Notes: https://example.com/coasts', at: Date.now() - 120_000 });
  server.push({ t: 'chat', id: 'b1', from: { userId: BEN_ID, name: 'Ben Okafor' }, text: 'I can find the figures for Lagos.', at: Date.now() - 60_000 });
  await roomPanel(page, 'Chat');
  await page.getByRole('textbox', { name: 'Message to everyone in the room' }).fill('Great, I’ll tighten the introduction.');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Great, I’ll tighten the introduction.')).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.mouse.move(2, 2);
  await page.screenshot({ path: dir('room-chat', info.project.name) });
  server.push({ t: 'chip', id: 'grace1', from: { userId: GRACE_ID, name: 'Grace Hopper' }, question: 'What is a groyne, in one line?', answer: 'A low wall built out into the sea that traps sand, so the beach behind it stays wide.', done: true, at: Date.now() - 30_000 });
  await roomPanel(page, 'Chip');
  await page.getByRole('tab', { name: 'Write' }).click();
  await page.getByRole('textbox', { name: 'Message to Chip, for everyone' }).fill('Help us start the introduction');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Coastal towns face a hard choice')).toBeVisible();
  await page.waitForTimeout(700);
  await noSideScroll(page);
  await page.mouse.move(2, 2);
  await page.screenshot({ path: dir('room-chip', info.project.name) });
});

test('room: read-only, the stage, and a host’s view', async ({ page }, info) => {
  const { room, server, m } = await roomSetup(page, { host: true });
  m.rooms.member(room, 'Wren Adeyemi', { state: 'waiting' });
  room.ends_at = new Date(Date.now() + 4 * 60_000).toISOString();
  await roomEnter(page, room.token);
  const invite = page.getByRole('dialog', { name: 'Invite people to study with you' });
  await page.getByRole('toolbar', { name: 'Room controls' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Invite people' }).click();
  await expect(invite).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('room-invite', info.project.name) });
  await invite.getByRole('button', { name: 'Close' }).click();
  await roomPanel(page, 'People');
  await expect(page.getByText('Wren Adeyemi')).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.mouse.move(2, 2);
  await page.screenshot({ path: dir('room-host', info.project.name) });
  await page.keyboard.press('Escape');
  server.push({ t: 'pubs', publications: [...server.pubs, { userId: BEN_ID, sessionId: 's-ben', trackName: `${BEN_ID}:screen`, kind: 'screen', rids: [] }] });
  await expect(page.getByRole('region', { name: 'Ben Okafor’s screen' })).toBeVisible();
  await page.waitForTimeout(600);
  await noSideScroll(page);
  await page.mouse.move(2, 2);
  await page.screenshot({ path: dir('room-stage', info.project.name) });
});

test('room: viewing only, and the end', async ({ page }, info) => {
  const { room, server, m, a } = await roomSetup(page);
  room.edit_mode = 'chosen';
  room.members.push({ user_id: m.user.id, name: 'Ada Lovelace', role: 'member', state: 'in', can_edit: false, joined_at: new Date().toISOString() });
  const doc = m.db.study_documents.find((d) => d.assignment_id === a.id)!;
  server.fill(String(doc.id), 'Draft', 'Sea walls protect the town behind them, but they move the problem along the coast.');
  await roomEnter(page, room.token);
  await expect(page.getByText('You’re viewing. A host can let you edit.')).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('room-viewing', info.project.name) });
  server.end('time');
  await expect(page.getByRole('heading', { name: 'Time’s up' })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: dir('room-ended', info.project.name) });
});

test('study together, from the workspace', async ({ page }, info) => {
  const m = new MockBackend({ tier: 'free' });
  const inst = m.inst.seed({}, 'teacher');
  void inst;
  const a = m.seedAssignment({ title: 'Coastal erosion essay' });
  await m.install(page);
  await page.goto(`/app/a/${a.id}`);
  await expect(page.locator('.doc-prose')).toBeVisible();
  await page.getByRole('button', { name: /Study together/ }).click();
  await expect(page.getByRole('dialog', { name: 'Study together' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('room-study-together', info.project.name) });
  await page.getByRole('dialog', { name: 'Study together' }).getByRole('button', { name: 'Open the room' }).click();
  await expect(page.getByRole('dialog', { name: 'Invite people to study with you' })).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  await page.screenshot({ path: dir('room-share', info.project.name) });
});
