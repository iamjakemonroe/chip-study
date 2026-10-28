import { AnimatePresence, motion } from 'framer-motion';
import { Brain, Check, Flame, Layers, Plus, Search, Trash2, Trophy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Orb } from '../components/Orb.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { Modal, Ring, Spinner } from '../components/ui.tsx';
import { addCards, addPractice, deleteCard, listCards, listFocusSince, listPracticeSince, updateCard } from '../lib/api.ts';
import { minutesLabel, startOfDay } from '../lib/dates.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { due, preview, schedule, stage, streak, type Rating } from '../lib/review.ts';
import type { Card, FocusSession, Practice } from '../lib/types.ts';
import { toast } from '../store/toast.ts';
import 'katex/dist/katex.min.css';

const ease = [0.2, 0.7, 0.1, 1] as const;
const minutesFor = (cards: number) => {
  const m = Math.max(1, Math.round(cards * 0.2));
  return `${m} minute${m === 1 ? '' : 's'}`;
};
const RATINGS: { rating: Rating; label: string; tone: string }[] = [
  { rating: 'again', label: 'Again', tone: 'bg-rose-soft text-[#b8355a] hover:bg-[#fbdbe5]' },
  { rating: 'hard', label: 'Hard', tone: 'bg-sand-soft text-[#8a6a1f] hover:bg-[#f7ead0]' },
  { rating: 'good', label: 'Good', tone: 'bg-mint-soft text-[#16795f] hover:bg-[#d2f0e6]' },
  { rating: 'easy', label: 'Easy', tone: 'bg-sky-soft text-[#1f6d9e] hover:bg-[#d3ebfb]' },
];

/** Review and progress: the cards due today, one at a time, spaced out by how well you knew each;
 * and what you've learned: your streak, the deck, focus and practice this week. */
export function ReviewPage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [practice, setPractice] = useState<Practice[]>([]);
  const [focus, setFocus] = useState<FocusSession[]>([]);
  const [session, setSession] = useState<{ queue: string[]; right: number; seen: number } | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const month = startOfDay(new Date(Date.now() - 60 * 86_400_000));
      const [c, p, f] = await Promise.all([listCards(), listPracticeSince(month), listFocusSince(month)]);
      setCards(c);
      setPractice(p);
      setFocus(f);
    } catch (e) {
      setCards((c) => c ?? []);
      toast((e as Error).message, 'warn');
    }
  }, []);

  useEffect(() => {
    document.title = 'Review · Chip Study';
    void load();
  }, [load]);

  const now = new Date();
  const dueNow = useMemo(() => due(cards ?? [], now), [cards]); // eslint-disable-line react-hooks/exhaustive-deps
  const week = startOfDay(new Date(Date.now() - 6 * 86_400_000));
  const stats = useMemo(() => {
    const all = cards ?? [];
    const stages = { new: 0, learning: 0, mastered: 0 };
    for (const c of all) stages[stage(c)] += 1;
    const thisWeek = practice.filter((p) => new Date(p.at) >= week);
    const quiz = thisWeek.filter((p) => p.kind === 'quiz');
    const quizRight = quiz.reduce((n, p) => n + p.correct, 0);
    const quizTotal = quiz.reduce((n, p) => n + p.total, 0);
    const reviewed = thisWeek.filter((p) => p.kind === 'review').reduce((n, p) => n + p.total, 0);
    const minutes = focus.filter((f) => new Date(f.started_at) >= week).reduce((n, f) => n + f.minutes, 0);
    const days = [...practice.map((p) => new Date(p.at)), ...focus.map((f) => new Date(f.started_at)), ...all.filter((c) => c.reviewed_at).map((c) => new Date(c.reviewed_at!))];
    return { stages, total: all.length, quizRight, quizTotal, reviewed, minutes, streak: streak(days) };
  }, [cards, practice, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => setSession({ queue: dueNow.map((c) => c.id), right: 0, seen: 0 });

  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[2rem] font-semibold tracking-[-0.025em]">Review</h1>
            <p className="mt-1 text-ink-2">A few minutes a day, just before you’d forget, is how it sticks.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            <Plus size={15} /> Add a card
          </button>
        </div>

        {cards === null ? (
          <div className="skeleton mt-8 h-72" />
        ) : session ? (
          <Session
            cards={cards}
            session={session}
            onRated={(card, next, right) => {
              setCards((all) => (all ?? []).map((c) => (c.id === card.id ? { ...c, ...next } : c)));
              setSession((s) => {
                if (!s) return s;
                // Forgotten cards come back at the end of this sitting.
                const queue = right ? s.queue.slice(1) : [...s.queue.slice(1), card.id];
                return { queue, right: s.right + (right ? 1 : 0), seen: s.seen + 1 };
              });
            }}
            onDone={async (right, seen) => {
              setSession(null);
              if (seen > 0) {
                try {
                  await addPractice('review', Math.min(right, seen), seen, null);
                } catch {
                  // The cards themselves are saved; only the tally is lost.
                }
                void load();
                toast(`Reviewed ${seen} card${seen === 1 ? '' : 's'}. Nicely done.`, 'good');
              }
            }}
          />
        ) : (
          <section className="mt-8 grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <div className="card relative overflow-hidden p-6 sm:p-8">
              <span className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-iris-soft blur-3xl" aria-hidden="true" />
              <div className="relative">
                <Orb size={48} />
                {dueNow.length > 0 ? (
                  <>
                    <p className="mt-5 text-2xl font-semibold tracking-[-0.02em]">
                      {dueNow.length} card{dueNow.length === 1 ? '' : 's'} to review
                    </p>
                    <p className="mt-1 text-ink-2">
                      About {minutesFor(dueNow.length)}. Answer in your head, then see how you did.
                    </p>
                    <button className="btn btn-iris mt-6" onClick={start}>
                      <Layers size={16} /> Start reviewing
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-5 text-2xl font-semibold tracking-[-0.02em]">{stats.total ? 'All caught up' : 'Your review deck is empty'}</p>
                    <p className="mt-1 max-w-md text-ink-2">
                      {stats.total
                        ? 'Nothing due right now. Cards come back just before you’d forget them.'
                        : 'Ask Chip for flashcards in Practice, or save the questions you miss in a quiz. They land here, and come back when it’s time.'}
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-ink-2">What you’ve learned</h2>
              <div className="mt-4 flex items-center gap-4">
                <Ring value={stats.total ? stats.stages.mastered / stats.total : 0} size={64} stroke={6} color="var(--color-mint)">
                  <Trophy size={20} className="text-mint" />
                </Ring>
                <div>
                  <p className="text-lg font-semibold">{stats.stages.mastered} mastered</p>
                  <p className="text-sm text-ink-3">
                    {stats.stages.learning} learning · {stats.stages.new} new
                  </p>
                </div>
              </div>
              <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-paper-2" aria-hidden="true">
                <span className="h-full bg-mint" style={{ width: `${stats.total ? (stats.stages.mastered / stats.total) * 100 : 0}%` }} />
                <span className="h-full bg-[#a79fff]" style={{ width: `${stats.total ? (stats.stages.learning / stats.total) * 100 : 0}%` }} />
              </div>
              <ul className="mt-6 space-y-3 text-sm">
                <li className="flex items-center gap-3">
                  <Flame size={17} className="text-peach" />
                  <span className="flex-1 text-ink-2">Study streak</span>
                  <strong className="font-semibold">{stats.streak} day{stats.streak === 1 ? '' : 's'}</strong>
                </li>
                <li className="flex items-center gap-3">
                  <Layers size={17} className="text-iris" />
                  <span className="flex-1 text-ink-2">Cards reviewed this week</span>
                  <strong className="font-semibold">{stats.reviewed}</strong>
                </li>
                <li className="flex items-center gap-3">
                  <Brain size={17} className="text-lilac" />
                  <span className="flex-1 text-ink-2">Quiz answers right this week</span>
                  <strong className="font-semibold">{stats.quizTotal ? `${Math.round((stats.quizRight / stats.quizTotal) * 100)}%` : '—'}</strong>
                </li>
                <li className="flex items-center gap-3">
                  <Check size={17} className="text-mint" />
                  <span className="flex-1 text-ink-2">Focused this week</span>
                  <strong className="font-semibold">{minutesLabel(stats.minutes)}</strong>
                </li>
              </ul>
            </div>
          </section>
        )}

        {cards && cards.length > 0 && !session && <Deck cards={cards} onDelete={(id) => setCards((all) => (all ?? []).filter((c) => c.id !== id))} />}
      </main>
      <AddCard
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(c) => {
          setCards((all) => [...(all ?? []), c]);
          toast('Added to your deck.', 'good');
        }}
      />
    </div>
  );
}

function Session({
  cards,
  session,
  onRated,
  onDone,
}: {
  cards: Card[];
  session: { queue: string[]; right: number; seen: number };
  onRated: (card: Card, next: Partial<Card>, right: boolean) => void;
  onDone: (right: number, seen: number) => void;
}) {
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const card = cards.find((c) => c.id === session.queue[0]);
  const left = session.queue.length;

  useEffect(() => {
    if (!card) onDone(session.right, session.seen);
  }, [card]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || busy) return;
      if (!shown && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ['1', '2', '3', '4'].includes(e.key)) void rate(RATINGS[Number(e.key) - 1].rating);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!card) return null;

  const rate = async (rating: Rating) => {
    setBusy(true);
    const next = { ...schedule(card, rating), reviewed_at: new Date().toISOString() };
    try {
      await updateCard(card.id, next);
      setShown(false);
      onRated(card, next, rating !== 'again');
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto mt-8 max-w-2xl" aria-label="Reviewing">
      <div className="flex items-center justify-between text-sm font-semibold text-ink-3">
        <span>
          {left} left · {session.seen} done
        </span>
        <button className="hover:text-ink" onClick={() => onDone(session.right, session.seen)}>
          Finish for now
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-2">
        <div className="h-full rounded-full bg-iris transition-[width] duration-500" style={{ width: `${(session.seen / (session.seen + left)) * 100}%` }} />
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={`${card.id}-${session.seen}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease }} className="card mt-6 overflow-hidden">
          <div className="chip-md flex min-h-44 items-center justify-center px-6 py-10 text-center text-xl font-semibold" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.front) }} />
          {shown && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="chip-md border-t border-line bg-paper/50 px-6 py-6 text-center text-[1.05rem]" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.back) }} />
          )}
        </motion.div>
      </AnimatePresence>
      <div className="mt-5">
        {!shown ? (
          <button className="btn btn-primary w-full" onClick={() => setShown(true)}>
            Show the answer
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATINGS.map((r, i) => (
              <button key={r.rating} disabled={busy} onClick={() => void rate(r.rating)} className={`flex flex-col items-center rounded-2xl px-3 py-2.5 font-semibold transition-colors ${r.tone}`} title={`Key ${i + 1}`}>
                {r.label}
                <span className="text-xs font-medium opacity-70">{preview(card, r.rating)}</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-3 text-center text-xs text-ink-4">Space to turn over · 1–4 to answer</p>
      </div>
    </section>
  );
}

function Deck({ cards, onDelete }: { cards: Card[]; onDelete: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const shown = cards.filter((c) => `${c.front} ${c.back}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="mt-10">
      <button className="text-lg font-semibold tracking-[-0.01em]" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Your deck <span className="text-ink-4">({cards.length})</span> <span className="text-sm font-medium text-iris">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <>
          <div className="relative mt-4 max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <input className="field pl-9" placeholder="Search your cards" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {shown.map((c) => {
              const st = stage(c);
              return (
                <li key={c.id} className="card flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c.front}</p>
                    <p className="mt-1 text-sm text-ink-3">{c.back}</p>
                    <p className="mt-2 text-xs font-semibold">
                      <span className={st === 'mastered' ? 'text-mint' : st === 'learning' ? 'text-iris' : 'text-ink-4'}>{st === 'mastered' ? 'Mastered' : st === 'learning' ? 'Learning' : 'New'}</span>
                      <span className="text-ink-4"> · next {new Date(c.due_at) <= new Date() ? 'now' : new Date(c.due_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                    </p>
                  </div>
                  <button
                    className="icon-btn h-8 w-8 hover:text-rose"
                    aria-label="Delete card"
                    onClick={async () => {
                      try {
                        await deleteCard(c.id);
                        onDelete(c.id);
                      } catch (e) {
                        toast((e as Error).message, 'warn');
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function AddCard({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (c: Card) => void }) {
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Add a card" width={480}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!front.trim() || !back.trim()) return;
          setBusy(true);
          try {
            const [c] = await addCards([{ front: front.trim(), back: back.trim() }], null, 'me');
            onAdded(c);
            setFront('');
            setBack('');
            onClose();
          } catch (err) {
            toast((err as Error).message, 'warn');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="label" htmlFor="c-front">
          Front: a question or a term
        </label>
        <input id="c-front" className="field" value={front} onChange={(e) => setFront(e.target.value)} placeholder="e.g. What is an SN2 reaction?" />
        <label className="label mt-4" htmlFor="c-back">
          Back: the answer
        </label>
        <textarea id="c-back" className="field min-h-24" value={back} onChange={(e) => setBack(e.target.value)} placeholder="e.g. One step: the nucleophile attacks as the leaving group leaves." />
        <p className="mt-2 text-xs text-ink-3">Math works too: $x^2$.</p>
        <div className="mt-4 flex justify-end">
          <button className="btn btn-primary btn-sm" disabled={busy || !front.trim() || !back.trim()}>
            {busy ? <Spinner /> : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
