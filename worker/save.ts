/** Saving the room: which rows changed since the last save, in batches the study-rooms function
 * takes (at most 500 rows of each, and a body well under its 8 MB). */
import { fingerprint, type SavePayload, type SavedDocument, type SavedNote, type SavedTask } from './ydoc.ts';

export interface SaveBatch {
  documents?: SavedDocument[];
  notes?: SavedNote[];
  tasks?: SavedTask[];
}

export interface Batch {
  body: SaveBatch;
  /** What to remember as saved once this batch is in. */
  prints: [key: string, print: string][];
}

export const MAX_ROWS = 500;
/** A batch's documents stop at about this many bytes of JSON. */
const MAX_BATCH_BYTES = 4_000_000;
/** One document bigger than this couldn't go through the function (8 MB a body): it's held back. */
const MAX_DOC_BYTES = 7_500_000;
const enc = new TextEncoder();
const bytes = (v: unknown): number => enc.encode(JSON.stringify(v)).length;

/** Every row's fingerprint: `doc:<id>` for each document, `notes` and `tasks` for those lists. */
export function prints(p: SavePayload): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of p.documents) out.set(`doc:${d.id}`, fingerprint(JSON.stringify(d)));
  out.set('notes', fingerprint(JSON.stringify(p.notes)));
  out.set('tasks', fingerprint(JSON.stringify(p.tasks)));
  return out;
}

/** The batches to send: only documents that changed, and notes or tasks only when they changed
 * (sending them replaces the assignment's, so they're never sent when unchanged). Documents are
 * only ever added or updated by id, so they can go in several batches. A list longer than the
 * function takes is held back rather than cut short, which would delete the rest. */
export function changedBatches(p: SavePayload, saved: (key: string) => string | null): Batch[] {
  const all = prints(p);
  const changed = (key: string) => saved(key) !== all.get(key);
  const batches: Batch[] = [];
  let current: Batch = { body: {}, prints: [] };
  let size = 0;
  for (const list of ['notes', 'tasks'] as const) {
    if (!changed(list)) continue;
    if (p[list].length > MAX_ROWS) {
      console.warn(`room save: ${p[list].length} ${list} is more than ${MAX_ROWS}; not saved`);
      continue;
    }
    (current.body as Record<string, unknown>)[list] = p[list];
    current.prints.push([list, all.get(list)!]);
    size += bytes(p[list]);
  }
  for (const d of p.documents) {
    const key = `doc:${d.id}`;
    if (!changed(key)) continue;
    const docBytes = bytes(d);
    if (docBytes > MAX_DOC_BYTES) {
      console.warn(`room save: document ${d.id} is ${docBytes} bytes, more than a save takes; not saved`);
      continue;
    }
    const docs = current.body.documents ?? [];
    if (docs.length && (docs.length >= MAX_ROWS || size + docBytes > MAX_BATCH_BYTES)) {
      batches.push(current);
      current = { body: {}, prints: [] };
      size = 0;
    }
    (current.body.documents ??= []).push(d);
    current.prints.push([key, all.get(key)!]);
    size += docBytes;
  }
  if (current.prints.length) batches.push(current);
  return batches;
}
