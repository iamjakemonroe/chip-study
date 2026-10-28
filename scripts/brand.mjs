// Draws Chip Study's icons and share image from the orb (public/*.png), with Playwright's
// Chromium (system Chrome). Run when the brand changes:
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/brand.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const svg = readFileSync('public/favicon.svg', 'utf8');
const orb = (size) => svg.replace('<svg ', `<svg width="${size}" height="${size}" `);

const page = (body, w, h) => `<!doctype html><html><head><style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:'Inter',system-ui,-apple-system,sans-serif}
</style></head><body>${body}</body></html>`;

const icon = (size, pad) =>
  page(
    `<div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:linear-gradient(150deg,#f3f0ff,#e9f6ff 55%,#e9faf3)">${orb(Math.round(size * (1 - pad * 2)))}</div>`,
    size,
    size,
  );

const og = page(
  `<div style="width:1200px;height:630px;position:relative;overflow:hidden;background:#f7f7fb">
    <div style="position:absolute;width:700px;height:700px;left:-200px;top:-300px;border-radius:50%;background:#e2dcff;filter:blur(90px)"></div>
    <div style="position:absolute;width:640px;height:640px;right:-200px;bottom:-320px;border-radius:50%;background:#d3f1e6;filter:blur(90px)"></div>
    <div style="position:absolute;width:520px;height:520px;right:120px;top:-260px;border-radius:50%;background:#d6ecff;filter:blur(90px)"></div>
    <div style="position:absolute;left:90px;top:110px;display:flex;align-items:center;gap:22px">${orb(84)}<span style="font-size:46px;font-weight:650;letter-spacing:-0.02em;color:#191a2e">Chip <span style="color:#6c6e8a;font-weight:500">Study</span></span></div>
    <div style="position:absolute;left:90px;top:250px;width:980px;font-size:78px;line-height:1.02;font-weight:650;letter-spacing:-0.045em;color:#191a2e">Understand anything. <span style="background:linear-gradient(100deg,#5246e0,#8b7dff 35%,#3aa7e8 65%,#22a989);-webkit-background-clip:text;color:transparent">Really learn it.</span></div>
    <div style="position:absolute;left:92px;top:450px;font-size:28px;color:#474964;letter-spacing:-0.01em">A tutor that guides you, checks your work and makes it stick.</div>
    <div style="position:absolute;left:92px;bottom:56px;font-size:22px;color:#6c6e8a">study.kaivon.app · by Kaivon</div>
  </div>`,
  1200,
  630,
);

const browser = await chromium.launch({ channel: 'chrome' });
const shots = [
  ['public/icon-512.png', icon(512, 0.12), 512, 512],
  ['public/icon-192.png', icon(192, 0.12), 192, 192],
  ['public/icon-maskable.png', icon(512, 0.22), 512, 512],
  ['public/apple-touch-icon.png', icon(180, 0.14), 180, 180],
  ['public/favicon.png', page(orb(64), 64, 64), 64, 64],
  ['public/og.png', og, 1200, 630],
];
for (const [out, html, w, h] of shots) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html);
  await p.screenshot({ path: out, omitBackground: out.endsWith('favicon.png') });
  await p.close();
  console.log(out);
}
await browser.close();
