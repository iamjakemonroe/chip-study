import { expect, test, type Page } from '@playwright/test';
import { MockBackend } from './mock';

/** Smoothness with the CPU slowed four times (Chromium only, through the DevTools protocol):
 * frames and long tasks while scrolling the landing page, typing in the editor and opening it. */

// Measured without Playwright's tracing (it snapshots the page, which is work of its own).
test.use({ trace: 'off' });
test.describe.configure({ mode: 'serial' });

// CPU throttling needs Chromium, and once is enough.
test.beforeEach(({ browserName }, info) => {
  test.skip(browserName !== 'chromium' || info.project.name !== 'chromium-desktop', 'Chromium desktop only');
});

declare global {
  interface Window {
    __perf: { frames: number[]; long: number[]; slow: string[]; start: () => void; stop: () => { frames: number[]; long: number[]; slow: string[] } };
  }
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const state = { frames: [] as number[], long: [] as number[], slow: [] as string[], on: false, last: 0 };
    new PerformanceObserver((list) => {
      if (!state.on) return;
      for (const e of list.getEntries()) state.long.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: false });
    const loop = (t: number) => {
      if (state.on && state.last) {
        state.frames.push(t - state.last);
        if (t - state.last > 50) state.slow.push(`${Math.round(t - state.last)}ms at y=${Math.round(window.scrollY)}`);
      }
      state.last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__perf = {
      frames: state.frames,
      long: state.long,
      slow: state.slow,
      start: () => {
        state.frames.length = 0;
        state.long.length = 0;
        state.slow.length = 0;
        state.last = 0;
        state.on = true;
      },
      stop: () => {
        state.on = false;
        return { frames: [...state.frames], long: [...state.long], slow: [...state.slow] };
      },
    };
  });
}

function summary(name: string, r: { frames: number[]; long: number[]; slow?: string[] }) {
  const sorted = [...r.frames].sort((a, b) => a - b);
  const p = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0);
  const over = r.frames.filter((f) => f > 34).length;
  const line = `${name}: ${r.frames.length} frames, median ${p(0.5)}ms, p95 ${p(0.95)}ms, max ${Math.round(Math.max(0, ...r.frames))}ms, ${over} dropped (>34ms), long tasks ${JSON.stringify(r.long)}`;
  console.log(line + (r.slow?.length ? ` slow frames: ${r.slow.join(', ')}` : ''));
  return { p50: p(0.5), p95: p(0.95), over, frames: r.frames.length, long: r.long };
}

async function throttle(page: Page, rate: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

test('scrolling the landing page stays at 60 fps with the CPU four times slower', async ({ page }) => {
  await instrument(page);
  const m = new MockBackend();
  await m.install(page, { signedIn: false });
  await page.goto('/');
  await page.waitForTimeout(1500);
  await throttle(page, 4);
  await page.mouse.move(700, 400);
  await page.evaluate(() => window.__perf.start());
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(800);
  const s = summary('landing scroll (4x CPU)', await page.evaluate(() => window.__perf.stop()));
  expect(s.p95).toBeLessThanOrEqual(20);
  expect(s.over / s.frames).toBeLessThan(0.02);
  expect(s.long.filter((t) => t > 150)).toEqual([]);
});

test('typing in the editor never stalls a frame, with the CPU four times slower', async ({ page }) => {
  await instrument(page);
  const m = new MockBackend();
  const a = m.seedAssignment();
  // A long document already: 3,000 words.
  const para = 'Coastal towns face a hard choice between holding the line and retreating from it, and every option has a cost. ';
  m.db.study_documents[0].content = { type: 'doc', content: Array.from({ length: 150 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: para }] })) };
  await m.install(page);
  await page.goto(`/app/a/${a.id}`);
  await expect(page.locator('.doc-prose')).toBeVisible();
  await page.waitForTimeout(800);
  await throttle(page, 4);
  await page.locator('.doc-prose p').last().click();
  await page.keyboard.press('End');
  await page.evaluate(() => window.__perf.start());
  await page.keyboard.type('Managed retreat works with natural processes rather than against them, though it asks a lot of people. ', { delay: 60 });
  await page.waitForTimeout(1500);
  const s = summary('typing in a 3,000-word document (4x CPU)', await page.evaluate(() => window.__perf.stop()));
  expect(s.p95).toBeLessThanOrEqual(20);
  expect(s.over / s.frames).toBeLessThan(0.02);
  expect(s.long.filter((t) => t > 150)).toEqual([]);
  expect(m.made('/rest/v1/rpc/study_save_doc').length).toBeGreaterThan(0);
});

test('opening the editor', async ({ page }) => {
  await instrument(page);
  const m = new MockBackend();
  m.seedAssignment();
  await m.install(page);
  await page.goto('/app');
  await expect(page.getByRole('link', { name: /Coastal erosion essay/ }).first()).toBeVisible();
  await throttle(page, 4);
  await page.evaluate(() => window.__perf.start());
  const t0 = Date.now();
  await page.getByRole('link', { name: /Coastal erosion essay/ }).first().click();
  await expect(page.locator('.doc-prose')).toBeVisible();
  const ms = Date.now() - t0;
  await page.waitForTimeout(1000);
  const s = summary(`opening the editor (4x CPU, ${ms}ms to the page)`, await page.evaluate(() => window.__perf.stop()));
  expect(ms).toBeLessThan(4000);
  console.log(`opening: ${ms}ms`);
  void s;
});
