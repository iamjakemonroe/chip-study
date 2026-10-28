import { AnimatePresence, motion } from 'framer-motion';
import { BookPlus, Check, ChevronLeft, ChevronRight, ClipboardCopy, Layers, ListPlus, Replace, RotateCcw, Shuffle, ShieldAlert, ShieldCheck, TextCursorInput } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../../components/ui.tsx';
import { addCards, addPractice, addSource, addTasks, logUse } from '../../lib/api.ts';
import type { Criterion, Flashcard, PlanTask, QuizQuestion, SuggestedSource } from '../../lib/blocks.ts';
import { html, reference } from '../../lib/citations.ts';
import { toDay } from '../../lib/dates.ts';
import { markdownToEditorHtml, renderMarkdown } from '../../lib/markdown.ts';
import { toast } from '../../store/toast.ts';
import { insertFromChip } from '../extensions.ts';
import { editors, useWorkspace } from '../store.ts';

const ease = [0.2, 0.7, 0.1, 1] as const;
const isLocal = (id: string) => id.startsWith('local-');

/** Text Chip wrote for the document: put it in at the cursor, or over the selection. */
export function DraftCard({ text, done, messageId }: { text: string; done: boolean; messageId: string }) {
  const [put, setPut] = useState<null | 'inserted' | 'replaced'>(null);
  const shown = useMemo(() => renderMarkdown(text), [text]);
  const selection = useWorkspace((s) => s.selection);

  const insert = async () => {
    const editor = editors.doc;
    const { assignment } = useWorkspace.getState();
    if (!editor || !assignment) return toast('Open your document to put this in.', 'info');
    const replacing = !editor.state.selection.empty;
    const words = insertFromChip(editor, markdownToEditorHtml(text), isLocal(messageId) ? null : messageId);
    setPut(replacing ? 'replaced' : 'inserted');
    try {
      await logUse(assignment.id, replacing ? 'replaced' : 'inserted', isLocal(messageId) ? null : messageId, words, text);
      useWorkspace.setState({ log: [...useWorkspace.getState().log, { id: `local-${Date.now()}`, assignment_id: assignment.id, message_id: null, at: new Date().toISOString(), action: replacing ? 'replaced' : 'inserted', summary: replacing ? 'Replaced their own words with Chip’s rewrite' : 'Put Chip’s words into the document', prompt: '', output: text.slice(0, 4000), words, model: '' }] });
    } catch {
      toast('Put in, but it couldn’t be noted in your record. Check your connection.', 'warn');
    }
    toast(`${words} words put in, marked as Chip’s until you rewrite them.`, 'good');
  };

  return (
    <div className="chip-card border-iris/20 bg-gradient-to-b from-white to-iris-soft/30">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-iris-2">Draft</span>
        {!done && <Spinner size={12} />}
      </div>
      <div className="chip-md px-4 pb-3 pt-1 font-serif text-[1.02rem]" dangerouslySetInnerHTML={{ __html: shown }} />
      {done && (
        <div className="flex flex-wrap gap-1.5 border-t border-iris/10 px-3 py-2.5">
          {put ? (
            <span className="flex h-8 items-center gap-1.5 px-2 text-sm font-semibold text-mint">
              <Check size={15} /> {put === 'replaced' ? 'Replaced your selection' : 'In your document'}
            </span>
          ) : (
            <button className="btn btn-iris btn-sm h-8" onClick={() => void insert()}>
              {selection ? <Replace size={14} /> : <TextCursorInput size={14} />} {selection ? 'Replace selection' : 'Put in my document'}
            </button>
          )}
          <button
            className="btn btn-quiet btn-sm h-8"
            onClick={() => {
              void navigator.clipboard?.writeText(text);
              toast('Copied.', 'info');
            }}
          >
            <ClipboardCopy size={14} /> Copy
          </button>
        </div>
      )}
    </div>
  );
}

/** A plan's tasks, to add to the checklist. */
export function TasksCard({ tasks, messageId }: { tasks: PlanTask[]; messageId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle');
  const add = async () => {
    const { assignment, tasks: existing } = useWorkspace.getState();
    if (!assignment) return;
    setState('busy');
    try {
      const made = await addTasks(assignment.id, tasks, 'chip', existing.length);
      useWorkspace.setState({ tasks: [...useWorkspace.getState().tasks, ...made] });
      setState('added');
      void logUse(assignment.id, 'added_tasks', isLocal(messageId) ? null : messageId, 0, tasks.map((t) => t.title).join('\n')).catch(() => undefined);
      toast(`${made.length} tasks added to your plan.`, 'good');
    } catch (e) {
      setState('idle');
      toast((e as Error).message, 'warn');
    }
  };
  return (
    <div className="chip-card">
      <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-mint">Your plan</div>
      <ol className="space-y-1.5 px-4 py-3">
        {tasks.map((t, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-mint-soft text-[0.7rem] font-bold text-mint">{i + 1}</span>
            <span className="flex-1 leading-snug">{t.title}</span>
            {t.due && <span className="chip-tag flex-none bg-paper-2 text-ink-3">{new Date(`${t.due}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
          </li>
        ))}
      </ol>
      <div className="border-t border-line px-3 py-2.5">
        {state === 'added' ? (
          <span className="flex h-8 items-center gap-1.5 px-2 text-sm font-semibold text-mint">
            <Check size={15} /> Added to your plan
          </span>
        ) : (
          <button className="btn btn-primary btn-sm h-8" onClick={() => void add()} disabled={state === 'busy'}>
            {state === 'busy' ? <Spinner /> : <ListPlus size={14} />} Add {tasks.length} tasks to my plan
          </button>
        )}
      </div>
    </div>
  );
}

/** Sources Chip found (or suggests), to add to the assignment's. */
export function SourcesCard({ sources, messageId }: { sources: SuggestedSource[]; messageId: string }) {
  const style = useWorkspace((s) => s.assignment?.style ?? 'apa');
  const [added, setAdded] = useState<Set<number>>(new Set());
  const add = async (i: number) => {
    const { assignment } = useWorkspace.getState();
    if (!assignment) return;
    const s = sources[i];
    try {
      const made = await addSource(assignment.id, { kind: s.kind, data: { ...s.data, ...(s.data.url ? { accessed: toDay(new Date()) } : {}) }, created_by: 'chip', note: s.verified ? '' : 'Suggested by Chip from memory: check it before you cite it.' });
      useWorkspace.setState({ sources: [...useWorkspace.getState().sources, made] });
      setAdded((a) => new Set(a).add(i));
      void logUse(assignment.id, 'added_sources', isLocal(messageId) ? null : messageId, 0, s.data.title ?? '').catch(() => undefined);
    } catch (e) {
      toast((e as Error).message, 'warn');
    }
  };
  return (
    <div className="chip-card">
      <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-sky">Sources</div>
      <ul className="divide-y divide-line">
        {sources.map((s, i) => (
          <li key={i} className="px-4 py-3">
            <p className="reference text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: html(reference(s.kind, s.data, style)) }} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {s.verified ? (
                <span className="chip-tag bg-mint-soft text-mint">
                  <ShieldCheck size={12} /> Found on the web
                </span>
              ) : (
                <span className="chip-tag bg-sand-soft text-[#8a6a1f]">
                  <ShieldAlert size={12} /> Check this one
                </span>
              )}
              {s.data.url && (
                <a className="text-xs font-semibold text-iris hover:underline" href={s.data.url} target="_blank" rel="noopener noreferrer">
                  Open
                </a>
              )}
              <span className="flex-1" />
              {added.has(i) ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-mint">
                  <Check size={13} /> Added
                </span>
              ) : (
                <button className="btn btn-ghost btn-sm h-7 px-2.5 text-xs" onClick={() => void add(i)}>
                  <BookPlus size={13} /> Add
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Saves cards to the student's review deck, once. */
function useSaveToDeck() {
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const save = async (cards: { front: string; back: string }[]) => {
    const { assignment } = useWorkspace.getState();
    setState('busy');
    try {
      await addCards(cards, assignment?.id ?? null, 'chip');
      setState('saved');
      toast(`${cards.length} card${cards.length === 1 ? '' : 's'} in your review deck. Chip Study will bring them back just before you’d forget.`, 'good');
    } catch (e) {
      setState('idle');
      toast((e as Error).message, 'warn');
    }
  };
  return { state, save };
}

/** Card text as Chip wrote it (Markdown and math are kept: the review deck draws them). */
const side = (md: string) => md.trim();

/** A multiple-choice quiz, one question at a time. The score is kept for the progress view, and
 * the ones missed can go into the review deck. */
export function QuizCard({ questions, onAgain }: { questions: QuizQuestion[]; onAgain: () => void }) {
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<(number | null)[]>(() => questions.map(() => null));
  const deck = useSaveToDeck();
  const q = questions[at];
  const score = picked.filter((p, i) => p === questions[i].answer).length;
  const finished = picked.every((p) => p !== null);
  const missed = questions.filter((x, i) => picked[i] !== null && picked[i] !== x.answer);
  useEffect(() => {
    if (finished) void addPractice('quiz', score, questions.length, useWorkspace.getState().assignment?.id ?? null).catch(() => undefined);
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="chip-card">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-lilac">Quiz</span>
        <span className="text-xs font-semibold tabular-nums text-ink-3">
          {at + 1} / {questions.length}
        </span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={at} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.3, ease }} className="px-4 py-3">
          <p className="font-semibold leading-snug" dangerouslySetInnerHTML={{ __html: renderMarkdown(q.q) }} />
          <ul className="mt-3 space-y-2">
            {q.options.map((o, i) => {
              const chosen = picked[at];
              const right = chosen !== null && i === q.answer;
              const wrong = chosen === i && i !== q.answer;
              return (
                <li key={i}>
                  <button
                    disabled={chosen !== null}
                    onClick={() => setPicked((p) => p.map((x, j) => (j === at ? i : x)))}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${right ? 'border-mint bg-mint-soft' : wrong ? 'border-rose/50 bg-rose-soft' : chosen === null ? 'border-line hover:border-iris/40 hover:bg-iris-soft/40' : 'border-line opacity-60'}`}
                  >
                    <span className={`grid h-5 w-5 flex-none place-items-center rounded-full text-[0.7rem] font-bold ${right ? 'bg-mint text-white' : wrong ? 'bg-rose text-white' : 'bg-paper-2 text-ink-3'}`}>{String.fromCharCode(65 + i)}</span>
                    <span className="flex-1" dangerouslySetInnerHTML={{ __html: renderMarkdown(o) }} />
                  </button>
                </li>
              );
            })}
          </ul>
          {picked[at] !== null && q.why && (
            <p className="mt-3 rounded-xl bg-paper px-3 py-2 text-sm leading-relaxed text-ink-2">
              <strong className={picked[at] === q.answer ? 'text-mint' : 'text-rose'}>{picked[at] === q.answer ? 'Right. ' : 'Not quite. '}</strong>
              <span dangerouslySetInnerHTML={{ __html: renderMarkdown(q.why).replace(/^<p>|<\/p>\s*$/g, '') }} />
            </p>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <button className="icon-btn h-8 w-8" aria-label="Previous question" disabled={at === 0} onClick={() => setAt(at - 1)}>
          <ChevronLeft size={16} />
        </button>
        <button className="icon-btn h-8 w-8" aria-label="Next question" disabled={at === questions.length - 1} onClick={() => setAt(at + 1)}>
          <ChevronRight size={16} />
        </button>
        <span className="flex-1 text-sm font-semibold text-ink-2">{finished ? `You got ${score} of ${questions.length}${score === questions.length ? '. Brilliant.' : '.'}` : ''}</span>
        {finished && missed.length > 0 && deck.state !== 'saved' && (
          <button
            className="btn btn-quiet btn-sm h-8"
            disabled={deck.state === 'busy'}
            onClick={() => void deck.save(missed.map((x) => ({ front: side(x.q), back: `${side(x.options[x.answer])}${x.why ? `. ${side(x.why)}` : ''}` })))}
          >
            <Layers size={14} /> Review the {missed.length} I missed
          </button>
        )}
        {finished && (
          <button className="btn btn-ghost btn-sm h-8" onClick={onAgain}>
            <RotateCcw size={14} /> Another
          </button>
        )}
      </div>
    </div>
  );
}

/** Flashcards: tap to turn over, and keep them in the review deck. */
export function CardsCard({ cards }: { cards: Flashcard[] }) {
  const deck = useSaveToDeck();
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const c = cards[order[at]];
  const go = (n: number) => {
    setFlipped(false);
    setAt((n + cards.length) % cards.length);
  };
  return (
    <div className="chip-card">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-peach">Flashcards</span>
        <span className="text-xs font-semibold tabular-nums text-ink-3">
          {at + 1} / {cards.length}
        </span>
      </div>
      <div className="px-4 py-3 [perspective:1000px]">
        <button className={`flip relative h-40 w-full ${flipped ? 'is-flipped' : ''}`} onClick={() => setFlipped((f) => !f)} aria-label={flipped ? 'Show the front' : 'Show the answer'}>
          <span className="flip-face grid place-items-center rounded-2xl border border-line bg-white px-5 text-center font-semibold" dangerouslySetInnerHTML={{ __html: renderMarkdown(c.front) }} />
          <span className="flip-face flip-back grid place-items-center rounded-2xl border border-peach/30 bg-peach-soft px-5 text-center text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(c.back) }} />
        </button>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <button className="icon-btn h-8 w-8" aria-label="Previous card" onClick={() => go(at - 1)}>
          <ChevronLeft size={16} />
        </button>
        <button className="icon-btn h-8 w-8" aria-label="Next card" onClick={() => go(at + 1)}>
          <ChevronRight size={16} />
        </button>
        <button
          className="icon-btn h-8 w-8"
          aria-label="Shuffle"
          title="Shuffle"
          onClick={() => {
            setOrder((o) => [...o].sort(() => Math.random() - 0.5));
            setAt(0);
            setFlipped(false);
          }}
        >
          <Shuffle size={14} />
        </button>
        <span className="flex-1" />
        {deck.state === 'saved' ? (
          <span className="flex h-8 items-center gap-1.5 px-2 text-sm font-semibold text-mint">
            <Check size={15} /> In your deck
          </span>
        ) : (
          <button className="btn btn-primary btn-sm h-8" disabled={deck.state === 'busy'} onClick={() => void deck.save(cards.map((c) => ({ front: side(c.front), back: side(c.back) })))}>
            <Layers size={14} /> Save to review
          </button>
        )}
      </div>
    </div>
  );
}

/** Feedback against the rubric, criterion by criterion. */
export function RubricCard({ criteria, overall }: { criteria: Criterion[]; overall: string }) {
  return (
    <div className="chip-card">
      <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-mint">Against your rubric</div>
      <ul className="space-y-4 px-4 py-3">
        {criteria.map((c, i) => {
          const share = c.score !== null && c.out_of ? Math.max(0, Math.min(1, c.score / c.out_of)) : null;
          return (
            <li key={i}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{c.name}</span>
                <span className="flex items-center gap-2">
                  {c.band && <span className="chip-tag bg-mint-soft text-mint">{c.band}</span>}
                  {c.score !== null && c.out_of && (
                    <span className="text-sm font-semibold tabular-nums text-ink-2">
                      {c.score}/{c.out_of}
                    </span>
                  )}
                </span>
              </div>
              {share !== null && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-2">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-[#5fd8b6] to-[#22a989]" initial={{ width: 0 }} animate={{ width: `${share * 100}%` }} transition={{ duration: 0.9, ease, delay: 0.1 * i }} />
                </div>
              )}
              {c.feedback && <p className="mt-2 text-sm leading-relaxed text-ink-2">{c.feedback}</p>}
              {c.next && (
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                  <strong className="text-iris-2">Next: </strong>
                  {c.next}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {overall && <p className="border-t border-line px-4 py-3 text-sm leading-relaxed text-ink-2">{overall}</p>}
    </div>
  );
}

/** A card still being written. */
export function PendingCard({ block }: { block: string }) {
  const label: Record<string, string> = { tasks: 'your plan', quiz: 'your quiz', cards: 'your flashcards', rubric: 'your feedback', sources: 'your sources' };
  return (
    <div className="chip-card flex items-center gap-3 px-4 py-4 text-sm text-ink-3">
      <Spinner size={14} /> Chip is writing {label[block] ?? 'this'}…
    </div>
  );
}
