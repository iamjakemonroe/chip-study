import type { SourceData, SourceKind } from './types.ts';

/** Chip's answers are Markdown with a few fenced blocks the app draws as cards (see the
 * chip-study function's prompt): a plan's tasks, a quiz, flashcards, rubric feedback, sources
 * and a draft for the document. */

export type BlockName = 'tasks' | 'quiz' | 'cards' | 'rubric' | 'sources' | 'draft';

export interface PlanTask {
  title: string;
  due: string | null;
}
export interface QuizQuestion {
  q: string;
  options: string[];
  answer: number;
  why: string;
}
export interface Flashcard {
  front: string;
  back: string;
}
export interface Criterion {
  name: string;
  band: string;
  score: number | null;
  out_of: number | null;
  feedback: string;
  next: string;
}
export interface SuggestedSource {
  kind: SourceKind;
  data: SourceData;
  verified: boolean;
}

export type Segment =
  | { kind: 'md'; text: string }
  | { kind: 'draft'; text: string; done: boolean }
  | { kind: 'tasks'; tasks: PlanTask[] }
  | { kind: 'quiz'; questions: QuizQuestion[] }
  | { kind: 'cards'; cards: Flashcard[] }
  | { kind: 'rubric'; criteria: Criterion[]; overall: string }
  | { kind: 'sources'; sources: SuggestedSource[] }
  | { kind: 'pending'; block: BlockName };

const OPEN = /^\s*```\s*(tasks|quiz|cards|rubric|sources|draft)\s*$/;
const CLOSE = /^\s*```\s*$/;

/** Splits an answer into Markdown and cards. While it's still [streaming], an unfinished block
 * shows as pending (a draft shows as far as it's got). */
export function segments(text: string, streaming = false): Segment[] {
  const lines = text.split('\n');
  const out: Segment[] = [];
  let md: string[] = [];
  const flush = () => {
    const body = md.join('\n');
    if (body.trim()) out.push({ kind: 'md', text: body });
    md = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i]);
    if (!open) {
      md.push(lines[i]);
      continue;
    }
    const name = open[1] as BlockName;
    let j = i + 1;
    // A draft can hold its own fenced code, so its end is the last bare fence before the next
    // block (or the end).
    let end = -1;
    let depth = 0;
    for (; j < lines.length; j++) {
      if (name === 'draft' && /^\s*```\s*\S+/.test(lines[j])) depth++;
      else if (CLOSE.test(lines[j])) {
        if (depth > 0) depth--;
        else {
          end = j;
          break;
        }
      }
    }
    const body = lines.slice(i + 1, end === -1 ? lines.length : end).join('\n');
    flush();
    if (end === -1 && streaming) {
      out.push(name === 'draft' ? { kind: 'draft', text: body, done: false } : { kind: 'pending', block: name });
      return out;
    }
    const block = read(name, body);
    if (block) out.push(block);
    else md.push('```', body, '```');
    i = end === -1 ? lines.length : end;
  }
  flush();
  return out;
}

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const KINDS: SourceKind[] = ['book', 'chapter', 'article', 'web', 'report', 'video', 'other'];

/** JSON as models sometimes write it: a trailing comma is forgiven. */
function parse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(body.trim().replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return undefined;
    }
  }
}

function read(name: BlockName, body: string): Segment | null {
  if (name === 'draft') return body.trim() ? { kind: 'draft', text: body.replace(/^\n+|\n+$/g, ''), done: true } : null;
  const data = parse(body);
  if (data === undefined) return null;
  switch (name) {
    case 'tasks': {
      const list = Array.isArray(data) ? data : [];
      const tasks = list
        .map((t: Record<string, unknown>) => ({ title: str(t?.title, 300), due: date(t?.due) }))
        .filter((t) => t.title)
        .slice(0, 20);
      return tasks.length ? { kind: 'tasks', tasks } : null;
    }
    case 'quiz': {
      const list = (data as { questions?: unknown })?.questions;
      const questions = (Array.isArray(list) ? list : [])
        .map((q: Record<string, unknown>) => {
          const options = Array.isArray(q?.options) ? q.options.map((o) => str(o, 500)).filter(Boolean).slice(0, 6) : [];
          const answer = num(q?.answer);
          return { q: str(q?.q, 1000), options, answer: answer ?? -1, why: str(q?.why, 1500) };
        })
        .filter((q) => q.q && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length)
        .slice(0, 20);
      return questions.length ? { kind: 'quiz', questions } : null;
    }
    case 'cards': {
      const cards = (Array.isArray(data) ? data : [])
        .map((c: Record<string, unknown>) => ({ front: str(c?.front, 600), back: str(c?.back, 1500) }))
        .filter((c) => c.front && c.back)
        .slice(0, 50);
      return cards.length ? { kind: 'cards', cards } : null;
    }
    case 'rubric': {
      const r = data as { criteria?: unknown; overall?: unknown };
      const criteria = (Array.isArray(r?.criteria) ? r.criteria : [])
        .map((c: Record<string, unknown>) => ({
          name: str(c?.name, 200),
          band: str(c?.band, 80),
          score: num(c?.score),
          out_of: num(c?.out_of),
          feedback: str(c?.feedback, 2000),
          next: str(c?.next, 1000),
        }))
        .filter((c) => c.name)
        .slice(0, 20);
      return criteria.length ? { kind: 'rubric', criteria, overall: str(r?.overall, 2000) } : null;
    }
    case 'sources': {
      const sources = (Array.isArray(data) ? data : [])
        .map((s: Record<string, unknown>) => ({
          kind: KINDS.includes(s?.kind as SourceKind) ? (s.kind as SourceKind) : 'other',
          verified: s?.verified === true,
          data: {
            authors: Array.isArray(s?.authors) ? s.authors.map((a) => str(a, 200)).filter(Boolean).slice(0, 30) : [],
            year: str(s?.year, 40),
            title: str(s?.title, 500),
            container: str(s?.container, 300),
            publisher: str(s?.publisher, 300),
            volume: str(s?.volume, 40),
            issue: str(s?.issue, 40),
            pages: str(s?.pages, 40),
            doi: str(s?.doi, 300),
            url: /^https?:\/\//.test(str(s?.url)) ? str(s?.url, 1000) : '',
          },
        }))
        .filter((s) => s.data.title)
        // Verified means found on the web this time: it has to have a link to show for it.
        .map((s) => ({ ...s, verified: s.verified && !!(s.data.url || s.data.doi) }))
        .slice(0, 20);
      return sources.length ? { kind: 'sources', sources } : null;
    }
  }
}

/** Chip's answer as text without its cards (for copying, and for the record). */
export function plainAnswer(text: string): string {
  return segments(text)
    .map((s) => (s.kind === 'md' || s.kind === 'draft' ? s.text : ''))
    .filter(Boolean)
    .join('\n\n');
}
