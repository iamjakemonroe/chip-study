import type { Me, ModelKind } from './types.ts';

/** What's left of Chip's time on one model: a share of the day (0 to 1, for the ring), about how
 * many messages that is at what this student's messages usually cost, and when it comes back. */
export interface ChipTime {
  kind: ModelKind;
  share: number;
  messages: number;
  /** Pro's best model: what limits it now, the day or the month. */
  by: 'day' | 'period';
  resetsAt: Date;
}

const left = (cap: number, used: number) => Math.max(0, cap - used);

export function chipTime(me: Me, kind: ModelKind): ChipTime | null {
  const resetsAt = new Date(me.resets_at);
  if (kind === 'fast') {
    const { cap, used, avg } = me.fast;
    const rest = left(cap, used);
    return { kind, share: cap > 0 ? rest / cap : 0, messages: count(rest, avg), by: 'day', resetsAt };
  }
  const best = me.best;
  if (!best || me.tier !== 'pro') return null;
  const day = left(best.cap, best.used);
  const period = left(best.period_cap, best.period_used);
  const by = period < day ? 'period' : 'day';
  const rest = Math.min(day, period);
  return { kind, share: best.cap > 0 ? Math.min(1, rest / best.cap) : 0, messages: count(rest, best.avg), by, resetsAt };
}

/** Messages left at [avg] each. A sliver of the allowance still lets one through (the server
 * holds before a call and settles after), so anything above nothing is at least one. */
function count(rest: number, avg: number): number {
  if (rest <= 0) return 0;
  const each = avg > 0 ? avg : 0.001;
  return Math.max(1, Math.floor(rest / each + 1e-9));
}

/** "About 24 messages left today", "Plenty left today", "1 message left today", or when it's
 * back. */
export function describe(t: ChipTime, now = new Date()): string {
  if (t.messages <= 0) return `Back ${when(t.resetsAt, now)}`;
  const span = t.by === 'period' ? 'this month' : 'today';
  if (t.messages > 99) return `Plenty left ${span}`;
  if (t.messages === 1) return `1 message left ${span}`;
  return `About ${t.messages} messages left ${span}`;
}

/** "at 1:00 AM" when it's within a day, otherwise the weekday. */
export function when(at: Date, now = new Date()): string {
  const hours = (at.getTime() - now.getTime()) / 3_600_000;
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (hours <= 24) return `at ${time}`;
  return `${at.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`;
}

/** The model a message goes to: the best one when the student picked it and has it, or Fast. */
export function modelFor(me: Me | null, wanted: ModelKind): ModelKind {
  if (wanted === 'fast' || !me || me.tier !== 'pro') return 'fast';
  const best = chipTime(me, 'best');
  return best && best.messages > 0 ? 'best' : 'fast';
}
