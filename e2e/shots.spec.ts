import { expect, test, type Page } from '@playwright/test';
import { nothingClipped } from './layout';
import { MockBackend } from './mock';

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
  for (const id of ['why', 'get', 'privacy', 'pilot', 'faq']) {
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
  await expect(page.getByText(/with nothing to pay/)).toBeVisible();
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
