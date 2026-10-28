/** Spaced review: each flashcard comes back after a gap that grows while the student remembers
 * it and shrinks when they don't (SM-2, with four answers). And the numbers for the progress
 * view: what's due, what's being learned, what's mastered, and the study streak. */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface CardState {
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
}

export interface Scheduled extends CardState {
  due_at: string;
}

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function schedule(card: CardState, rating: Rating, now = new Date()): Scheduled {
  let { ease, interval_days: interval, reps, lapses } = card;
  if (rating === 'again') {
    if (reps > 0) lapses += 1;
    reps = 0;
    ease = Math.max(1.3, ease - 0.2);
    // Again in ten minutes, in this sitting.
    return { ease: round2(ease), interval_days: 0, reps, lapses, due_at: new Date(now.getTime() + 10 * 60_000).toISOString() };
  }
  if (rating === 'hard') {
    interval = reps === 0 ? 1 : Math.max(interval + 1, Math.round(interval * 1.2));
    ease = Math.max(1.3, ease - 0.15);
  } else if (rating === 'good') {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(interval + 1, Math.round(interval * ease));
  } else {
    interval = reps === 0 ? 3 : reps === 1 ? 6 : Math.max(interval + 2, Math.round(interval * ease * 1.3));
    ease = Math.min(3.5, ease + 0.15);
  }
  interval = Math.min(3650, interval);
  return { ease: round2(ease), interval_days: interval, reps: reps + 1, lapses, due_at: new Date(now.getTime() + interval * DAY).toISOString() };
}

/** When each answer would bring the card back ("10 min", "1 day", "3 days", "2 mo"). */
export function preview(card: CardState, rating: Rating, now = new Date()): string {
  const next = schedule(card, rating, now);
  const ms = Date.parse(next.due_at) - now.getTime();
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  const days = Math.round(ms / DAY);
  if (days < 31) return days === 1 ? '1 day' : `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${Math.round(days / 365)} yr`;
}

export type Stage = 'new' | 'learning' | 'mastered';

export function stage(card: CardState): Stage {
  if (card.reps === 0 && card.interval_days === 0) return 'new';
  return card.interval_days >= 21 ? 'mastered' : 'learning';
}

export function due<T extends { due_at: string }>(cards: T[], now = new Date()): T[] {
  return cards.filter((c) => Date.parse(c.due_at) <= now.getTime()).sort((a, b) => a.due_at.localeCompare(b.due_at));
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Days in a row the student studied (any of [days]), up to today; today not yet studied doesn't
 * break it. */
export function streak(days: Date[], now = new Date()): number {
  const studied = new Set(days.map(dayKey));
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!studied.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (studied.has(dayKey(d))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
