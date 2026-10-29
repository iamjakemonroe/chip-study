# Chip Study

A calm place to study and really learn, with Chip as a tutor. study.kaivon.app, by Kaivon.

- **Frontend** (this repo): Vite, React 19, TypeScript, Tailwind 4, framer-motion, zustand, TipTap,
  KaTeX, CodeMirror (loaded only for code tabs). The landing page loads on its own, without the app.
- **Backend**: Utopia's Supabase project (a Kaivon account signs in here too). The study tables,
  the allowance and the AI-use record are in Utopia's repo, branch `chip-study`:
  `supabase/migrations/20261028140000_chip_study.sql`, `supabase/functions/chip-study`, and
  `tool/db_test/test_chip_study.py`.

## Run it

```sh
node scripts/env.mjs        # .env.local from ../utopia/env/local.json (public URL and publishable key)
npm install
npm run dev
```

## Check it

```sh
npm run typecheck && npm run lint && npm test   # types, lint, unit tests (vitest)
npm run e2e                                      # Playwright: Chrome and WebKit, phone, iPad, desktop
```

The end-to-end tests build with `--mode e2e` (a pretend Supabase, `e2e/mock.ts`) and never touch
the real project. `SHOTS_DIR=… npx playwright test e2e/shots.spec.ts` saves screenshots of every main
screen at each size; `e2e/perf.spec.ts` measures frames and long tasks with the CPU slowed 4x.

## Deploy

See the deploy steps in the Chip Study report: database migration and functions from Utopia's
`chip-study` worktree first, then `npm run deploy` here (build and `wrangler deploy`, which also
claims study.kaivon.app as the Worker's custom domain).

## How Chip's time is counted

In dollars of model time, so a short question goes further than a long draft
(`study_settings` in the migration): free accounts get Chip Fast (Claude Haiku 5.5), $0.03 a day
(about 20 to 30 messages); Pro ($7.99 a month) gets Chip's best model (Claude Opus 5.5) up to $0.60 a
day and $4.50 a period (about 150 in-depth messages a month), Fast up to $0.06 a day of its own
(about 45 messages), and web research. Students with a confirmed school email can take Pro for
$5.99 a month instead (`study.pro.student.monthly`), with the best model at $0.45 a day and $3.30 a
period (about 110 messages). Each call is held before it's made and settled with what it cost
after. All free accounts together stop at $15 a day. The margins are in utopia's docs/PRICING.md.
