/** The difference between two versions of a short text, as one edit, and where a caret moves
 * when the text changes under it. No Yjs here: the workspace uses it too. */

/** The edit that turns [from] into [to]: where, what went, what came. */
export function textEdit(from: string, to: string): { at: number; removed: string; added: string } {
  let p = 0;
  while (p < from.length && p < to.length && from[p] === to[p]) p++;
  let q = 0;
  while (q < from.length - p && q < to.length - p && from[from.length - 1 - q] === to[to.length - 1 - q]) q++;
  return { at: p, removed: from.slice(p, from.length - q), added: to.slice(p, to.length - q) };
}

/** Where index [i] in [before] is in [after] (a caret kept in place when someone else edits). */
export function mapIndex(before: string, after: string, i: number): number {
  const { at, removed, added } = textEdit(before, after);
  if (i <= at) return i;
  if (i >= at + removed.length) return i + added.length - removed.length;
  return at + added.length;
}
