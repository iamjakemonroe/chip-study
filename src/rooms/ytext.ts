import * as Y from 'yjs';
import { textEdit } from '../lib/textEdit.ts';

/** Short shared texts (a note's body, a task's title) as Y.Text, changed by the edit someone made
 * rather than by writing the whole text back, so two people changing the same note at once both
 * keep their words. */

/** Applies the edit from [from] to [to] onto [text], which others may have changed since [from]
 * was read: at the same place if the words before it are unchanged, else just after those words.
 * Words someone else changed meanwhile are never deleted: if what was removed isn't there any
 * more as it was, only the new words go in. */
export function applyTextEdit(text: Y.Text, from: string, to: string): void {
  if (from === to) return;
  const { at, removed, added } = textEdit(from, to);
  const now = text.toString();
  let where = at;
  if (now.slice(0, at) !== from.slice(0, at)) where = locate(now, from, at, removed.length);
  // What was removed must still be there as it was, words after it included (else someone has
  // changed it meanwhile, and it stays).
  const after = from.slice(at + removed.length, at + removed.length + 12);
  const end = where + removed.length;
  const intact = now.slice(where, end) === removed && now.slice(end, end + after.length) === after && (after.length > 0 || end === now.length);
  const run = () => {
    if (removed && intact) text.delete(where, removed.length);
    if (added) text.insert(where, added);
  };
  if (text.doc) text.doc.transact(run);
  else run();
}

/** The nearest place in [text] to [near] where [needle] ends (or starts, with [atStart]), or -1. */
function nearest(text: string, needle: string, near: number, atStart: boolean): number {
  let best = -1;
  for (let i = text.indexOf(needle); needle && i >= 0; i = text.indexOf(needle, i + 1)) {
    const p = atStart ? i : i + needle.length;
    if (best < 0 || Math.abs(p - near) < Math.abs(best - near)) best = p;
  }
  return best;
}

/** Where an edit made at [at] in [from] goes in [now], which has changed before it: just after the
 * words that came before it, or else just before the words that came after it (shorter and shorter
 * pieces of them, so a small change nearby doesn't lose the place). */
function locate(now: string, from: string, at: number, removedLength: number): number {
  for (const n of [24, 12, 6, 4]) {
    const before = from.slice(Math.max(0, at - n), at);
    const p = before.length >= Math.min(n, 4) ? nearest(now, before, at, false) : -1;
    if (p >= 0) return p;
  }
  for (const n of [24, 12, 6, 4]) {
    const after = from.slice(at + removedLength, at + removedLength + n);
    const p = after.length >= Math.min(n, 4) ? nearest(now, after, at, true) : -1;
    if (p >= 0) return Math.max(0, p - removedLength);
  }
  return Math.min(at, now.length);
}

/** [entry]'s [field] as Y.Text, made into one in place if it was a plain string (a room filled by
 * an older screen). */
export function textField(entry: Y.Map<unknown>, field: string): Y.Text {
  const v = entry.get(field);
  if (v instanceof Y.Text) return v;
  const t = new Y.Text();
  t.insert(0, typeof v === 'string' ? v : '');
  entry.set(field, t);
  return t;
}

/** A shared text, made from [value]. */
export function sharedText(value: string): Y.Text {
  const t = new Y.Text();
  if (value) t.insert(0, value);
  return t;
}
