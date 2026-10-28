import type { Assignment, LogAction, LogEntry } from './types.ts';

/** An AI-use declaration: what the student used Chip for on one assignment, from the record
 * the server kept (study_ai_log), ready to hand in with the work. */
export interface Declaration {
  student: string;
  assignment: string;
  course: string;
  due: string;
  generated: string;
  /** The student's own words about how they used it (optional). */
  ownWords: string;
  words: number;
  chipWords: number;
  /** Chip's words still in the document, as a percentage (one decimal). */
  share: number;
  counts: { label: string; count: number }[];
  models: string[];
  entries: { at: string; what: string; asked: string; gave: string; words: number }[];
}

const ACTION_LABELS: Record<LogAction, string> = {
  guide: 'Guided tutoring (Chip asking and hinting)',
  explain: 'Explanations',
  plan: 'Planning',
  write: 'Drafting or improving text',
  check: 'Feedback on their own work',
  cite: 'Finding and formatting sources',
  quiz: 'Practice questions and flashcards',
  setup: 'Reading the assignment brief',
  inserted: 'Chip’s text put into the document',
  replaced: 'Own text replaced with Chip’s rewrite',
  added_tasks: 'Chip’s tasks added to the plan',
  added_sources: 'Chip’s sources added',
};

/** "Claude Opus 5.5" from "claude-opus-5-5". */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id;
  return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

const clean = (text: string, max: number) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function buildDeclaration(input: {
  student: string;
  assignment: Pick<Assignment, 'title' | 'course' | 'due_at'>;
  log: LogEntry[];
  words: number;
  chipWords: number;
  ownWords?: string;
  now?: Date;
}): Declaration {
  const { assignment, log } = input;
  const ordered = [...log].sort((a, b) => a.at.localeCompare(b.at));
  const tally = new Map<LogAction, number>();
  for (const e of ordered) tally.set(e.action, (tally.get(e.action) ?? 0) + 1);
  const counts = (Object.keys(ACTION_LABELS) as LogAction[])
    .filter((a) => tally.has(a))
    .map((a) => ({ label: ACTION_LABELS[a], count: tally.get(a)! }));
  const models = [...new Set(ordered.map((e) => e.model).filter(Boolean).map(modelName))].sort();
  const chipWords = Math.min(Math.max(input.chipWords, 0), Math.max(input.words, 0));
  return {
    student: input.student.trim() || 'Student',
    assignment: assignment.title,
    course: assignment.course,
    due: assignment.due_at ? new Date(assignment.due_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
    generated: (input.now ?? new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    ownWords: (input.ownWords ?? '').trim(),
    words: input.words,
    chipWords,
    share: input.words > 0 ? Math.round((chipWords / input.words) * 1000) / 10 : 0,
    counts,
    models,
    entries: ordered.map((e) => ({
      at: stamp(e.at),
      what: e.summary || ACTION_LABELS[e.action],
      asked: clean(e.prompt, 280),
      gave: clean(e.output, 280),
      words: e.words,
    })),
  };
}

/** The statement at the top, in plain words. */
export function statement(d: Declaration): string {
  if (d.entries.length === 0) {
    return `I did not use Chip, Chip Study’s AI study partner, for this assignment.`;
  }
  const tools = d.models.length ? ` (${d.models.join(', ')}, made by Anthropic)` : '';
  const share =
    d.chipWords > 0
      ? `${d.chipWords.toLocaleString('en-GB')} of the ${d.words.toLocaleString('en-GB')} words in my final document (${d.share}%) are still in Chip’s wording; everything else is my own.`
      : `None of the words in my final document are in Chip’s wording.`;
  return `I used Chip, the AI study partner in Chip Study${tools}, while working on this assignment, as recorded below. ${share}`;
}

const md = (t: string) => t.replace(/([\\`*_[\]|<>#])/g, '\\$1');

export function toMarkdown(d: Declaration): string {
  const out: string[] = [];
  out.push('# Declaration of AI use', '');
  out.push(`**Student:** ${md(d.student)}  `);
  out.push(`**Assignment:** ${md(d.assignment)}  `);
  if (d.course) out.push(`**Course:** ${md(d.course)}  `);
  if (d.due) out.push(`**Due:** ${d.due}  `);
  out.push(`**Generated:** ${d.generated} by Chip Study (study.kaivon.app)`, '');
  out.push('## Statement', '', md(statement(d)), '');
  if (d.ownWords) out.push('## In my own words', '', md(d.ownWords), '');
  if (d.counts.length) {
    out.push('## Summary', '');
    for (const c of d.counts) out.push(`- ${c.label}: ${c.count}`);
    out.push('');
  }
  if (d.entries.length) {
    out.push('## Record', '', '| When | What | Asked | Chip’s answer (start) | Words |', '| --- | --- | --- | --- | --- |');
    for (const e of d.entries) {
      out.push(`| ${e.at} | ${md(e.what)} | ${md(e.asked) || '—'} | ${md(e.gave) || '—'} | ${e.words || ''} |`);
    }
    out.push('');
  }
  out.push('Signed: ______________________    Date: ______________', '');
  return out.join('\n');
}
