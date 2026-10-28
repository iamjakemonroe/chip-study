import { SseReader } from './sse.ts';
import { SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase.ts';
import type { Mode, ModelKind } from './types.ts';

/** Talking to Chip (the chip-study function): a message streamed back as events, and reading an
 * assignment sheet. */

export type ChipEvent =
  | { t: 'start'; thread: string; message: string; model: ModelKind; note: 'best_used' | 'pro' | null }
  | { t: 'think'; text: string }
  | { t: 'search' }
  | { t: 'text'; text: string }
  | { t: 'done'; message: string | null; model: ModelKind; cut: boolean }
  | { t: 'refusal' }
  | { t: 'error'; error: string };

export interface ChatRequest {
  assignment: string;
  thread: string | null;
  mode: Mode;
  text: string;
  selection?: string;
  doc: string;
  model: ModelKind;
  /** Ask the last question again (a new answer instead of the last one). */
  again?: boolean;
}

/** Chip said no before starting: why ('limit', 'busy', 'size', 'uploads', 'account'), and when
 * it's back. */
export class ChipRefused extends Error {
  constructor(
    message: string,
    public why: string,
    public resetsAt: string | null,
  ) {
    super(message);
  }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const access = data.session?.access_token;
  if (!access) throw new ChipRefused('Sign in to talk to Chip.', 'account', null);
  return access;
}

export async function askChip(req: ChatRequest, onEvent: (e: ChipEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chip-study`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'chat', today: today(), ...req }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; why?: string; resets_at?: string };
    if (body.why) throw new ChipRefused(body.error ?? 'Chip can’t take that just now.', body.why, body.resets_at ?? null);
    throw new Error(body.error ?? 'Chip couldn’t think just now. Try again.');
  }
  let finished = false;
  const reader = new SseReader<ChipEvent>((e) => {
    if (e.t === 'done' || e.t === 'refusal' || e.t === 'error') finished = true;
    onEvent(e);
  });
  const stream = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await stream.read();
    if (done) break;
    reader.push(decoder.decode(value, { stream: true }));
  }
  reader.end();
  if (!finished) onEvent({ t: 'error', error: 'The connection to Chip dropped. Try again.' });
}

export interface Setup {
  title: string;
  course: string;
  due: string;
  word_target: number | null;
  brief: string;
  rubric: string;
  tasks: { title: string; due: string }[];
}

/** Chip reads an assignment sheet: its text, or the file itself (a scan or a photo). */
export async function readSheet(input: { text?: string; file?: { media_type: string; data: string } }): Promise<Setup> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chip-study`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setup', today: today(), ...input }),
  });
  const body = (await res.json().catch(() => ({}))) as Setup & { error?: string; why?: string; resets_at?: string };
  if (!res.ok) {
    if (body.why) throw new ChipRefused(body.error ?? 'Chip can’t read that just now.', body.why, body.resets_at ?? null);
    throw new Error(body.error ?? 'Chip couldn’t read that one.');
  }
  return body;
}
