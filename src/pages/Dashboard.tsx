import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Archive, ArrowRight, CheckCircle2, Circle, Clock, Flame, GraduationCap, Layers, MoreHorizontal, Pause, Play, Plus, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FocusTip, focusTipSeen } from '../components/FocusTip.tsx';
import { NewAssignment } from '../components/NewAssignment.tsx';
import { Orb } from '../components/Orb.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { Confirm, Menu, MenuItem, Ring } from '../components/ui.tsx';
import { chipTime, describe } from '../lib/allowance.ts';
import { deleteAssignment, listAssignments, listDueCards, listFocusSince, listPracticeSince, listTasks, updateAssignment, updateTask } from '../lib/api.ts';
import { COLORS, TONE_STYLES } from '../lib/colors.ts';
import { ago, dayLabel, dueLabel, fromDay, greeting, minutesLabel, startOfDay, toDay } from '../lib/dates.ts';
import { streak } from '../lib/review.ts';
import type { Assignment, FocusSession, Practice, Task } from '../lib/types.ts';
import { useAuth } from '../store/auth.ts';
import { clock, PLANS, remaining, useFocus } from '../store/focus.ts';
import { toast } from '../store/toast.ts';

const ease = [0.2, 0.7, 0.1, 1] as const;

/** The desk: a calm hello, today's focus, Chip time, what's next, and every assignment. */
export function Dashboard() {
  const me = useAuth((s) => s.me);
  const reduce = useReducedMotion();
  const kept = useFocus((s) => s.kept);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [focus, setFocus] = useState<FocusSession[]>([]);
  const [practice, setPractice] = useState<Practice[]>([]);
  const [dueCards, setDueCards] = useState(0);
  const [filter, setFilter] = useState<'all' | 'topic' | 'assignment' | 'submitted'>('all');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Assignment | null>(null);
  const [failed, setFailed] = useState(false);

  // The floating New button (phones) shows only once the page's own has scrolled away above.
  const newRef = useRef<HTMLButtonElement>(null);
  const [floatNew, setFloatNew] = useState(false);
  useEffect(() => {
    const el = newRef.current;
    if (!el) return;
    const seen = new IntersectionObserver(([e]) => setFloatNew(!e.isIntersecting && e.boundingClientRect.top < 0));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  const load = useCallback(async () => {
    try {
      const monthAgo = startOfDay(new Date(Date.now() - 30 * 86_400_000));
      const [a, t, f, p, d] = await Promise.all([listAssignments(), listTasks(), listFocusSince(monthAgo), listPracticeSince(monthAgo), listDueCards()]);
      setAssignments(a);
      setTasks(t);
      setFocus(f);
      setPractice(p);
      setDueCards(d.length);
      setFailed(false);
    } catch {
      setFailed(true);
      setAssignments((a) => a ?? []);
    }
  }, []);

  useEffect(() => {
    document.title = 'Your desk · Chip Study';
    void load();
    void useAuth.getState().refresh();
  }, [load]);
  useEffect(() => {
    if (kept) void listFocusSince(startOfDay(new Date(Date.now() - 30 * 86_400_000))).then(setFocus).catch(() => undefined);
  }, [kept]);

  const now = new Date();
  const active = (assignments ?? []).filter((a) => a.status === 'active');
  const shown = (assignments ?? []).filter((a) =>
    filter === 'submitted' ? a.status === 'submitted' : a.status === 'active' && (filter === 'all' || a.kind === filter),
  );
  const nextDue = active.filter((a) => a.kind === 'assignment' && a.due_at && new Date(a.due_at) > now).sort((a, b) => a.due_at!.localeCompare(b.due_at!))[0];
  const days = streak([...focus.map((f) => new Date(f.started_at)), ...practice.map((p) => new Date(p.at))], now);
  const name = me?.name?.split(/\s+/)[0];

  const byAssignment = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const t of tasks) {
      const e = m.get(t.assignment_id) ?? { done: 0, total: 0 };
      e.total += 1;
      if (t.done) e.done += 1;
      m.set(t.assignment_id, e);
    }
    return m;
  }, [tasks]);

  const upNext = useMemo(() => {
    const live = new Set(active.map((a) => a.id));
    return tasks
      .filter((t) => !t.done && live.has(t.assignment_id))
      .sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999'))
      .slice(0, 4);
  }, [tasks, active]);

  const toggle = async (t: Task) => {
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
    try {
      await updateTask(t.id, { done: !t.done });
    } catch (e) {
      setTasks((all) => all.map((x) => (x.id === t.id ? t : x)));
      toast((e as Error).message, 'warn');
    }
  };

  const setStatus = async (a: Assignment, status: Assignment['status']) => {
    try {
      const next = await updateAssignment(a.id, { status });
      setAssignments((all) => (all ?? []).map((x) => (x.id === a.id ? next : x)));
      toast(status === 'submitted' ? 'Marked as handed in. Well done.' : status === 'archived' ? 'Archived.' : 'Back on your desk.', 'good');
    } catch (e) {
      toast((e as Error).message, 'warn');
    }
  };

  const appear = (i: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease, delay: 0.05 * i } };

  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <motion.section {...appear(0)}>
          <p className="text-sm font-medium text-ink-3">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="mt-1 text-[2rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[2.5rem]">
            {greeting(now)}
            {name ? `, ${name}` : ''}.
          </h1>
          <p className="mt-2 max-w-2xl text-[1.0625rem] leading-relaxed text-ink-2">
            {assignments === null
              ? ' '
              : dueCards > 0
                ? `${dueCards} card${dueCards === 1 ? '' : 's'} to review: a few minutes now and ${dueCards === 1 ? 'it sticks' : 'they stick'}.`
                : nextDue
                  ? `${nextDue.title} is ${dueLabel(nextDue.due_at, now).text.replace(/^Due /, 'due ')}. One calm step at a time.`
                  : active.length
                    ? 'What will you learn today?'
                    : 'Start with something you want to learn, or an assignment. Chip will help you through it.'}
          </p>
        </motion.section>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <motion.div {...appear(1)}>
            <ReviewCard due={dueCards} streak={days} />
          </motion.div>
          <motion.div {...appear(2)}>
            <FocusCard sessions={focus} />
          </motion.div>
          <motion.div {...appear(3)}>
            <ChipCard />
          </motion.div>
          <motion.div {...appear(4)} className="card flex flex-col p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-2">Up next</h2>
              <Clock size={16} className="text-ink-4" />
            </div>
            {upNext.length === 0 ? (
              <p className="mt-4 text-sm leading-relaxed text-ink-3">No tasks waiting. Ask Chip to plan an assignment and its steps land here.</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {upNext.map((t) => {
                  const a = active.find((x) => x.id === t.assignment_id);
                  const d = dayLabel(t.due_on, now);
                  return (
                    <li key={t.id} className="flex items-center gap-2.5 rounded-xl py-1.5">
                      <button className="text-ink-4 hover:text-mint" onClick={() => void toggle(t)} aria-label={`Done: ${t.title}`}>
                        {t.done ? <CheckCircle2 size={18} className="text-mint" /> : <Circle size={18} />}
                      </button>
                      <Link to={`/app/a/${t.assignment_id}`} className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.title}</span>
                        {a && <span className="block truncate text-xs text-ink-3">{a.title}</span>}
                      </Link>
                      {d.text && <span className={`chip-tag ${TONE_STYLES[d.tone]}`}>{d.text}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        </div>

        <section className="mt-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-[-0.015em]">Your studies</h2>
            <div className="flex max-w-full flex-wrap items-center gap-2">
              <div className="no-scrollbar flex max-w-full overflow-x-auto rounded-full border border-line bg-white/70 p-0.5 text-sm font-semibold">
                {(['all', 'topic', 'assignment', 'submitted'] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`flex-none rounded-full px-3 py-1 ${filter === f ? 'bg-ink text-white' : 'text-ink-3 hover:text-ink'}`}>
                    {{ all: 'All', topic: 'Learning', assignment: 'Assignments', submitted: 'Handed in' }[f]}
                  </button>
                ))}
              </div>
              <button ref={newRef} className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                <Plus size={16} /> New
              </button>
            </div>
          </div>

          {failed && (
            <p className="mt-4 rounded-2xl bg-peach-soft px-4 py-3 text-sm text-[#9a4a1b]">
              Couldn’t load everything. <button className="font-semibold underline" onClick={() => void load()}>Try again</button>
            </p>
          )}

          {assignments === null ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-44" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="mt-5 flex flex-col items-center rounded-[1.75rem] border border-dashed border-line-2 bg-white/50 px-6 py-14 text-center">
              <Orb size={56} />
              <p className="mt-5 text-lg font-semibold">{filter === 'all' ? 'What do you want to learn?' : 'Nothing here yet'}</p>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-3">
                Add a topic, a course or an exam and Chip will tutor you through it. Or drop in an assignment, and Chip helps you understand it, plan it and write it in your own words.
              </p>
              <button className="btn btn-iris mt-6" onClick={() => setCreating(true)}>
                <Sparkles size={16} /> Start something new
              </button>
            </div>
          ) : (
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((a, i) => {
                const due = dueLabel(a.due_at, now);
                const t = byAssignment.get(a.id);
                const c = COLORS[a.color];
                const wordShare = a.word_target && a.kind === 'assignment' ? Math.min(1, a.words / a.word_target) : null;
                return (
                  <motion.li key={a.id} {...appear(4 + i)} className="group relative">
                    <Link
                      to={`/app/a/${a.id}`}
                      className="card relative flex h-full flex-col overflow-hidden p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]"
                    >
                      <span className="glow-spot absolute -right-16 -top-16 h-44 w-44" style={{ ['--glow' as string]: c.soft }} aria-hidden="true" />
                      <div className="relative flex items-start gap-3 pr-8">
                        <span className="mt-1 h-2.5 w-2.5 flex-none rounded-full" style={{ background: c.ink }} />
                        <div className="min-w-0">
                          <h3 className="line-clamp-2 font-semibold leading-snug tracking-[-0.01em]">{a.title}</h3>
                          {a.course && <p className="mt-0.5 truncate text-sm text-ink-3">{a.course}</p>}
                        </div>
                      </div>
                      <div className="relative mt-4 flex flex-wrap items-center gap-2">
                        {a.kind === 'topic' ? (
                          <span className="chip-tag bg-iris-soft text-iris-2">
                            <GraduationCap size={12} /> {a.due_at ? `Learning · by ${new Date(a.due_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Learning'}
                          </span>
                        ) : a.status === 'submitted' ? (
                          <span className="chip-tag bg-mint-soft text-mint">
                            <CheckCircle2 size={12} /> Handed in
                          </span>
                        ) : (
                          <span className={`chip-tag ${TONE_STYLES[due.tone]}`}>{due.text}</span>
                        )}
                        {a.focus_minutes > 0 && <span className="chip-tag bg-paper-2 text-ink-3">{minutesLabel(a.focus_minutes)} focused</span>}
                      </div>
                      <div className="relative mt-auto pt-5">
                        <div className="flex items-end justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-ink-3">
                              {a.kind === 'topic' ? `${a.words.toLocaleString()} words of notes` : `${a.words.toLocaleString()} ${a.word_target ? `of ${a.word_target.toLocaleString()} ` : ''}words`}
                            </p>
                            {wordShare !== null && (
                              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-2">
                                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${wordShare * 100}%`, background: c.ink }} />
                              </div>
                            )}
                          </div>
                          {t && t.total > 0 && (
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-3" title={`${t.done} of ${t.total} tasks done`}>
                              <Ring value={t.done / t.total} size={26} stroke={3} color={c.ink} />
                              {t.done}/{t.total}
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-xs text-ink-4">Edited {ago(a.updated_at, now)}</p>
                      </div>
                    </Link>
                    <div className="absolute right-3 top-3">
                      <Menu label={`More for ${a.title}`} button={<MoreHorizontal size={18} />}>
                        {(close) => (
                          <>
                            {a.status === 'active' && a.kind === 'assignment' ? (
                              <MenuItem icon={<CheckCircle2 size={15} />} onClick={() => (close(), void setStatus(a, 'submitted'))}>
                                Mark as handed in
                              </MenuItem>
                            ) : a.status === 'active' ? null : (
                              <MenuItem icon={<Undo2 size={15} />} onClick={() => (close(), void setStatus(a, 'active'))}>
                                Back to my desk
                              </MenuItem>
                            )}
                            {a.status !== 'archived' && (
                              <MenuItem icon={<Archive size={15} />} onClick={() => (close(), void setStatus(a, 'archived'))}>
                                Archive
                              </MenuItem>
                            )}
                            <MenuItem icon={<Trash2 size={15} />} danger onClick={() => (close(), setRemoving(a))}>
                              Delete
                            </MenuItem>
                          </>
                        )}
                      </Menu>
                    </div>
                  </motion.li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <NewAssignment open={creating} onClose={() => setCreating(false)} count={assignments?.length ?? 0} />
      <Confirm
        open={!!removing}
        title={removing?.kind === 'topic' ? `Delete “${removing.title}”?` : 'Delete this assignment?'}
        body={
          <>
            <strong className="text-ink">{removing?.title}</strong> and everything in it go for good: documents, notes, sources, tasks, chats with Chip and its AI-use record.
          </>
        }
        yes="Delete"
        danger
        onClose={() => setRemoving(null)}
        onYes={async () => {
          if (!removing) return;
          try {
            await deleteAssignment(removing.id);
            setAssignments((all) => (all ?? []).filter((x) => x.id !== removing.id));
            toast('Deleted.', 'info');
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
      {/* On a phone, once the page's own New button has scrolled away: never over the cards at the top. */}
      <button
        className={`btn btn-iris fixed bottom-5 right-5 z-30 h-14 w-14 rounded-full p-0 transition-[opacity,transform] duration-300 sm:hidden ${
          floatNew ? 'opacity-100' : 'pointer-events-none scale-75 opacity-0'
        }`}
        aria-label="New assignment"
        aria-hidden={!floatNew}
        tabIndex={floatNew ? 0 : -1}
        onClick={() => setCreating(true)}
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Plus size={24} />
      </button>
    </div>
  );
}

/** Cards due for review, and the study streak. */
function ReviewCard({ due, streak: days }: { due: number; streak: number }) {
  return (
    <div className="card relative flex h-full flex-col overflow-hidden p-5">
      <span className="glow-spot absolute -right-16 -top-16 h-48 w-48" style={{ ['--glow' as string]: 'var(--color-lilac-soft)' }} aria-hidden="true" />
      <div className="relative flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-2">Review</h2>
        <span className="chip-tag bg-peach-soft text-[#b25a22]" title="Days in a row you’ve studied">
          <Flame size={12} /> {days} day{days === 1 ? '' : 's'}
        </span>
      </div>
      <p className="relative mt-2 text-3xl font-semibold tracking-[-0.02em] tabular-nums">{due}</p>
      <p className="relative text-sm text-ink-3">{due === 1 ? 'card due now' : 'cards due now'}</p>
      <div className="relative mt-auto pt-4">
        <Link to="/app/review" className={`btn btn-sm ${due ? 'btn-iris' : 'btn-ghost'}`}>
          <Layers size={15} /> {due ? 'Review now' : 'Your deck'}
        </Link>
      </div>
    </div>
  );
}

/** Today's focus, the week's in small bars, and the timer. */
function FocusCard({ sessions }: { sessions: FocusSession[] }) {
  const running = useFocus((s) => s.running);
  const phase = useFocus((s) => s.phase);
  const left = useFocus((s) => s.left);
  const endsAt = useFocus((s) => s.endsAt);
  const plan = useFocus((s) => s.plan);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => toDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + i)));
  const per = new Map<string, number>();
  for (const s of sessions) {
    const key = toDay(new Date(s.started_at));
    per.set(key, (per.get(key) ?? 0) + s.minutes);
  }
  const today = per.get(days[6]) ?? 0;
  const max = Math.max(60, ...days.map((d) => per.get(d) ?? 0));
  const ms = remaining({ running, endsAt, left });
  const [tip, setTip] = useState(false);

  return (
    <div className="card flex h-full flex-col p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-2">Focus today</h2>
        <span className="text-xs font-medium text-ink-3" title={PLANS.find((p) => p.plan.focus === plan.focus)?.name}>
          {plan.focus}-min sessions
        </span>
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.02em] tabular-nums">{minutesLabel(today)}</p>
      <div className="mt-3 flex h-14 items-end gap-1.5" aria-label="Focus time over the last seven days">
        {days.map((d, i) => {
          const m = per.get(d) ?? 0;
          return (
            <div key={d} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div
                className="w-full max-w-7 rounded-md transition-[height] duration-700"
                style={{ height: `${Math.max(4, (m / max) * 34)}px`, background: i === 6 ? 'var(--color-iris)' : m ? '#c9c3ff' : 'var(--color-iris-soft)' }}
                title={minutesLabel(m)}
              />
              <span className={`text-[0.6rem] font-semibold ${i === 6 ? 'text-iris-2' : 'text-ink-4'}`}>{fromDay(d).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4">
        <button
          className={`btn btn-sm ${running ? 'btn-ghost' : 'btn-primary'}`}
          onClick={() => {
            if (running) return useFocus.getState().pause();
            useFocus.getState().start(null);
            if (!focusTipSeen()) setTip(true);
          }}
        >
          {running ? <Pause size={15} /> : <Play size={15} />}
          {running ? 'Pause' : ms < plan.focus * 60000 && phase === 'focus' ? 'Carry on' : 'Start focus'}
        </button>
        <span className="text-sm font-semibold tabular-nums text-ink-3">
          {clock(ms)} {phase !== 'focus' && 'break'}
        </span>
      </div>
      <AnimatePresence>{tip && <FocusTip onClose={() => setTip(false)} />}</AnimatePresence>
    </div>
  );
}

/** Chip time left today, and Pro. */
function ChipCard() {
  const me = useAuth((s) => s.me);
  const fast = me ? chipTime(me, 'fast') : null;
  const best = me ? chipTime(me, 'best') : null;
  const main = best ?? fast;
  return (
    <div className="card relative flex h-full flex-col overflow-hidden p-5">
      <span className="glow-spot absolute -right-16 -top-16 h-48 w-48" style={{ ['--glow' as string]: 'var(--color-iris-soft)' }} aria-hidden="true" />
      <div className="relative flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-2">Chip time</h2>
        <span className={`chip-tag ${me?.tier === 'pro' ? 'bg-iris-soft text-iris-2' : 'bg-paper-2 text-ink-3'}`}>{me?.tier === 'pro' ? 'Pro' : 'Free'}</span>
      </div>
      <div className="relative mt-3 flex items-center gap-4">
        <Ring value={main?.share ?? 0} size={64} stroke={6} color={best ? 'var(--color-iris)' : 'var(--color-sky)'}>
          <Orb size={30} />
        </Ring>
        <div className="min-w-0">
          <p className="font-semibold">{main ? describe(main) : ' '}</p>
          <p className="text-sm text-ink-3">{best ? 'with Chip’s best model' : 'with Chip Fast'}</p>
          {best && fast && <p className="mt-0.5 text-xs text-ink-4">Fast: {describe(fast).toLowerCase()}</p>}
        </div>
      </div>
      <div className="relative mt-auto pt-4">
        {me?.tier === 'pro' ? (
          <Link to="/app/plan" className="text-sm font-semibold text-iris hover:text-iris-2">
            Your plan <ArrowRight size={14} className="inline" />
          </Link>
        ) : (
          <Link to="/app/plan" className="btn btn-ghost btn-sm">
            <Sparkles size={15} className="text-iris" /> Chip’s best model with Pro
          </Link>
        )}
      </div>
    </div>
  );
}
