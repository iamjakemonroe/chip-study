/** Dates the calm way: "Due in 3 days", "Due tomorrow at 9:00 AM", "2 days late". */

const DAY = 86_400_000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from [from] to [to] (negative when [to] has passed). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

export type DueTone = 'calm' | 'soon' | 'urgent' | 'late' | 'none';

export function dueLabel(dueAt: string | null, now = new Date()): { text: string; tone: DueTone } {
  if (!dueAt) return { text: 'No due date', tone: 'none' };
  const due = new Date(dueAt);
  const days = daysBetween(now, due);
  const time = due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (due.getTime() < now.getTime()) {
    const late = Math.max(daysBetween(due, now), 0);
    return { text: late === 0 ? 'Due earlier today' : late === 1 ? '1 day late' : `${late} days late`, tone: 'late' };
  }
  if (days === 0) return { text: `Due today at ${time}`, tone: 'urgent' };
  if (days === 1) return { text: `Due tomorrow at ${time}`, tone: 'urgent' };
  if (days <= 7) return { text: `Due in ${days} days`, tone: days <= 3 ? 'soon' : 'calm' };
  return { text: `Due ${due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`, tone: 'calm' };
}

/** "Due 15 Nov" style for a task's date (YYYY-MM-DD, a local day). */
export function dayLabel(day: string | null, now = new Date()): { text: string; tone: DueTone } {
  if (!day) return { text: '', tone: 'none' };
  const d = fromDay(day);
  const days = daysBetween(now, d);
  if (days < 0) return { text: days === -1 ? 'Yesterday' : `${-days} days ago`, tone: 'late' };
  if (days === 0) return { text: 'Today', tone: 'urgent' };
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' };
  if (days < 7) return { text: d.toLocaleDateString(undefined, { weekday: 'short' }), tone: 'calm' };
  return { text: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), tone: 'calm' };
}

export function toDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** A due date from the form's day and time (local), as an instant. */
export function dueAtFrom(day: string, time: string): string | null {
  if (!day) return null;
  const [h, m] = (time || '23:59').split(':').map(Number);
  const d = fromDay(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.toISOString();
}

export function minutesLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function ago(iso: string, now = new Date()): string {
  const s = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < DAY / 1000) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
