import { Node as PMNode, type Schema } from '@tiptap/pm/model';
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { YDOC } from '../../shared/rooms.ts';
import type { RoomWorkspace } from './api.ts';
import { fillSheet, type Grid } from './ysheet.ts';
import { sharedText } from './ytext.ts';

/** Filling an empty room with the host's work (docs/rooms.md, "Seeding"): every shared type in one
 * Yjs transaction, with `room.seeded = true` in the same one, so the room either has all of it or
 * none of it, and the server never saves an empty room over the host's work. */

export const isSeeded = (doc: Y.Doc): boolean => doc.getMap(YDOC.room).get('seeded') === true;

const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] };
const blank = (rows: number, cols: number): Grid => Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));

const entry = (fields: Record<string, unknown>): Y.Map<unknown> => {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) m.set(k, v);
  return m;
};

/** A document's ProseMirror node, or null when it doesn't fit the editor's schema. A document
 * that can't be read is left out of the room rather than filled empty: the room would otherwise
 * save the empty one over it as soon as anyone typed. */
function proseMirror(schema: Schema, content: Record<string, unknown> | null): PMNode | null {
  const json = content && (content as { type?: string }).type === 'doc' ? content : EMPTY;
  try {
    const node = PMNode.fromJSON(schema, json);
    node.check();
    return node;
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Fills [doc] with [w] in one transaction (with [origin]). Answers false, changing nothing, when the
 * room is already filled: someone asked earlier may have finished meanwhile. */
export function seedRoom(doc: Y.Doc, w: RoomWorkspace, schema: Schema, origin: unknown = null): boolean {
  if (isSeeded(doc)) return false;
  let filled = false;
  doc.transact(() => {
    if (isSeeded(doc)) return;
    const documents = doc.getMap(YDOC.documents);
    for (const d of [...w.documents].sort((a, b) => a.sort - b.sort)) {
      const content = (d.content ?? {}) as Record<string, unknown>;
      if (d.kind === 'doc') {
        const node = proseMirror(schema, content);
        if (!node) {
          console.warn('room seed: left out a document that doesn’t fit the editor', d.id);
          continue;
        }
        documents.set(d.id, entry({ kind: 'doc', title: d.title, sort: d.sort }));
        prosemirrorToYXmlFragment(node, doc.getXmlFragment(YDOC.doc(d.id)));
      } else if (d.kind === 'code') {
        documents.set(d.id, entry({ kind: 'code', title: d.title, sort: d.sort, lang: str(content.lang) || undefined, stdin: str(content.stdin) || undefined }));
        const code = str(content.code);
        if (code) doc.getText(YDOC.code(d.id)).insert(0, code);
      } else if (d.kind === 'sheet') {
        const rows = Array.isArray(content.rows) && content.rows.length ? (content.rows as unknown[][]).map((r) => (Array.isArray(r) ? r.map(str) : [])) : blank(8, 5);
        documents.set(d.id, entry({ kind: 'sheet', title: d.title, sort: d.sort, header: typeof content.header === 'boolean' ? content.header : true }));
        fillSheet(doc.getArray(YDOC.sheet(d.id)), rows);
      }
    }
    const notes = doc.getArray<Y.Map<unknown>>(YDOC.notes);
    // Notes' bodies and tasks' titles are shared texts, so two people's edits merge.
    if (w.notes.length) notes.push(w.notes.map((n) => entry({ id: n.id, body: sharedText(n.body ?? ''), pinned: !!n.pinned })));
    const tasks = doc.getArray<Y.Map<unknown>>(YDOC.tasks);
    if (w.tasks.length) tasks.push(w.tasks.map((t) => entry({ id: t.id, title: sharedText(t.title ?? ''), due_on: t.due_on ?? null, done: !!t.done })));
    doc.getMap(YDOC.room).set('seeded', true);
    filled = true;
  }, origin);
  return filled;
}
