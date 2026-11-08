import type { Person, Role } from '../../shared/rooms.ts';

/** How people look in a room: a colour each (the same on every screen, from their user ID), their
 * initials, and how their role reads. */

/** Six-digit hex colours only: TipTap's caret refuses anything else. */
const PALETTE = ['#6457f0', '#2f95d6', '#1f9a7d', '#e07b3c', '#d9486f', '#b08a2e', '#8a5ce0', '#3c8f9e'];

export function colorFor(userId: string): string {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) h = Math.imul(h ^ userId.charCodeAt(i), 16777619);
  return PALETTE[(h >>> 0) % PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function roleName(role: Role): string {
  return role === 'host' ? 'Host' : role === 'cohost' ? 'Co-host' : '';
}

export const isManager = (role: Role | undefined): boolean => role === 'host' || role === 'cohost';

/** People in the order a room shows them: you first, then hosts, then everyone else by name. */
export function ordered(people: Person[], me: string | undefined): Person[] {
  const rank = (p: Person) => (p.userId === me ? 0 : p.role === 'host' ? 1 : p.role === 'cohost' ? 2 : 3);
  return [...people].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
