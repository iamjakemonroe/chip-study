// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { due, preview, schedule, stage, streak, type CardState } from '../../src/lib/review.ts';

const now = new Date('2026-10-28T09:00:00Z');
const fresh: CardState = { ease: 2.5, interval_days: 0, reps: 0, lapses: 0 };
const days = (iso: string) => Math.round((Date.parse(iso) - now.getTime()) / 86_400_000);

describe('spaced review', () => {
  it('a new card known: back tomorrow, then in 3 days, then further and further', () => {
    const a = schedule(fresh, 'good', now);
    expect([a.interval_days, a.reps, days(a.due_at)]).toEqual([1, 1, 1]);
    const b = schedule(a, 'good', now);
    expect(b.interval_days).toBe(3);
    const c = schedule(b, 'good', now);
    expect(c.interval_days).toBe(8);
    const d = schedule(c, 'good', now);
    expect(d.interval_days).toBe(20);
    expect(d.ease).toBe(2.5);
  });
  it('forgotten: back in ten minutes, from the start, a little harder from now on', () => {
    const known = schedule(schedule(fresh, 'good', now), 'good', now);
    const lost = schedule(known, 'again', now);
    expect(lost.reps).toBe(0);
    expect(lost.lapses).toBe(1);
    expect(lost.ease).toBe(2.3);
    expect(Date.parse(lost.due_at) - now.getTime()).toBe(10 * 60_000);
    expect(schedule(fresh, 'again', now).lapses).toBe(0);
  });
  it('hard grows the gap a little and lowers the ease; easy grows it a lot', () => {
    const card: CardState = { ease: 2.5, interval_days: 10, reps: 3, lapses: 0 };
    expect(schedule(card, 'hard', now)).toMatchObject({ interval_days: 12, ease: 2.35 });
    expect(schedule(card, 'easy', now)).toMatchObject({ interval_days: 33, ease: 2.65 });
    expect(schedule(fresh, 'easy', now).interval_days).toBe(3);
  });
  it('ease stays between 1.3 and 3.5, and the gap under ten years', () => {
    let c: CardState = fresh;
    for (let i = 0; i < 20; i++) c = schedule(c, 'again', now);
    expect(c.ease).toBe(1.3);
    c = { ease: 3.5, interval_days: 3000, reps: 9, lapses: 0 };
    expect(schedule(c, 'easy', now)).toMatchObject({ ease: 3.5, interval_days: 3650 });
  });
  it('shows when each answer brings it back', () => {
    expect(preview(fresh, 'again', now)).toBe('10 min');
    expect(preview(fresh, 'good', now)).toBe('1 day');
    expect(preview({ ease: 2.5, interval_days: 30, reps: 4, lapses: 0 }, 'good', now)).toBe('3 mo');
  });
  it('stages, and what is due first', () => {
    expect(stage(fresh)).toBe('new');
    expect(stage({ ...fresh, reps: 2, interval_days: 3 })).toBe('learning');
    expect(stage({ ...fresh, reps: 5, interval_days: 40 })).toBe('mastered');
    const cards = [{ id: 'a', due_at: '2026-10-29T00:00:00Z' }, { id: 'b', due_at: '2026-10-27T00:00:00Z' }, { id: 'c', due_at: '2026-10-28T08:00:00Z' }];
    expect(due(cards, now).map((c) => c.id)).toEqual(['b', 'c']);
  });
  it('the streak counts days in a row, and today can still be studied', () => {
    const d = (n: number) => new Date(2026, 9, 28 - n, 15);
    const today = new Date(2026, 9, 28, 20);
    expect(streak([d(0), d(1), d(2), d(4)], today)).toBe(3);
    expect(streak([d(1), d(2)], today)).toBe(2);
    expect(streak([d(2)], today)).toBe(0);
    expect(streak([], today)).toBe(0);
  });
});
