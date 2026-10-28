// Writes .env.local (git-ignored) with Utopia's Supabase project: its URL and publishable key,
// the same public values Utopia's own web app ships with. Chip Study shares Utopia's accounts.
//   node scripts/env.mjs [path to utopia/env/local.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const from = resolve(process.argv[2] ?? '../utopia/env/local.json');
const env = JSON.parse(readFileSync(from, 'utf8'));
if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
  console.error(`${from} has no SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY`);
  process.exit(1);
}
writeFileSync(
  '.env.local',
  [
    `VITE_SUPABASE_URL=${env.SUPABASE_URL}`,
    `VITE_SUPABASE_ANON_KEY=${env.SUPABASE_PUBLISHABLE_KEY}`,
    // Pro's checkout switches on with live Flutterwave keys; until then it says "coming soon".
    `VITE_PRO_LIVE=${process.env.PRO_LIVE === 'true' ? 'true' : 'false'}`,
    '',
  ].join('\n'),
);
console.log(`.env.local written from ${from}`);
