import { describe, expect, it } from 'vitest';
import { dayLabel, dueAtFrom, dueLabel, greeting, minutesLabel, toDay } from '../../src/lib/dates.ts';

const now = new Date(2026, 9, 28, 10, 0); // 28 Oct 2026, 10:00 local

describe('dates', () => {
  it('due labels by how close they are', () => {
    expect(dueLabel(null, now)).toEqual({ text: 'No due date', tone: 'none' });
    expect(dueLabel(new Date(2026, 9, 28, 23, 59).toISOString(), now).tone).toBe('urgent');
    expect(dueLabel(new Date(2026, 9, 29, 9, 0).toISOString(), now).text).toMatch(/^Due tomorrow at/);
    expect(dueLabel(new Date(2026, 9, 31, 12).toISOString(), now)).toEqual({ text: 'Due in 3 days', tone: 'soon' });
    expect(dueLabel(new Date(2026, 10, 3, 12).toISOString(), now)).toEqual({ text: 'Due in 6 days', tone: 'calm' });
    expect(dueLabel(new Date(2026, 9, 26, 12).toISOString(), now)).toEqual({ text: '2 days late', tone: 'late' });
    expect(dueLabel(new Date(2026, 9, 28, 8).toISOString(), now)).toEqual({ text: 'Due earlier today', tone: 'late' });
  });
  it('task days', () => {
    expect(dayLabel('2026-10-28', now)).toEqual({ text: 'Today', tone: 'urgent' });
    expect(dayLabel('2026-10-29', now)).toEqual({ text: 'Tomorrow', tone: 'soon' });
    expect(dayLabel('2026-10-27', now)).toEqual({ text: 'Yesterday', tone: 'late' });
    expect(dayLabel(null, now).text).toBe('');
  });
  it('a due date from the form is that local time', () => {
    const iso = dueAtFrom('2026-11-15', '17:30')!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 15, 17, 30]);
    expect(dueAtFrom('', '10:00')).toBeNull();
    expect(new Date(dueAtFrom('2026-11-15', '')!).getHours()).toBe(23);
  });
  it('small things', () => {
    expect(toDay(now)).toBe('2026-10-28');
    expect(greeting(now)).toBe('Good morning');
    expect(greeting(new Date(2026, 9, 28, 20))).toBe('Good evening');
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(125)).toBe('2h 5m');
    expect(minutesLabel(120)).toBe('2h');
  });
});
