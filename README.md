<p align="center">
  <img src="https://study.kaivon.app/og.png" alt="Chip Study: understand anything, really learn it" width="100%">
</p>

<h1 align="center">Chip Study</h1>

<p align="center">
  <strong>A calm place to study, with Chip as a tutor who guides you, checks your work and makes it stick.</strong><br>
  For students and for schools, colleges and universities. By <a href="https://kaivon.app">Kaivon</a>.
</p>

<p align="center">
  <a href="https://study.kaivon.app"><strong>study.kaivon.app</strong></a>
</p>

---

## Overview

Chip Study gives every assignment its own workspace (the brief, documents, code, sheets, sources,
notes and tasks) with Chip beside it. Chip teaches rather than writes for you: it explains, asks
the right questions, checks your reasoning and turns what you learn into cards you review later.
Every way Chip helps is kept in the assignment's AI-use record, so honest use of AI is easy to show.

Students can study together in live rooms, and institutions can give their students Chip Study
through their learning platform, with dashboards for staff.

## Features

| | |
| --- | --- |
| **Assignment workspace** | Rich documents with maths (KaTeX), code with Python running in the browser, sheets, a brief and rubric panel, notes and tasks, plus a focus mode with a timer and calm scenes. |
| **Chip, the tutor** | Backed by Anthropic's Claude. Guides rather than does the work, reads your sources with you, checks drafts against the rubric, and follows a course's own guidance when the assignment belongs to a class. |
| **Sources and citations** | References in APA or Harvard, citations placed in the document, and the reference list kept up to date. |
| **AI-use record** | Every way Chip helped on an assignment, kept by the server, with the declaration it supports. |
| **Review** | Cards from what you studied, spaced by how well you knew each, with streaks and a weekly view of focus and practice. |
| **Study rooms** | Live rooms on one assignment: shared editing, chat, a shared Chip, and audio, video and screen sharing. Nothing is recorded, and room data is processed in the EU. |
| **For institutions** | Admin and teacher roles, classes and invite links, course tutors, staff dashboards with activity and AI-use records (never students' chats, notes or documents), and LTI 1.3 for Moodle, Canvas, Blackboard and Brightspace. |
| **Pricing** | One price per visitor, in their own currency (naira, pounds, euros or US dollars), with payments by Flutterwave. |

## Tech stack

| Layer | Tools |
| --- | --- |
| App | React 19, TypeScript, Vite, Tailwind CSS 4, framer-motion, zustand |
| Editors | TipTap (documents), KaTeX (maths), CodeMirror (code), Pyodide (Python in the browser, served from our own origin) |
| Live rooms | Cloudflare Workers and Durable Objects, Yjs for shared editing, Cloudflare Realtime for audio and video |
| Backend | Supabase: Postgres with row-level security, Edge Functions, Auth |
| AI | Anthropic Claude API |
| Quality | Vitest unit tests, room-server integration tests under `wrangler dev`, Playwright end-to-end tests on Chrome and WebKit at phone, tablet and desktop sizes |

## Project layout

```
src/        The app: landing page, workspace, editors, Chip, review, rooms,
            institutions and settings
worker/     The Cloudflare Worker: the study-room server (Durable Object),
            self-hosted Pyodide and /api routes
shared/     Types and limits shared by the app and the Worker
docs/       Contracts, such as docs/rooms.md for the room server
tests/      Unit tests and the room-server integration tests
e2e/        Playwright end-to-end tests against a pretend backend
```

## Running it locally

```sh
npm install
npm run dev
```

The app reads its public Supabase settings from `.env.local`
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`); `.env.example` shows the shape.

## Checks

```sh
npm run typecheck && npm run lint && npm test   # types, lint and unit tests
npm run test:rooms                               # the room server under wrangler dev, with mock upstreams
npm run e2e                                      # Playwright: Chrome and WebKit, phone, tablet and desktop
```

The end-to-end tests build with `--mode e2e` against a pretend backend (`e2e/mock.ts`) and never
touch a real project.

## License

Copyright © 2026 Emmanuel Jake Okeowo. All rights reserved. The code is published to be read; it
may not be copied, reused or redistributed. See [LICENSE](LICENSE).

---

<p align="center">Made by <a href="https://kaivon.app">Kaivon</a> · <a href="mailto:support@kaivon.app">support@kaivon.app</a></p>
