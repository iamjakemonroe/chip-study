import { expect, type Page } from '@playwright/test';

/** Nothing on the page is wider than the screen, and no text sits even partly off its left or
 * right edge (text inside something that scrolls sideways on purpose, like a tab row, is fine;
 * so is anything hidden). */
export async function nothingClipped(page: Page) {
  const problems = await page.evaluate(() => {
    const vw = window.innerWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth - vw > 1) out.push(`page is ${document.documentElement.scrollWidth}px wide`);
    const scrollsSideways = (el: Element | null): boolean => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth) return true;
      }
      return false;
    };
    const hidden = (el: Element): boolean => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true;
      }
      return false;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      if (!text) continue;
      const el = n.parentElement!;
      if (hidden(el) || scrollsSideways(el)) continue;
      // Shortened with an ellipsis on purpose: what counts is that the box itself fits.
      let cut: Element | null = null;
      for (let e: Element | null = el, i = 0; e && i < 3; e = e.parentElement, i++) {
        if (getComputedStyle(e).textOverflow === 'ellipsis') cut = e;
      }
      if (cut) {
        const r = cut.getBoundingClientRect();
        if (r.right > vw + 1 || r.left < -1) out.push(`"${text.slice(0, 40)}" (shortened) at ${Math.round(r.left)}–${Math.round(r.right)} (screen ${vw})`);
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width === 0) continue;
        if (r.right > vw + 1 || r.left < -1) {
          out.push(`"${text.slice(0, 40)}" at ${Math.round(r.left)}–${Math.round(r.right)} (screen ${vw})`);
          break;
        }
      }
      if (out.length > 8) break;
    }
    return out;
  });
  expect(problems, 'text off the side of the screen').toEqual([]);
}
