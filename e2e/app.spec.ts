import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { nothingClipped } from './layout';
import { MockBackend } from './mock';
import { zip } from '../tests/unit/zip_fixture';

/** The journeys that matter, on every browser and size: the landing page, signing in, starting
 * something to learn and an assignment, writing (saved as you go), Chip (guiding, planning, writing
 * with you, practice), the review deck, the focus timer and the AI-use declaration. */

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1100;

/** Opens a side panel: beside the document on wide screens, over it on smaller ones. */
async function openPanel(page: Page, name: 'Chip' | 'Brief' | 'About' | 'Plan' | 'Sources' | 'Notes' | 'Record') {
  const panels = page.getByRole('navigation', { name: 'Panels' });
  if (!(await panels.isVisible())) {
    const bar = page.getByRole('navigation', { name: 'Workspace' });
    if (name === 'Chip' || name === 'Plan' || name === 'Sources') await bar.getByRole('button', { name }).click();
    else await bar.getByRole('button', { name: 'More' }).click();
  }
  await panels.getByRole('button', { name }).click();
}

async function openSpace(page: Page, title: RegExp) {
  await page.getByRole('link', { name: title }).first().click();
  await expect(page.locator('.doc-prose')).toBeVisible();
}

async function askChip(page: Page, mode: string, text: string) {
  await openPanel(page, 'Chip');
  await page.getByRole('tab', { name: mode }).click();
  await page.getByRole('textbox', { name: 'Message to Chip' }).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

test('landing leads with learning, and every link goes somewhere', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Understand anything\. Really learn it\./);
  await expect(page.getByRole('heading', { name: 'A tutor that helps you think.' })).toBeAttached();
  await expect(page.getByText('$7.99', { exact: true })).toBeAttached();
  await expect(page.getByText('Launching soon')).toBeAttached();
  await expect(page.getByText('Students: Pro for $5.99 a month')).toBeAttached();
  const student = page.locator('details', { hasText: 'Is there a student discount?' });
  await student.locator('summary').click();
  await expect(student.getByText(/Sign up with your school email/)).toBeVisible();
  const q = page.locator('details', { hasText: 'Will it actually help me learn?' });
  await q.locator('summary').click();
  await expect(q.getByText('Chip’s default is to guide you')).toBeVisible();
  await page.getByRole('link', { name: 'Terms of Service' }).click();
  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: /Start learning free/ }).first().click();
  await expect(page).toHaveURL(/\/signin$/);
  expect(errors).toEqual([]);
});

test('signing in with a Kaivon account, by emailed code', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/app');
  await expect(page).toHaveURL(/\/signin\?next=%2Fapp/);
  await expect(page.getByText('the same one you use in Utopia')).toBeVisible();
  await page.getByLabel('Email').fill('ada@school.edu');
  await page.getByRole('button', { name: /Email me a code/ }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByLabel('Code').fill('11112222');
  await expect(page.getByRole('alert')).toContainText('That code didn’t work');
  await page.getByLabel('Code').fill('12345678');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Ada|Up late, Ada/ })).toBeVisible();
  expect(m.made('/auth/v1/otp', 'POST')[0].body).toMatchObject({ email: 'ada@school.edu' });
});

test('starting something to learn', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Start something new' }).click();
  await page.getByRole('button', { name: /Something to learn/ }).click();
  await page.getByLabel('What do you want to learn?').fill('Organic chemistry: mechanisms');
  await page.getByRole('button', { name: 'Start learning' }).click();
  await expect(page).toHaveURL(/\/app\/a\//);
  await expect(page.getByRole('banner').getByText('Learning', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'My notes', exact: true })).toBeVisible();
  expect(m.db.study_assignments[0]).toMatchObject({ kind: 'topic', title: 'Organic chemistry: mechanisms' });
  await nothingClipped(page);
});

test('typing in a dialog stays where you type, key by key', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Start something new' }).click();
  await page.getByRole('button', { name: /Something to learn/ }).click();
  const course = page.locator('#t-course');
  await course.click();
  // Typed as a person types, with pauses longer than the dialog's own focus timer.
  await course.pressSequentially('CHEM 210', { delay: 90 });
  await expect(course).toHaveValue('CHEM 210');
  await expect(course).toBeFocused();
  await expect(page.getByLabel('What do you want to learn?')).toHaveValue('');
  const goal = page.locator('#t-goal');
  await goal.click();
  await goal.pressSequentially('Mechanisms', { delay: 90 });
  await expect(goal).toHaveValue('Mechanisms');
  await expect(goal).toBeFocused();
});

test('the first focus: Chip says, a line at a time, where to change the focus time', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Start focus' }).click();
  const tip = page.locator('.focus-tip');
  await expect(tip.getByText('Let’s focus.')).toBeVisible();
  await expect(tip.getByText(/Your sessions are 25 minutes, with a 5-minute break/)).toBeVisible();
  await expect(tip.getByText(/change your focus time in Settings/)).toBeVisible();
  await tip.getByRole('link', { name: 'Change focus time' }).click();
  await expect(page).toHaveURL(/\/app\/settings#focus$/);
  await expect(page.locator('#focus')).toBeInViewport();
  await expect(page.locator('#focus')).toHaveClass(/settings-glow/);
  await expect(page.getByRole('radio', { name: '25 min' })).toBeVisible();
  await nothingClipped(page);
  // Seen: never again.
  await page.goto('/app');
  await page.getByRole('button', { name: /Pause|Carry on|Start focus/ }).first().click();
  await page.waitForTimeout(800);
  await expect(page.locator('.focus-tip')).toHaveCount(0);
});

test('an assignment from its brief: Chip sets it up', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Start something new' }).click();
  await page.getByRole('button', { name: /An assignment/ }).click();
  await page.getByLabel('Or paste it').fill('Essay brief: In 1,500 words, evaluate how coastal towns should adapt to sea-level rise. Marking: argument 40%, evidence 30%.');
  await page.getByRole('button', { name: 'Let Chip set it up' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Essay: Coastal erosion and policy');
  await expect(page.getByLabel('Word target')).toHaveValue('1500');
  await expect(page.getByLabel('Rubric or marking criteria')).toHaveValue(/Argument 40%/);
  await page.getByRole('button', { name: 'Create assignment' }).click();
  await expect(page).toHaveURL(/\/app\/a\//);
  await expect(page.locator('.doc-prose')).toBeVisible();
  expect(m.db.study_tasks.map((t) => t.title)).toEqual(['Read the set chapters', 'Write an outline']);
  expect(m.db.study_assignments[0].brief).toContain('Essay brief');
});

// A 1×1 PNG: a stand-in for a photo of a page.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('a sheet in parts: Chip reads several photos at once', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Start something new' }).click();
  await page.getByRole('button', { name: /An assignment/ }).click();
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'page-1.png', mimeType: 'image/png', buffer: PNG },
    { name: 'page-2.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(page.getByLabel('Title')).toHaveValue('Essay: Coastal erosion and policy');
  const asked = m.made('/functions/v1/chip-study', 'POST').map((r) => r.body as { action: string; files?: unknown[] });
  expect(asked.at(-1)).toMatchObject({ action: 'setup' });
  expect(asked.at(-1)?.files).toHaveLength(2);
});

test('several readings at once, to learn from', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Start something new' }).click();
  await page.getByRole('button', { name: /Something to learn/ }).click();
  await page.getByLabel('What do you want to learn?').fill('Coastal geography');
  const reading = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.locator('input[type="file"]').setInputFiles([
    reading('chapter-1.txt', 'Coasts are shaped by waves, tides and the rocks they meet, over long spans of time.'),
    reading('chapter-2.txt', 'Sea walls protect one stretch of coast and often speed up erosion further along it.'),
  ]);
  await expect(page.getByText(/2 files: chapter-1\.txt, chapter-2\.txt/)).toBeVisible();
  await page.getByRole('button', { name: 'Start learning' }).click();
  await expect(page).toHaveURL(/\/app\/a\//);
  await expect.poll(() => m.db.study_sources.length).toBe(2);
  expect(m.db.study_sources.map((s) => s.file_name).sort()).toEqual(['chapter-1.txt', 'chapter-2.txt']);
});

test('files in the chat: a document becomes a reading, a photo goes to Chip with the message', async ({ page }) => {
  const m = new MockBackend({ tier: 'pro' });
  m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await openSpace(page, /Coastal erosion essay/);
  await openPanel(page, 'Chip');
  await page.getByRole('button', { name: 'Attach files' }).click();
  await page.locator('input[type="file"][multiple]').last().setInputFiles([
    { name: 'lecture-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Managed retreat moves homes back from the coast; sea walls shift erosion further along it.') },
    { name: 'whiteboard.png', mimeType: 'image/png', buffer: PNG },
  ]);
  const attached = page.getByRole('list', { name: 'Attached files' });
  await expect(attached.getByText('lecture-notes.txt')).toBeVisible();
  await expect(attached.getByText('whiteboard.png')).toBeVisible();
  await page.getByRole('button', { name: 'Remove whiteboard.png' }).click();
  await expect(attached.getByText('whiteboard.png')).toHaveCount(0);
  await page.getByRole('button', { name: 'Attach files' }).click();
  await page.locator('input[type="file"][multiple]').last().setInputFiles([{ name: 'whiteboard.png', mimeType: 'image/png', buffer: PNG }]);
  // Nothing typed: the files alone are enough to send.
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Read these with me: lecture-notes.txt, whiteboard.png.')).toBeVisible();
  await expect.poll(() => m.db.study_sources.map((s) => s.file_name)).toEqual(['lecture-notes.txt']);
  const asked = m.made('/functions/v1/chip-study', 'POST').map((r) => r.body as { action: string; attached?: string[]; files?: { name: string }[] });
  const last = asked.at(-1)!;
  expect(last).toMatchObject({ action: 'chat', attached: ['lecture-notes.txt'] });
  expect(last.files?.map((f) => f.name)).toEqual(['whiteboard.png']);
  await expect(page.getByRole('list', { name: 'Attached files' })).toHaveCount(0);
  await nothingClipped(page);
});

test('readings from Excel and code: Chip gets the sheets and formulas, and an old .xls says what to do', async ({ page }) => {
  const m = new MockBackend({ tier: 'pro' });
  m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await openSpace(page, /Coastal erosion essay/);
  await openPanel(page, 'Sources');
  const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const workbook = zip({
    'xl/workbook.xml': `<workbook ${S} xmlns:r="${R}"><sheets><sheet name="Erosion" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Metres lost</t></is></c><c r="B1"><v>3</v></c><c r="C1"><f>B1*2</f><v>6</v></c></row></sheetData></worksheet>`,
  });
  // The Sources panel's picker: documents, not photos.
  const readings = page.locator('input[type="file"][accept*=".xlsm"]:not([accept*="image"])');
  await readings.setInputFiles([
    { name: 'erosion.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', buffer: Buffer.from(workbook) },
    { name: 'model.py', mimeType: 'text/x-python', buffer: Buffer.from('def retreat(rate, years):\n    return rate * years  # metres lost to the sea\n') },
  ]);
  await expect.poll(() => m.db.study_sources.map((s) => s.file_name).sort()).toEqual(['erosion.xlsm', 'model.py']);
  const sheet = m.db.study_sources.find((s) => s.file_name === 'erosion.xlsm')!;
  expect(sheet.content).toContain('## Sheet "Erosion"');
  expect(sheet.content).toContain('C1: =B1*2 → 6');
  await readings.setInputFiles([{ name: 'old marks.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('not really') }]);
  await expect(page.getByText('Save it as an Excel workbook (.xlsx), then add that.')).toBeVisible();
});

test('signing out asks first, from the menu and from settings', async ({ page }) => {
  const m = new MockBackend();
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const ask = page.getByRole('dialog', { name: 'Sign out of Chip Study?' });
  await expect(ask).toBeVisible();
  await expect(ask.getByText(m.user.email)).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  await expect(page).toHaveURL(/\/app$/);
  expect(m.made('/auth/v1/logout')).toHaveLength(0);
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await ask.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/signin$/);
});

test('a school email sees Pro at the student price, and can still pick full Pro', async ({ page }) => {
  const m = new MockBackend({ payOn: true, student: true });
  await m.install(page);
  await page.route('https://checkout.flutterwave.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Checkout</h1>' }));
  await page.goto('/app/plan');
  await expect(page.getByText('Student price')).toBeVisible();
  await expect(page.getByText('$5.99', { exact: true })).toBeVisible();
  await expect(page.locator('s', { hasText: '$7.99' })).toBeVisible();
  await expect(page.getByText(/Students get Pro/)).toHaveCount(0);
  await nothingClipped(page);
  await page.getByRole('button', { name: 'Go Pro for $5.99 a month' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  const asked = () => m.made('/functions/v1/web-pay', 'POST').map((r) => r.body as { action: string; plan?: string }).filter((b) => b.action === 'subscribe');
  expect(asked().at(-1)?.plan).toBe('study.pro.student.monthly');
  await page.goto('/app/plan');
  await page.getByRole('button', { name: 'Full Pro is $7.99' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  expect(asked().at(-1)?.plan).toBe('study.pro.monthly');
});

test('anyone else pays full Pro, and hears that students get it for less', async ({ page }) => {
  const m = new MockBackend({ payOn: true });
  await m.install(page);
  await page.route('https://checkout.flutterwave.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Checkout</h1>' }));
  await page.goto('/app/plan');
  await expect(page.getByText('Students get Pro for $5.99 a month')).toBeVisible();
  await expect(page.getByText('Student price')).toHaveCount(0);
  await nothingClipped(page);
  await page.getByRole('button', { name: 'Go Pro for $7.99 a month' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  const subscribed = m.made('/functions/v1/web-pay', 'POST').map((r) => r.body as { action: string; plan?: string }).filter((b) => b.action === 'subscribe');
  expect(subscribed.at(-1)?.plan).toBe('study.pro.monthly');
});

test('on the student plan: Pro, with the student plan’s limits', async ({ page }) => {
  const m = new MockBackend({ tier: 'pro', plan: 'student', student: true });
  await m.install(page);
  await page.goto('/app/plan');
  await expect(page.getByText('Current')).toBeVisible();
  await expect(page.getByText('Student price')).toBeVisible();
  await expect(page.getByText(/about 110 in-depth messages a month/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel Pro' })).toBeVisible();
});

test('writing saves as you go, and is there after a reload', async ({ page }) => {
  const m = new MockBackend();
  m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await openSpace(page, /Coastal erosion essay/);
  await page.locator('.doc-prose').click();
  await page.keyboard.type('Sea walls hold the line, but at a cost.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Retreat works with the coast instead.');
  await expect(page.locator('[data-save="saved"]')).toBeVisible({ timeout: 10_000 });
  const saves = m.made('/rest/v1/rpc/study_save_doc', 'POST');
  expect(saves.length).toBeGreaterThan(0);
  const last = saves[saves.length - 1].body as { p_text: string; p_words: number };
  expect(last.p_text).toContain('Retreat works with the coast instead.');
  expect(last.p_words).toBe(15);
  await expect(page.locator('.ws-status')).toContainText('15');
  await page.reload();
  await expect(page.locator('.doc-prose')).toContainText('Sea walls hold the line, but at a cost.');
});

test('Chip guides by default, plans, and writes with you (and it’s all on the record)', async ({ page }) => {
  const m = new MockBackend({ tier: 'pro' });
  m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await openSpace(page, /Coastal erosion essay/);
  await openPanel(page, 'Chip');
  await expect(page.getByRole('tab', { name: 'Guide me' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('textbox', { name: 'Message to Chip' }).fill('Why do sea walls make erosion worse further along?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Before I tell you: what do you think')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Just explain it' })).toBeVisible();
  expect(m.made('/functions/v1/chip-study', 'POST')[0].body).toMatchObject({ action: 'chat', mode: 'guide', model: 'best' });

  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('textbox', { name: 'Message to Chip' }).fill('Make me a plan to the due date');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Add 3 tasks to my plan' }).click();
  await expect(page.getByText('Added to your plan', { exact: true })).toBeVisible();
  expect(m.db.study_tasks.map((t) => t.created_by)).toEqual(['chip', 'chip', 'chip']);

  await page.getByRole('tab', { name: 'Write' }).click();
  await page.getByRole('textbox', { name: 'Message to Chip' }).fill('Help me start my introduction');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Put in my document' }).click();
  await expect(page.locator('.doc-prose [data-chip]')).toContainText('Coastal towns face a hard choice');
  expect(m.db.study_ai_log.some((e) => e.action === 'inserted' && e.words === 14)).toBe(true);

  if (!wide(page)) await page.keyboard.press('Escape');
  await openPanel(page, 'Record');
  await expect(page.getByText('Put Chip’s words into the document')).toBeVisible();
  await expect(page.getByText(/Worked through it with Chip guiding|Asked Chip to guide/).first()).toBeVisible();
});

test('practice: a quiz is scored, flashcards go to review, and review spaces them out', async ({ page }) => {
  const m = new MockBackend();
  m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await openSpace(page, /Coastal erosion essay/);
  await askChip(page, 'Practice', 'Quiz me on the key ideas');
  await page.getByRole('button', { name: /Stop it/ }).click();
  await expect(page.getByText('You got 0 of 1.')).toBeVisible();
  await page.getByRole('button', { name: /Review the 1 I missed/ }).click();
  await expect.poll(() => m.db.study_cards.length).toBe(1);
  expect(m.db.study_practice[0]).toMatchObject({ kind: 'quiz', correct: 0, total: 1 });

  await page.getByRole('textbox', { name: 'Message to Chip' }).fill('Make flashcards of the key terms');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Save to review' }).click();
  await expect.poll(() => m.db.study_cards.length).toBe(3);

  await page.goto('/app/review');
  await expect(page.getByText('3 cards to review')).toBeVisible();
  await page.getByRole('button', { name: 'Start reviewing' }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Show the answer' }).click();
    await page.getByRole('button', { name: /^Good/ }).click();
  }
  await expect(page.getByText('All caught up')).toBeVisible();
  expect(m.db.study_cards.every((c) => c.interval_days === 1 && c.reps === 1)).toBe(true);
  expect(m.db.study_practice.find((p) => p.kind === 'review')).toMatchObject({ correct: 3, total: 3 });
  await nothingClipped(page);
});

test('the focus timer keeps finished focus on the assignment', async ({ page }) => {
  await page.clock.install();
  const m = new MockBackend();
  const a = m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await openSpace(page, /Coastal erosion essay/);
  if (wide(page)) await page.getByRole('banner').getByRole('button', { name: 'Focus' }).click();
  else await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Focus' }).click();
  await expect(page.locator('.focus-bar')).toContainText(/2[45]:[0-5]\d/);
  await page.clock.runFor('25:02');
  await page.clock.pauseAt(Date.now() + 26 * 60_000);
  await expect(page.locator('.focus-bar')).toContainText('Break');
  await expect.poll(() => m.db.study_focus.length).toBe(1);
  expect(m.db.study_focus[0]).toMatchObject({ assignment_id: a.id, minutes: 25 });
  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.locator('.focus-bar')).toHaveCount(0);
});

test('the AI-use declaration downloads as Markdown and Word', async ({ page }) => {
  const m = new MockBackend();
  const a = m.seedAssignment();
  m.insert('study_ai_log', { assignment_id: a.id, action: 'guide', summary: 'Worked through it with Chip guiding', prompt: 'Why do sea walls fail?', output: 'What do you think?', model: 'claude-haiku-5-5' });
  await m.install(page);
  await page.goto('/app');
  await openSpace(page, /Coastal erosion essay/);
  await openPanel(page, 'Record');
  await page.getByRole('button', { name: 'Export declaration' }).click();
  await page.getByLabel('Your name, as on your work').fill('Ada Lovelace');
  const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Markdown' }).click()]);
  const text = readFileSync(await md.path(), 'utf8');
  expect(text).toContain('# Declaration of AI use');
  expect(text).toContain('**Student:** Ada Lovelace');
  expect(text).toContain('Why do sea walls fail?');
  expect(text).toContain('Claude Haiku 5.5');
  const [docx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word' }).click()]);
  expect(docx.suggestedFilename()).toBe('AI-use declaration - Coastal erosion essay.docx');
  expect(readFileSync(await docx.path()).subarray(0, 2).toString()).toBe('PK');
});

test('when Chip’s time is used up, it says when it’s back', async ({ page }) => {
  const m = new MockBackend({ chipOut: true });
  m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await openSpace(page, /Coastal erosion essay/);
  await askChip(page, 'Explain', 'Explain the brief in plain words');
  await expect(page.getByText('That’s today’s Chip time. It’s back tomorrow.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'More with Pro' })).toBeVisible();
});
