import type { Page, Route } from '@playwright/test';

/** A pretend Supabase for the end-to-end tests, answering the app's requests in the browser
 * (route interception): sign-in by code, the study tables (PostgREST: select, filters, order,
 * insert, update, delete), the study_* functions, the chip-study function (Chip's answers as
 * server-sent events, by mode) and web-pay. Nothing leaves the machine. */

export const BASE = 'https://mock-study.supabase.test';
export const AUTH_KEY = 'chip-study-auth';

type Row = Record<string, unknown> & { id: string };

const TABLES = ['study_assignments', 'study_documents', 'study_tasks', 'study_sources', 'study_notes', 'study_focus', 'study_threads', 'study_messages', 'study_ai_log', 'study_cards', 'study_practice'] as const;
type Table = (typeof TABLES)[number];

const now = () => new Date().toISOString();
let counter = 0;
const uuid = () => {
  counter += 1;
  const hex = (counter + Math.floor(Math.random() * 1e6) * 1000).toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
};

const DEFAULTS: Record<Table, () => Record<string, unknown>> = {
  study_assignments: () => ({ course: '', brief: '', rubric: '', due_at: null, word_target: null, style: 'apa', status: 'active', color: 'sky', kind: 'assignment', words: 0, focus_minutes: 0 }),
  study_documents: () => ({ kind: 'doc', title: 'Draft', content: {}, text: '', words: 0, chip_words: 0, version: 1, sort: 0 }),
  study_tasks: () => ({ due_on: null, done: false, done_at: null, sort: 0, created_by: 'me' }),
  study_sources: () => ({ kind: 'web', data: {}, note: '', content: '', file_name: null, created_by: 'me' }),
  study_notes: () => ({ body: '', pinned: false }),
  study_focus: () => ({ assignment_id: null, started_at: now() }),
  study_threads: () => ({ title: '' }),
  study_messages: () => ({ meta: {} }),
  study_ai_log: () => ({ message_id: null, summary: '', prompt: '', output: '', words: 0, model: '' }),
  study_cards: () => ({ assignment_id: null, created_by: 'me', ease: 2.5, interval_days: 0, reps: 0, lapses: 0, due_at: now(), reviewed_at: null }),
  study_practice: () => ({ assignment_id: null, at: now() }),
};

export interface MockOptions {
  tier?: 'free' | 'pro';
  /** Whether Pro can be bought (live Flutterwave keys). */
  payOn?: boolean;
  /** Chip has no time left today. */
  chipOut?: boolean;
  name?: string;
}

export class MockBackend {
  db: Record<Table, Row[]> = Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Record<Table, Row[]>;
  user = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'ada@school.edu' };
  calls: { method: string; path: string; body: unknown }[] = [];
  fastUsed = 0;
  bestUsed = 0;

  constructor(public opts: MockOptions = {}) {}

  session() {
    const expires = Math.floor(Date.now() / 1000) + 3600 * 24;
    return {
      access_token: 'mock-access-token',
      token_type: 'bearer',
      expires_in: 3600 * 24,
      expires_at: expires,
      refresh_token: 'mock-refresh-token',
      user: { id: this.user.id, aud: 'authenticated', role: 'authenticated', email: this.user.email, is_anonymous: false, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: now() },
    };
  }

  /** Answers for the app on [page]; with [signedIn], the page starts signed in. */
  async install(page: Page, { signedIn = true } = {}) {
    if (signedIn) {
      await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [AUTH_KEY, JSON.stringify(this.session())]);
    }
    await page.route(`${BASE}/**`, (route) => this.handle(route));
  }

  /** An assignment with its document, ready to open. */
  seedAssignment(fields: Record<string, unknown> = {}) {
    const a = this.insert('study_assignments', { title: 'Coastal erosion essay', course: 'GEO 201', brief: 'Write 1,500 words on how coastal towns should adapt to rising seas.', rubric: 'Argument 40%, Evidence 30%, Structure 20%, Referencing 10%.', due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), word_target: 1500, ...fields });
    this.insert('study_documents', { assignment_id: a.id, kind: 'doc', title: 'Draft' });
    return a;
  }

  insert(table: Table, values: Record<string, unknown>): Row {
    const row: Row = { id: uuid(), user_id: this.user.id, created_at: now(), updated_at: now(), ...DEFAULTS[table](), ...values } as Row;
    if (table === 'study_ai_log') row.at = now();
    if (table === 'study_focus' && row.assignment_id) {
      const a = this.db.study_assignments.find((x) => x.id === row.assignment_id);
      if (a) a.focus_minutes = Number(a.focus_minutes) + Number(row.minutes);
    }
    this.db[table].push(row);
    return row;
  }

  private json(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) {
    return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) });
  }

  async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    let body: unknown = null;
    try {
      body = req.postData() ? JSON.parse(req.postData()!) : null;
    } catch {
      body = req.postData();
    }
    this.calls.push({ method, path: url.pathname + url.search, body });
    const path = url.pathname;

    if (path.startsWith('/auth/v1/')) return this.auth(route, path.slice(9), body as Record<string, unknown>);
    if (path.startsWith('/rest/v1/rpc/')) return this.rpc(route, path.slice(13), (body ?? {}) as Record<string, unknown>);
    if (path.startsWith('/rest/v1/')) return this.rest(route, path.slice(9) as Table, url, method, body, req.headers());
    if (path === '/functions/v1/chip-study') return this.chip(route, body as Record<string, unknown>);
    if (path === '/functions/v1/web-pay') return this.pay(route, body as Record<string, unknown>);
    return this.json(route, { error: 'not mocked' }, 404);
  }

  private auth(route: Route, what: string, body: Record<string, unknown>) {
    if (what === 'otp') return this.json(route, {});
    if (what === 'verify') {
      if (String(body?.token) !== '12345678') return this.json(route, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403);
      return this.json(route, this.session());
    }
    if (what.startsWith('token')) return this.json(route, this.session());
    if (what === 'user') return this.json(route, this.session().user);
    if (what.startsWith('logout')) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    return this.json(route, {});
  }

  private filter(rows: Row[], url: URL): Row[] {
    let out = rows.filter((r) => r.user_id === this.user.id);
    for (const [key, value] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      const [op, ...rest] = value.split('.');
      const v = rest.join('.');
      out = out.filter((r) => {
        const x = r[key];
        if (op === 'eq') return String(x) === v;
        if (op === 'neq') return String(x) !== v;
        if (op === 'gte') return String(x) >= v;
        if (op === 'lte') return String(x) <= v;
        if (op === 'gt') return String(x) > v;
        if (op === 'lt') return String(x) < v;
        if (op === 'is') return v === 'null' ? x == null : String(x) === v;
        return true;
      });
    }
    const order = url.searchParams.get('order');
    if (order) {
      const keys = order.split(',').map((o) => {
        const [col, dir] = o.split('.');
        return { col, desc: dir === 'desc' };
      });
      out = [...out].sort((a, b) => {
        for (const k of keys) {
          const x = a[k.col] as string | number;
          const y = b[k.col] as string | number;
          if (x === y) continue;
          const c = x < y ? -1 : 1;
          return k.desc ? -c : c;
        }
        return 0;
      });
    }
    const limit = url.searchParams.get('limit');
    if (limit) out = out.slice(0, Number(limit));
    return out;
  }

  private respondRows(route: Route, rows: Row[], headers: Record<string, string>) {
    if ((headers['accept'] ?? '').includes('vnd.pgrst.object')) {
      if (rows.length !== 1) return this.json(route, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 406);
      return this.json(route, rows[0]);
    }
    return this.json(route, rows);
  }

  private rest(route: Route, table: Table, url: URL, method: string, body: unknown, headers: Record<string, string>) {
    if (!TABLES.includes(table)) return this.json(route, { message: 'unknown table' }, 404);
    if (method === 'GET') return this.respondRows(route, this.filter(this.db[table], url), headers);
    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      const made = list.map((v) => this.insert(table, v));
      return this.respondRows(route, made, headers);
    }
    if (method === 'PATCH') {
      const rows = this.filter(this.db[table], url);
      for (const r of rows) {
        Object.assign(r, body as Record<string, unknown>, { updated_at: now() });
        if (table === 'study_tasks') r.done_at = r.done ? now() : null;
      }
      return this.respondRows(route, rows, headers);
    }
    if (method === 'DELETE') {
      const rows = this.filter(this.db[table], url);
      const ids = new Set(rows.map((r) => r.id));
      this.db[table] = this.db[table].filter((r) => !ids.has(r.id));
      if (table === 'study_assignments') for (const t of TABLES) if (t !== 'study_assignments') this.db[t] = this.db[t].filter((r) => !ids.has(String(r.assignment_id)));
      if (table === 'study_threads') this.db.study_messages = this.db.study_messages.filter((m) => !ids.has(String(m.thread_id)));
      return this.respondRows(route, rows, headers);
    }
    return this.json(route, { message: 'method' }, 405);
  }

  me() {
    const pro = this.opts.tier === 'pro';
    const out = this.opts.chipOut;
    return {
      tier: pro ? 'pro' : 'free',
      name: this.opts.name ?? 'Ada Lovelace',
      pro_until: pro ? new Date(Date.now() + 20 * 86_400_000).toISOString() : null,
      resets_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      fast: { used: out ? 0.03 : this.fastUsed, cap: pro ? 0.05 : 0.03, avg: 0.0012 },
      best: pro ? { used: this.bestUsed, cap: 0.4, avg: 0.03, period_used: 1.1, period_cap: 3 } : null,
      uploads: { used: 0, cap: pro ? 25 : 3, max_mb: pro ? 20 : 4 },
      readings: { used: 0, cap: pro ? 30 : 3, max_chars: pro ? 400000 : 60000 },
      price: { amount: 4.99, currency: 'USD' },
    };
  }

  private rpc(route: Route, fn: string, args: Record<string, unknown>) {
    if (fn === 'study_me') return this.json(route, this.me());
    if (fn === 'study_save_doc') {
      const d = this.db.study_documents.find((x) => x.id === args.p_doc);
      if (!d) return this.json(route, { message: 'unknown document' }, 400);
      if (d.version !== args.p_version) return this.json(route, { ok: false, version: d.version });
      if (args.p_content) d.content = args.p_content;
      if (typeof args.p_text === 'string') d.text = args.p_text;
      d.words = args.p_words;
      d.chip_words = Math.min(Number(args.p_chip_words ?? 0), Number(args.p_words ?? 0));
      d.version = Number(d.version) + 1;
      d.updated_at = now();
      const a = this.db.study_assignments.find((x) => x.id === d.assignment_id);
      if (a && d.kind === 'doc') {
        a.words = args.p_words;
        a.updated_at = now();
      }
      return this.json(route, { ok: true, version: d.version });
    }
    if (fn === 'study_log_use') {
      const row = this.insert('study_ai_log', {
        assignment_id: args.p_assignment,
        message_id: args.p_message ?? null,
        action: args.p_action,
        summary: args.p_action === 'inserted' ? 'Put Chip’s words into the document' : args.p_action === 'replaced' ? 'Replaced their own words with Chip’s rewrite' : args.p_action === 'added_tasks' ? 'Added the tasks Chip suggested to the checklist' : 'Added the sources Chip suggested',
        output: String(args.p_excerpt ?? '').slice(0, 4000),
        words: Number(args.p_words ?? 0),
      });
      return this.json(route, row.id);
    }
    if (fn === 'study_forget_me') {
      for (const t of TABLES) this.db[t] = [];
      return this.json(route, null);
    }
    return this.json(route, { message: `unknown function ${fn}` }, 404);
  }

  private pay(route: Route, body: Record<string, unknown>) {
    if (body?.action === 'status') return this.json(route, { on: !!this.opts.payOn, test: false });
    if (body?.action === 'subscribe') return this.opts.payOn ? this.json(route, { link: 'https://checkout.flutterwave.test/pay/abc', ref: 'kaivon-sub-1' }) : this.json(route, { error: 'off' }, 503);
    if (body?.action === 'confirm') {
      this.opts.tier = 'pro';
      return this.json(route, { status: 'paid', product: 'study_pro', until: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    }
    if (body?.action === 'cancel') return this.json(route, { status: 'cancelled', until: new Date(Date.now() + 20 * 86_400_000).toISOString() });
    return this.json(route, { error: 'Unknown action' }, 400);
  }

  /** Chip's answer for a message, by mode. */
  reply(mode: string, text: string): string {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    switch (mode) {
      case 'guide':
        return 'Good question. Before I tell you: what do you think happens to the energy when the bonds break? Have a guess, and we’ll build from there.';
      case 'plan':
        return [
          'Here’s a calm plan that leaves a day spare before it’s due.',
          '',
          '## Outline',
          '1. **Introduction** (150 words): the question and your answer.',
          '2. **Hard defences** (500 words): what sea walls do, and what they cost.',
          '',
          '```tasks',
          JSON.stringify([
            { title: 'Read the two set chapters', due: day(0) },
            { title: 'Outline three sections', due: day(1) },
            { title: 'Draft the introduction', due: day(2) },
          ]),
          '```',
        ].join('\n');
      case 'write':
        return ['Here’s a start you can make your own:', '', '```draft', 'Coastal towns face a hard choice between holding the line and retreating from it.', '```', '', 'Want it more formal?'].join('\n');
      case 'check':
        return [
          'Your argument is clear; the evidence needs more support.',
          '',
          '```rubric',
          JSON.stringify({ criteria: [{ name: 'Argument', band: 'Good', score: 7, out_of: 10, feedback: 'A clear position from the start.', next: 'Answer the counter-argument.' }, { name: 'Evidence', band: 'Developing', score: 5, out_of: 10, feedback: 'Few figures.', next: 'Add a statistic from your reading.' }], overall: 'A solid draft.' }),
          '```',
        ].join('\n');
      case 'cite':
        return ['I can’t search the web on your plan, so check these before you cite them.', '', '```sources', JSON.stringify([{ kind: 'article', authors: ['Nicholls, R. J.', 'Cazenave, A.'], year: '2010', title: 'Sea-level rise and its impact on coastal zones', container: 'Science', volume: '328', issue: '5985', pages: '1517-1520', doi: '10.1126/science.1185782', url: '', verified: false }]), '```'].join('\n');
      case 'quiz':
        if (/flashcard/i.test(text)) return ['```cards', JSON.stringify([{ front: 'Managed retreat', back: 'Moving people and buildings away from the coast on purpose.' }, { front: 'Groyne', back: 'A low wall that traps sand.' }]), '```'].join('\n');
        return ['Three quick ones:', '', '```quiz', JSON.stringify({ questions: [{ q: 'What do sea walls do to erosion further along the coast?', options: ['Stop it', 'Speed it up', 'Nothing'], answer: 1, why: 'They push the wave energy along the coast.' }] }), '```'].join('\n');
      default:
        return `Good question. Think of it like this: energy is conserved, so $E = mc^2$ tells you how much a little mass is worth.\n\n- First, the brief asks you to **take a position**.\n- Then, back it with evidence.\n\nWhat do you think the strongest evidence would be?`;
    }
  }

  private chip(route: Route, body: Record<string, unknown>) {
    if (body?.action === 'setup') {
      return this.json(route, {
        title: 'Essay: Coastal erosion and policy',
        course: 'GEO 201',
        due: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
        word_target: 1500,
        brief: '',
        rubric: 'Argument 40%\nEvidence 30%\nStructure 20%\nReferencing 10%',
        tasks: [
          { title: 'Read the set chapters', due: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) },
          { title: 'Write an outline', due: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) },
        ],
      });
    }
    if (body?.action !== 'chat') return this.json(route, { error: 'Unknown action' }, 400);
    if (this.opts.chipOut) return this.json(route, { error: 'That’s today’s Chip time. It’s back tomorrow.', why: 'limit', resets_at: new Date(Date.now() + 6 * 3_600_000).toISOString(), tier: 'free' }, 429);
    const mode = String(body.mode);
    const text = String(body.text);
    const model = body.model === 'best' && this.opts.tier === 'pro' ? 'best' : 'fast';
    let thread = typeof body.thread === 'string' ? this.db.study_threads.find((t) => t.id === body.thread) : undefined;
    if (!thread) thread = this.insert('study_threads', { assignment_id: body.assignment, title: text.slice(0, 80) });
    const asked = this.insert('study_messages', { thread_id: thread.id, assignment_id: body.assignment, role: 'user', mode, content: text });
    const answer = this.reply(mode, text);
    const said = this.insert('study_messages', { thread_id: thread.id, assignment_id: body.assignment, role: 'chip', mode, content: answer, meta: { model: model === 'best' ? 'claude-opus-5-5' : 'claude-haiku-5-5', kind: model } });
    this.insert('study_ai_log', { assignment_id: body.assignment, message_id: said.id, action: mode, summary: `Asked Chip to ${mode === 'write' ? 'write or improve text' : mode}`, prompt: text, output: answer.slice(0, 4000), model: said.meta && (said.meta as { model: string }).model });
    if (model === 'best') this.bestUsed += 0.03;
    else this.fastUsed += 0.0012;
    const events: unknown[] = [{ t: 'start', thread: thread.id, message: asked.id, model, note: null }, { t: 'think', text: 'Reading your brief and rubric.' }];
    for (let i = 0; i < answer.length; i += 24) events.push({ t: 'text', text: answer.slice(i, i + 24) });
    events.push({ t: 'done', message: said.id, model, cut: false });
    return route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'text/event-stream; charset=utf-8' },
      body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
    });
  }

  /** Requests the app made to [path] (and how), for checking. */
  made(path: string, method?: string) {
    return this.calls.filter((c) => c.path.startsWith(path) && (!method || c.method === method));
  }
}
