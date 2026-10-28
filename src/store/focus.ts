import { create } from 'zustand';
import { addFocus } from '../lib/api.ts';
import { chime } from '../lib/sound.ts';
import { toast } from './toast.ts';

/** The focus timer (pomodoro): focus, a short break, and after a few rounds a longer one. It runs
 * on clock time, so it's right after a reload or a sleeping laptop, and finished focus time is
 * kept on the assignment it was for. */

export type Phase = 'focus' | 'break' | 'long';
export interface Plan {
  focus: number;
  short: number;
  long: number;
  every: number;
}

export const PLANS: { name: string; plan: Plan }[] = [
  { name: '25 / 5', plan: { focus: 25, short: 5, long: 15, every: 4 } },
  { name: '50 / 10', plan: { focus: 50, short: 10, long: 20, every: 3 } },
  { name: '90 / 20', plan: { focus: 90, short: 20, long: 30, every: 2 } },
];

interface FocusState {
  plan: Plan;
  phase: Phase;
  running: boolean;
  /** When the phase ends (ms), while running. */
  endsAt: number | null;
  /** What's left (ms), while paused. */
  left: number;
  /** When this focus phase began, and the focus time already done in it before a pause. */
  since: number | null;
  done: number;
  round: number;
  assignmentId: string | null;
  /** Bumps when a session is kept, so focus totals can reload. */
  kept: number;
  start: (assignmentId?: string | null) => void;
  pause: () => void;
  stop: () => void;
  skip: () => void;
  setPlan: (plan: Plan) => void;
  tick: (now?: number) => void;
}

const KEY = 'chip-study-focus';
const minutes = (phase: Phase, plan: Plan) => (phase === 'focus' ? plan.focus : phase === 'break' ? plan.short : plan.long);

type Saved = Pick<FocusState, 'plan' | 'phase' | 'running' | 'endsAt' | 'left' | 'since' | 'done' | 'round' | 'assignmentId'>;

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
  } catch {
    return {};
  }
}

function persist(s: Saved) {
  try {
    const { plan, phase, running, endsAt, left, since, done, round, assignmentId } = s;
    localStorage.setItem(KEY, JSON.stringify({ plan, phase, running, endsAt, left, since, done, round, assignmentId }));
  } catch {
    // Private browsing: the timer lasts for this visit.
  }
}

/** Keeps [ms] of focus on its assignment (a minute or more). */
async function keep(ms: number, assignmentId: string | null, startedAt: number) {
  const mins = Math.min(240, Math.floor(ms / 60000));
  if (mins < 1) return;
  try {
    await addFocus(mins, assignmentId, new Date(startedAt));
    useFocus.setState((s) => ({ kept: s.kept + 1 }));
  } catch {
    toast('Couldn’t save that focus time. Check your connection.', 'warn');
  }
}

const initialPlan = PLANS[0].plan;

export const useFocus = create<FocusState>((set, get) => {
  const saved = load();
  const update = (patch: Partial<FocusState>) => {
    set(patch);
    persist(get());
  };
  return {
    plan: initialPlan,
    phase: 'focus',
    running: false,
    endsAt: null,
    left: initialPlan.focus * 60000,
    since: null,
    done: 0,
    round: 0,
    assignmentId: null,
    kept: 0,
    ...saved,

    start: (assignmentId) => {
      const s = get();
      if (s.running) return;
      const now = Date.now();
      update({
        running: true,
        endsAt: now + s.left,
        since: s.phase === 'focus' ? now : null,
        assignmentId: assignmentId === undefined ? s.assignmentId : assignmentId,
      });
    },

    pause: () => {
      const s = get();
      if (!s.running || s.endsAt === null) return;
      const now = Date.now();
      update({
        running: false,
        left: Math.max(0, s.endsAt - now),
        endsAt: null,
        done: s.phase === 'focus' && s.since ? s.done + (now - s.since) : s.done,
        since: null,
      });
    },

    stop: () => {
      const s = get();
      const now = Date.now();
      if (s.phase === 'focus') {
        const ms = s.done + (s.running && s.since ? now - s.since : 0);
        void keep(ms, s.assignmentId, now - ms);
      }
      update({ running: false, phase: 'focus', endsAt: null, left: s.plan.focus * 60000, since: null, done: 0 });
    },

    skip: () => {
      const s = get();
      if (s.phase === 'focus') {
        get().stop();
        const round = get().round + 1;
        const phase: Phase = round % s.plan.every === 0 ? 'long' : 'break';
        update({ phase, round, left: minutes(phase, s.plan) * 60000 });
      } else {
        update({ running: false, phase: 'focus', endsAt: null, left: s.plan.focus * 60000, since: null, done: 0 });
      }
    },

    setPlan: (plan) => {
      const s = get();
      update({ plan, ...(s.running ? {} : { left: minutes(s.phase, plan) * 60000 }) });
    },

    tick: (now = Date.now()) => {
      const s = get();
      if (!s.running || s.endsAt === null || now < s.endsAt) return;
      chime();
      if (s.phase === 'focus') {
        const ms = s.done + (s.since ? s.endsAt - s.since : 0);
        void keep(ms, s.assignmentId, s.endsAt - ms);
        const round = s.round + 1;
        const phase: Phase = round % s.plan.every === 0 ? 'long' : 'break';
        // The break starts on its own.
        update({ phase, round, running: true, endsAt: s.endsAt + minutes(phase, s.plan) * 60000, left: minutes(phase, s.plan) * 60000, since: null, done: 0 });
        toast(`Focus done. ${phase === 'long' ? 'A longer break' : 'A short break'} now.`, 'good');
        // A laptop that slept through the break: catch up.
        if (now >= s.endsAt + minutes(phase, s.plan) * 60000) get().tick(now);
      } else {
        update({ phase: 'focus', running: false, endsAt: null, left: s.plan.focus * 60000, since: null, done: 0 });
        toast('Break’s over. Ready when you are.', 'info');
      }
    },
  };
});

/** What's left of the phase now (ms). */
export function remaining(s: Pick<FocusState, 'running' | 'endsAt' | 'left'>, now = Date.now()): number {
  return s.running && s.endsAt !== null ? Math.max(0, s.endsAt - now) : s.left;
}

export function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
