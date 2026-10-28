import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { nothingClipped } from './layout';
import { MockBackend } from './mock';

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
  await expect(page.getByText('$4.99')).toBeAttached();
  await expect(page.getByText('Launching soon')).toBeAttached();
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
