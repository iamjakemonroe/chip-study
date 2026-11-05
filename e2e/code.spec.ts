import { expect, test, type Page } from '@playwright/test';
import { MockBackend } from './mock';

/** Code tabs: a web page that previews as you type, JavaScript and SQL that run in the browser,
 * stopping a program that never ends, Chip on an error, Format, and the file name following the
 * language. (Python downloads Pyodide from its CDN, so its test runs only with E2E_NET=1.) */

async function openCode(page: Page, kind: string) {
  const m = new MockBackend({ tier: 'pro' });
  m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await page.getByRole('link', { name: /Coastal erosion essay/ }).first().click();
  await expect(page.locator('.doc-prose')).toBeVisible();
  await page.getByRole('button', { name: 'Add a tab' }).click();
  await page.getByRole('menuitem', { name: 'Code' }).click();
  const dialog = page.getByRole('dialog', { name: 'New code file' });
  await dialog.getByRole('radio', { name: new RegExp(`^${kind}`) }).click();
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toHaveCount(0);
  return m;
}

async function write(page: Page, code: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(code);
}

const output = (page: Page) => page.getByRole('log', { name: 'What your program printed' });

test('JavaScript runs here: console, tables, errors for Chip, and Stop for a loop that never ends', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const m = await openCode(page, 'JavaScript');
  await expect(page.getByRole('textbox', { name: 'Code: main.js' })).toBeVisible();
  await write(page, 'const add = (a: number, b: number) => a + b;\nconsole.log("sum", add(2, 3), { ok: true });\nconsole.table([{ x: 1 }, { x: 2 }]);');
  // TypeScript in a .js file is a syntax error, and it says where.
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(output(page)).toContainText('(line 1, column 15) in main.js');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('typescript');
  await expect(page.getByRole('button', { name: 'main.ts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(output(page)).toContainText('sum 5 { ok: true }');
  await expect(output(page).getByRole('table')).toContainText('(index)');
  await expect(page.getByText(/^Finished in/)).toBeVisible();

  await write(page, 'missing();');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  // Chrome and Safari word it differently.
  await expect(output(page)).toContainText(/ReferenceError: (missing is not defined|Can't find variable: missing)/);
  await page.getByRole('button', { name: 'Ask Chip what this error means' }).click();
  await expect.poll(() => String(m.db.study_messages.filter((x) => x.role === 'user').at(-1)?.content ?? '')).toContain('When I run main.ts, I get this error');
  // On a phone or tablet Chip opens over the code: close it to get back.
  if ((page.viewportSize()?.width ?? 0) < 1100) await page.getByRole('button', { name: 'Close Chip' }).click();

  await write(page, 'while (true) {}');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
  await expect.poll(() => String((m.db.study_documents.find((d) => d.title === 'main.ts')?.content as { code?: string })?.code)).toBe('while (true) {}');
  expect(errors).toEqual([]);
});

test('a web page: three linked files, a live preview, and its console in the output', async ({ page }) => {
  await openCode(page, 'Web page');
  for (const name of ['index.html', 'style.css', 'script.js']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Preview of index.html"]');
  await expect(frame.getByRole('heading', { name: 'Hello!' })).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Hello!' })).toHaveCSS('color', 'rgb(100, 87, 240)');
  await write(page, '<h1>Changed as I type</h1>\n<script src="script.js"></script>\n<script>localStorage.setItem("k", "v"); console.log("stored", localStorage.getItem("k"))</script>');
  await expect(frame.getByRole('heading', { name: 'Changed as I type' })).toBeVisible();
  await page.getByRole('tab', { name: 'Output' }).click();
  await expect(output(page)).toContainText('The page is running');
  await expect(output(page)).toContainText('stored v');
  // The page can't reach the app: it has no origin of its own.
  expect(await frame.locator('body').evaluate(() => self.origin)).toBe('null');
});

test('SQL runs on SQLite: what each statement did, and the rows as a table', async ({ page }) => {
  await openCode(page, 'SQL');
  await write(page, "create table pupils (name text, score real);\ninsert into pupils values ('Ada', 91.5), ('Tunde', 78);\nselect name, score from pupils order by score desc;\nselect nope from pupils;");
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(output(page)).toContainText('✓ CREATE TABLE');
  await expect(output(page)).toContainText('✓ INSERT: 2 rows');
  await expect(output(page).getByRole('table')).toContainText('Ada');
  await expect(output(page)).toContainText('2 rows');
  await expect(output(page)).toContainText('no such column: nope');
});

test('Format tidies the code, and settings change the editor', async ({ page }) => {
  await openCode(page, 'JavaScript');
  await write(page, 'const a={b:1,c:[1,2]}');
  await page.getByRole('button', { name: /Format/ }).click();
  await expect(page.locator('.cm-content')).toHaveText('const a = { b: 1, c: [1, 2] };');
  await page.getByRole('button', { name: 'Editor settings' }).click();
  await page.getByRole('radio', { name: 'Night' }).click();
  await expect(page.locator('.code-wrap')).toHaveAttribute('data-theme', 'night');
  await page.getByRole('menuitemcheckbox', { name: 'Wrap long lines' }).click();
  await expect(page.locator('.cm-content')).not.toHaveClass(/cm-lineWrapping/);
});

test('switching tabs straight after typing keeps the code, on screen and saved', async ({ page }) => {
  const m = await openCode(page, 'JavaScript');
  await write(page, 'console.log("keep me");');
  await page.getByRole('button', { name: 'Draft', exact: true }).click();
  await expect(page.locator('.doc-prose')).toBeVisible();
  await expect.poll(() => (m.db.study_documents.find((d) => d.title === 'main.js')?.content as { code?: string })?.code).toBe('console.log("keep me");');
  await page.getByRole('button', { name: 'main.js', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveText('console.log("keep me");');
});

test('Python runs in the browser: input(), imports from another tab, and errors without the machinery', async ({ page }) => {
  test.skip(!process.env.E2E_NET, 'downloads Python (Pyodide) from its CDN');
  test.setTimeout(120_000);
  await openCode(page, 'Python');
  await write(page, 'def shout(s):\n    return s.upper() + "!"\n');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('python');
  // A second file that imports the first.
  await page.getByRole('button', { name: 'Add a tab' }).click();
  await page.getByRole('menuitem', { name: 'Code' }).click();
  const dialog = page.getByRole('dialog', { name: 'New code file' });
  await dialog.getByRole('textbox', { name: 'File name' }).fill('app.py');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await write(page, 'from main import shout\nname = input("Name? ")\nprint(shout(name))\nprint(1 / 0)');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Input' }).click();
  await page.getByRole('textbox', { name: 'Input for your program' }).fill('ada');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(output(page)).toContainText('Name? ada\nADA!', { timeout: 90_000 });
  await expect(output(page)).toContainText('ZeroDivisionError: division by zero');
  await expect(output(page)).toContainText('File "app.py", line 4');
  await expect(output(page)).not.toContainText('_pyodide');
});
