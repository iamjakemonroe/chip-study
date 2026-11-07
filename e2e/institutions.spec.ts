import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { nothingClipped } from './layout';
import { MockBackend } from './mock';

/** Chip Study for schools, colleges and universities, on every browser and size: the page for
 * institutions, registering one, an admin's dashboard (overview, students, classes, settings),
 * invite links, joining by link, by class code and by school email (each after saying what
 * joining means), Pro through an institution, and Kaivon's review. */

/** Keeps what the page copies, instead of the real clipboard (which WebKit won't let a test read). */
async function catchCopies(page: Page) {
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.assign(window, { copied });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
  });
  return () => page.evaluate(() => (window as unknown as { copied: string[] }).copied);
}

/** The calls the app made to function [fn] (just it, not others whose names start the same). */
const rpcCalls = (m: MockBackend, fn: string) => m.made(`/rest/v1/rpc/${fn}`).filter((c) => c.path === `/rest/v1/rpc/${fn}`);

const visible = (page: Page, role: 'button' | 'link', name: string) => page.getByRole(role, { name, exact: true }).filter({ visible: true });

test('the page for institutions: who it’s for, what staff can and can’t see, and registering', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: 'For institutions' }).click();
  await expect(page).toHaveURL(/\/institutions$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learning with AI, honestly.');
  await expect(page.getByText('works alongside the AI tools you already give students').first()).toBeAttached();
  await expect(page.getByText('Staff can see', { exact: true })).toBeAttached();
  await expect(page.getByText('Staff can’t see', { exact: true })).toBeAttached();
  await expect(page.getByText('Chats with Chip', { exact: true })).toBeAttached();
  const faq = page.locator('details', { hasText: 'We already give students an AI tool' });
  await faq.locator('summary').click();
  await expect(faq.getByText(/Keep it\. Chip Study works alongside/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ask us about pricing' })).toHaveAttribute('href', /^mailto:support@kaivon\.app/);
  // No price list, no made-up numbers.
  expect(await page.locator('main').textContent()).not.toMatch(/[$₦]\s?\d/);
  await nothingClipped(page);
  await page.getByRole('link', { name: /Register your institution/ }).first().click();
  await expect(page).toHaveURL(/\/signin\?next=%2Fapp%2Finstitutions%2Fnew$/);
  expect(errors).toEqual([]);
});

test('registering an institution: the form, then waiting for Kaivon to check it', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app/institutions/new');
  await expect(page.getByRole('heading', { name: 'Register your institution' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Lagos Bay School');
  await page.getByRole('radio', { name: 'School' }).click();
  await page.getByLabel('Country').selectOption('NG');
  await page.getByLabel('Website').fill('www.lagosbay.sch.ng');
  await page.getByLabel('Website').blur();
  const domain = page.getByLabel('Students’ email domain');
  await expect(domain).toHaveValue('lagosbay.sch.ng');
  await domain.fill('gmail.com');
  await page.getByLabel('Your role there').fill('Head teacher');
  await page.getByLabel('About how many students').fill('1,200');
  await page.getByRole('button', { name: 'Send for checking' }).click();
  await expect(page.getByText('That’s a public email domain.')).toBeVisible();
  await expect(page.getByText('Schools confirm this before students under 18 can join.')).toBeVisible();
  expect(m.made('/rest/v1/rpc/study_institution_register')).toHaveLength(0);
  await domain.fill('@LagosBay.sch.ng');
  await page.getByRole('checkbox', { name: /Students under 18 will join/ }).check();
  await nothingClipped(page);
  await page.getByRole('button', { name: 'Send for checking' }).click();
  await expect(page.getByRole('heading', { name: 'Thanks. We’re checking Lagos Bay School.' })).toBeVisible();
  expect(m.made('/rest/v1/rpc/study_institution_register')[0].body).toMatchObject({
    p_name: 'Lagos Bay School',
    p_kind: 'school',
    p_country: 'NG',
    p_website: 'https://www.lagosbay.sch.ng',
    p_email_domain: 'lagosbay.sch.ng',
    p_contact_role: 'Head teacher',
    p_students_estimate: 1200,
    p_minors_consent: true,
  });
  await page.getByRole('link', { name: /Open the dashboard/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lagos Bay School' })).toBeVisible();
  await expect(page.getByText('Kaivon is checking Lagos Bay School.')).toBeVisible();
  await expect(page.getByText('Waiting for Kaivon', { exact: true })).toBeVisible();
  // Students can't be invited until it's approved; teachers and admins can.
  await page.getByRole('tab', { name: 'Invite' }).click();
  await expect(page.getByText(/Students can join once Kaivon has approved Lagos Bay School/)).toBeVisible();
  await page.getByRole('radio', { name: 'Teachers' }).click();
  await expect(page.getByText(/Students can join once/)).toHaveCount(0);
  await nothingClipped(page);
});

test('an admin’s dashboard: this week, the students, and a student’s record', async ({ page }) => {
  const m = new MockBackend();
  const { inst } = m.inst.seedSchool();
  await m.install(page);
  await page.goto('/app');
  // Reached from the desk.
  await page.getByRole('link', { name: /Lagos Bay University/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/institution/${inst.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Lagos Bay University' })).toBeVisible();
  await expect(page.getByText(/Free pilot until/)).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Seats used' })).toHaveAttribute('aria-valuenow', '3');
  await expect(page.getByText('of 50 used')).toBeVisible();
  await expect(page.getByText('Questions to Chip')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Study time, week by week' })).toBeVisible();
  await page.getByRole('radio', { name: 'Active students' }).click();
  await expect(page.getByRole('heading', { name: 'Active students, week by week' })).toBeVisible();
  await nothingClipped(page);

  await page.getByRole('tab', { name: 'Students' }).click();
  await expect(visible(page, 'button', 'Open Grace Hopper')).toBeVisible();
  await expect(visible(page, 'button', 'Open Katherine Johnson')).toBeVisible();
  await nothingClipped(page);
  await page.getByRole('searchbox', { name: 'Search by name or email' }).fill('alan');
  await expect(visible(page, 'button', 'Open Grace Hopper')).toHaveCount(0);
  await expect(visible(page, 'button', 'Open Alan Turing')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search by name or email' }).fill('');
  await page.getByLabel('Class').selectOption({ label: 'Biology 101' });
  await expect(visible(page, 'button', 'Open Katherine Johnson')).toHaveCount(0);
  await expect(visible(page, 'button', 'Open Grace Hopper')).toBeVisible();
  expect(m.made('/rest/v1/rpc/study_institution_students').some((c) => (c.body as { p_class: string | null }).p_class === m.inst.classes[0].id)).toBe(true);

  await visible(page, 'button', 'Open Grace Hopper').click();
  const panel = page.getByRole('dialog', { name: 'Grace Hopper' });
  await expect(panel.getByText('Essay: Coastal erosion')).toBeVisible();
  await expect(panel.getByText('Put Chip’s words into the document')).toBeVisible();
  await expect(panel.getByText(/Their chats with Chip, notes and documents are private/)).toBeVisible();
  await nothingClipped(page);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('an admin changes a role and takes someone out, asking first', async ({ page }) => {
  const m = new MockBackend();
  const { inst, alan, kate } = m.inst.seedSchool();
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}?tab=students`);
  await visible(page, 'button', 'More for Alan Turing').click();
  await page.getByRole('menuitem', { name: 'Make a teacher' }).click();
  const ask = page.getByRole('dialog', { name: 'Make Alan Turing a teacher?' });
  await expect(ask.getByText(/Teachers run their own classes/)).toBeVisible();
  await ask.getByRole('button', { name: 'Change' }).click();
  await expect(page.getByText('Alan Turing is a teacher now.')).toBeVisible();
  expect(m.inst.roleOf(inst.id, alan.id)).toBe('teacher');
  await expect(visible(page, 'button', 'Open Alan Turing')).toHaveCount(0);
  await page.getByRole('radio', { name: /Teachers/ }).click();
  await expect(page.getByText('Alan Turing').filter({ visible: true }).first()).toBeVisible();

  await page.getByRole('radio', { name: /Students/ }).click();
  await visible(page, 'button', 'More for Katherine Johnson').click();
  await page.getByRole('menuitem', { name: 'Remove from Lagos Bay University' }).click();
  const remove = page.getByRole('dialog', { name: 'Remove Katherine Johnson from Lagos Bay University?' });
  await expect(remove.getByText(/frees their seat/)).toBeVisible();
  await remove.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Katherine Johnson has left Lagos Bay University.')).toBeVisible();
  expect(m.inst.roleOf(inst.id, kate.id)).toBeNull();
});

test('classes: make one and get its code, archive one, and the institution’s settings', async ({ page }) => {
  const m = new MockBackend();
  const { inst } = m.inst.seedSchool();
  const copies = await catchCopies(page);
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}?tab=classes`);
  await expect(page.getByText('K7Q2MD')).toBeVisible();
  await page.getByLabel('New class').fill('Chemistry 201');
  await page.getByRole('button', { name: 'Make class' }).click();
  const ready = page.getByRole('dialog', { name: 'Your class is ready' });
  await expect(ready).toBeVisible();
  const code = () => m.inst.classes.find((c) => c.name === 'Chemistry 201')!.code;
  await expect(ready.getByText(code(), { exact: true })).toBeVisible();
  await nothingClipped(page);
  await ready.getByRole('button', { name: 'Copy code' }).click();
  await expect.poll(copies).toContain(code());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Chemistry 201' })).toBeVisible();
  await page.getByRole('button', { name: 'More for Biology 101' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByRole('button', { name: 'Archived (1)' })).toBeVisible();
  expect(m.inst.classes.find((c) => c.name === 'Biology 101')!.archived).toBe(true);
  await nothingClipped(page);

  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText(/@lagosbay\.edu\.ng is waiting for Kaivon to confirm it/)).toBeVisible();
  await page.getByLabel('Their role').fill('Registrar');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  expect(m.inst.institutions[0].contact_role).toBe('Registrar');
  await expect(page.getByText(/You’re its only admin/)).toBeVisible();
  await nothingClipped(page);
});

test('inviting: pasted emails and a CSV become links to copy, download and cancel', async ({ page }) => {
  const m = new MockBackend();
  const { inst, bio } = m.inst.seedSchool();
  const copies = await catchCopies(page);
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}?tab=invite`);
  await page.getByLabel('Class').selectOption({ label: 'Biology 101' });
  await page.getByRole('textbox', { name: 'Emails' }).fill('Ada Lovelace <new1@lagosbay.edu.ng>\nnew2@lagosbay.edu.ng, grace@lagosbay.edu.ng\nnot-an-email.com');
  await expect(page.getByText('This doesn’t look like an email:')).toBeVisible();
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({ name: 'class.csv', mimeType: 'text/csv', buffer: Buffer.from('First name,Email\nAlan,NEW3@lagosbay.edu.ng\n') });
  await expect(page.getByText('class.csv: 1 email')).toBeVisible();
  await page.getByRole('button', { name: 'Make 4 invite links' }).click();
  await expect(page.getByRole('heading', { name: '3 links ready' })).toBeVisible();
  expect(rpcCalls(m, 'study_institution_invite')[0].body).toMatchObject({
    p_inst: inst.id,
    p_role: 'student',
    p_class: bio.id,
    p_emails: ['new1@lagosbay.edu.ng', 'new2@lagosbay.edu.ng', 'grace@lagosbay.edu.ng', 'new3@lagosbay.edu.ng'],
  });
  const token = (email: string) => m.inst.invites.find((v) => v.email === email)!.token;
  await expect(page.getByText(`https://study.kaivon.app/join/${token('new1@lagosbay.edu.ng')}`).first()).toBeVisible();
  await expect(page.getByText('Already part of Lagos Bay University.')).toBeVisible();
  await nothingClipped(page);

  await page.getByRole('button', { name: 'Copy all' }).click();
  await expect.poll(async () => (await copies()).at(-1)?.split('\n').length).toBe(3);
  expect((await copies()).at(-1)).toContain(`new3@lagosbay.edu.ng\thttps://study.kaivon.app/join/${token('new3@lagosbay.edu.ng')}`);
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  expect(file.suggestedFilename()).toBe('Lagos Bay University invites.csv');
  const csv = readFileSync(await file.path(), 'utf8');
  expect(csv).toContain('email,role,class,link,status');
  expect(csv).toContain(`new1@lagosbay.edu.ng,student,Biology 101,https://study.kaivon.app/join/${token('new1@lagosbay.edu.ng')},Link ready`);
  expect(csv).toContain('grace@lagosbay.edu.ng,student,Biology 101,,Already in');

  // Links still waiting are listed, to copy again or cancel.
  await expect(page.getByRole('heading', { name: 'Waiting to be used (3)' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel the link for new2@lagosbay.edu.ng' }).click();
  await expect(page.getByText('The link for new2@lagosbay.edu.ng won’t work now.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Waiting to be used (2)' })).toBeVisible();
  expect(m.inst.invites.find((v) => v.email === 'new2@lagosbay.edu.ng')!.state).toBe('revoked');
});

test('a teacher invites students into their own class, and sees only their classes’ links', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, 'teacher');
  const mine = m.inst.klass(inst.id, 'Physics 110');
  const theirs = m.inst.klass(inst.id, 'History 200');
  m.inst.inClass(mine.id, m.user.id, 'teacher');
  m.inst.invite(inst.id, 'waiting@lagosbay.edu.ng', 'student', mine.id);
  m.inst.invite(inst.id, 'other@lagosbay.edu.ng', 'student', theirs.id);
  await m.install(page);
  await page.goto(`/app/institution/${inst.id}?tab=invite`);
  await expect(page.getByText('You’re a teacher', { exact: true })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Invite them as' })).toHaveCount(0);
  await expect(page.getByLabel('Class').locator('option')).toHaveText(['Pick a class', 'Physics 110']);
  await expect(page.getByText('waiting@lagosbay.edu.ng')).toBeVisible();
  await expect(page.getByText('other@lagosbay.edu.ng')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Emails' }).fill('new@lagosbay.edu.ng');
  await expect(page.getByRole('button', { name: 'Make 1 invite link' })).toBeDisabled();
  await page.getByLabel('Class').selectOption({ label: 'Physics 110' });
  await page.getByRole('button', { name: 'Make 1 invite link' }).click();
  await expect(page.getByRole('heading', { name: '1 link ready' })).toBeVisible();
  expect(rpcCalls(m, 'study_institution_invite')[0].body).toMatchObject({ p_role: 'student', p_class: mine.id });
  await nothingClipped(page);
});

test('an invite link: sign in first, read what joining means, then join', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, null);
  const bio = m.inst.klass(inst.id, 'Biology 101');
  const invite = m.inst.invite(inst.id, m.user.email, 'student', bio.id);
  await m.install(page, { signedIn: false });
  await page.goto(`/join/${invite.token}`);
  await expect(page).toHaveURL(new RegExp(`/signin\\?next=%2Fjoin%2F${invite.token}$`));
  await expect(page.getByText('You have an invite.')).toBeVisible();
  await page.getByLabel('Email').fill(m.user.email);
  await page.getByRole('button', { name: /Email me a code/ }).click();
  await page.getByLabel('Code').fill('12345678');
  await expect(page).toHaveURL(new RegExp(`/join/${invite.token}$`));
  await expect(page.getByRole('heading', { name: 'Join Lagos Bay University' })).toBeVisible();
  await expect(page.getByText('They can see', { exact: true })).toBeVisible();
  await expect(page.getByText('Your chats with Chip', { exact: true })).toBeVisible();
  await expect(page.getByText('Biology 101')).toBeVisible();
  await expect(page.getByText(/Joining is your choice/)).toBeVisible();
  await nothingClipped(page);
  await page.getByRole('button', { name: 'Join Lagos Bay University' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('Welcome to Lagos Bay University. Chip Study Pro is yours while you’re there.')).toBeVisible();
  expect(m.inst.roleOf(inst.id, m.user.id)).toBe('student');
  expect(m.inst.classMembers).toContainEqual({ class_id: bio.id, user_id: m.user.id, role: 'student' });
  expect(invite.state).toBe('used');
});

test('an invite link that’s used, run out, cancelled, unknown or for another email says so kindly', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, null);
  const used = m.inst.invite(inst.id, m.user.email, 'student', null, 'used');
  const expired = m.inst.invite(inst.id, m.user.email, 'student', null, 'expired');
  const revoked = m.inst.invite(inst.id, m.user.email, 'student', null, 'revoked');
  const other = m.inst.invite(inst.id, 'someone@lagosbay.edu.ng', 'student');
  await m.install(page);
  for (const [token, heading] of [
    [used.token, 'This link has been used'],
    [expired.token, 'This link has run out'],
    [revoked.token, 'This link was cancelled'],
    ['nothing-like-it', 'This link doesn’t work'],
  ]) {
    await page.goto(`/join/${token}`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to my desk' })).toBeVisible();
  }
  await nothingClipped(page);
  await page.goto(`/join/${other.token}`);
  await expect(page.getByRole('heading', { name: 'This invite is for another email' })).toBeVisible();
  await expect(page.getByText(m.user.email)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Join/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in with another email' }).click();
  await expect(page).toHaveURL(new RegExp(`/signin\\?next=%2Fjoin%2F${other.token}$`));
  expect(m.made('/rest/v1/rpc/study_invite_accept')).toHaveLength(0);
});

test('joining a class with its code, after reading what joining means', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({}, null);
  const bio = m.inst.klass(inst.id, 'Biology 101', 'K7Q2MD');
  const old = m.inst.klass(inst.id, 'Old class', 'ZZZ234');
  old.archived = true;
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Join a class' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Class code').fill('zzz-234');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('alert')).toContainText('No class has that code');
  await dialog.getByLabel('Class code').fill('k7q 2md');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Join Biology 101?' })).toBeVisible();
  await expect(dialog.getByText('They can’t see', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Lagos Bay University gives you Chip Study Pro/)).toBeVisible();
  await nothingClipped(page);
  await dialog.getByRole('button', { name: 'Join Biology 101' }).click();
  await expect(page.getByText('You’re in Biology 101, at Lagos Bay University. Chip Study Pro is yours while you’re there.')).toBeVisible();
  expect(m.inst.roleOf(inst.id, m.user.id)).toBe('student');
  expect(m.inst.classMembers).toContainEqual({ class_id: bio.id, user_id: m.user.id, role: 'student' });
  expect(m.made('/rest/v1/rpc/study_class_join')[0].body).toEqual({ p_code: 'K7Q2MD' });

  // Settings: the institution, the class, and how Chip helps in it.
  await page.goto('/app/settings');
  const section = page.locator('#institution');
  await expect(section.getByText('Lagos Bay University').first()).toBeVisible();
  await expect(section.getByText('You have Chip Study Pro through it.')).toBeVisible();
  await expect(section.getByText('Biology 101')).toBeVisible();
  await expect(section.getByText(/Chip helps in its usual way/)).toBeVisible();
  await nothingClipped(page);
});

test('a class code at a paused institution says so before anything else', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({ status: 'suspended' }, null);
  m.inst.klass(inst.id, 'Biology 101', 'K7Q2MD');
  await m.install(page);
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Join a class' }).click();
  await page.getByLabel('Class code').fill('K7Q2MD');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('alert')).toContainText('Lagos Bay University isn’t open to students right now');
  expect(m.made('/rest/v1/rpc/study_class_join')).toHaveLength(0);
});

test('a school email: the desk offers the school, says what joining means, and leaving works', async ({ page }) => {
  const m = new MockBackend();
  const inst = m.inst.seed({ email_domain: 'school.edu' }, null);
  await m.install(page);
  await page.goto('/app');
  const card = page.getByRole('region', { name: 'Your school is on Chip Study' });
  await expect(card.getByText(/Lagos Bay University uses Chip Study/)).toBeVisible();
  await nothingClipped(page);
  await card.getByRole('button', { name: 'See what joining means' }).click();
  const ask = page.getByRole('dialog', { name: 'Join Lagos Bay University?' });
  await expect(ask.getByText('The words of your questions or Chip’s answers')).toBeVisible();
  await ask.getByRole('button', { name: 'Join Lagos Bay University' }).click();
  await expect(page.getByText('You’ve joined Lagos Bay University. Chip Study Pro is yours while you’re there.')).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(m.inst.roleOf(inst.id, m.user.id)).toBe('student');

  await page.goto('/app/settings');
  await page.locator('#institution').getByRole('button', { name: 'Leave' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave Lagos Bay University?' });
  await expect(leave.getByText(/Chip Study Pro that comes from Lagos Bay University stops/)).toBeVisible();
  await leave.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByText('You’ve left Lagos Bay University.')).toBeVisible();
  expect(m.inst.roleOf(inst.id, m.user.id)).toBeNull();
});

test('Pro through an institution: the plan says whose, with nothing to buy or cancel', async ({ page }) => {
  const m = new MockBackend({ payOn: true });
  m.inst.seed({}, 'student');
  await m.install(page);
  await page.goto('/app/plan');
  await expect(page.getByText('Pro through Lagos Bay University').first()).toBeVisible();
  await expect(page.getByText(/with nothing to pay/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel Pro' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Go Pro/ })).toHaveCount(0);
  await nothingClipped(page);
});

test('Kaivon staff approve an institution, move it to paid, and take its domain away', async ({ page }) => {
  const m = new MockBackend();
  m.inst.staff.add(m.user.id);
  const harbour = m.inst.seed({ name: 'Harbour College', kind: 'college', country: 'GB', status: 'pending', seats: 0, pilot_ends: null, reviewed_at: null, domain_requested: 'harbour.ac.uk', contact_name: 'Femi Ade', contact_role: 'Registrar', students_estimate: 800 }, null);
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Kaivon review' }).click();
  await expect(page).toHaveURL(/\/app\/kaivon$/);
  const card = page.getByRole('listitem').filter({ hasText: 'Harbour College' });
  await expect(card.getByRole('link', { name: 'registrar@lagosbay.edu.ng' })).toHaveAttribute('href', 'mailto:registrar@lagosbay.edu.ng');
  await expect(card.getByText('Femi Ade, Registrar')).toBeVisible();
  await nothingClipped(page);
  await card.getByRole('button', { name: 'Approve' }).click();
  const approve = page.getByRole('dialog', { name: 'Approve Harbour College' });
  await expect(approve.getByLabel('Seats')).toHaveValue('50');
  await expect(approve.getByLabel(/Pilot length/)).toHaveValue('90');
  await expect(approve.getByLabel(/Email domain to confirm/)).toHaveValue('harbour.ac.uk');
  await nothingClipped(page);
  await approve.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Harbour College is approved.')).toBeVisible();
  expect(harbour).toMatchObject({ status: 'approved', seats: 50, email_domain: 'harbour.ac.uk' });
  const in90 = new Date(Date.now() + 90 * 86_400_000);
  expect(harbour.pilot_ends).toBe(`${in90.getFullYear()}-${String(in90.getMonth() + 1).padStart(2, '0')}-${String(in90.getDate()).padStart(2, '0')}`);
  expect(m.made('/rest/v1/rpc/study_staff_review')[0].body).toMatchObject({ p_status: 'approved', p_seats: 50, p_pilot_days: 90, p_email_domain: 'harbour.ac.uk', p_clear_domain: false });

  await page.getByRole('tab', { name: 'Approved', exact: true }).click();
  await card.getByRole('button', { name: 'Move to paid' }).click();
  const paid = page.getByRole('dialog', { name: 'Move Harbour College to paid' });
  await paid.getByLabel('Seats').fill('120');
  await paid.getByLabel('Paid until').fill('2027-09-30');
  await paid.getByRole('button', { name: 'Move to paid' }).click();
  await expect(page.getByText(/Harbour College is on paid seats until/)).toBeVisible();
  expect(harbour).toMatchObject({ plan: 'paid', seats: 120, paid_until: '2027-09-30' });

  await card.getByRole('button', { name: 'Change seats or domain' }).click();
  const change = page.getByRole('dialog', { name: 'Change Harbour College' });
  await change.getByRole('checkbox', { name: /Remove the confirmed domain/ }).check();
  await change.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Harbour College is updated, without its email domain.')).toBeVisible();
  expect(harbour.email_domain).toBeNull();
});

test('everyone else isn’t shown Kaivon review, and the page says it isn’t theirs', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Up late/ })).toBeVisible();
  await expect.poll(() => m.made('/rest/v1/rpc/study_am_staff').length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Your account' }).click();
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Kaivon review' })).toHaveCount(0);
  expect(m.made('/rest/v1/rpc/study_staff_institutions')).toHaveLength(0);
  await page.goto('/app/kaivon');
  await expect(page.getByRole('heading', { name: 'This page is for the Kaivon team' })).toBeVisible();
});
