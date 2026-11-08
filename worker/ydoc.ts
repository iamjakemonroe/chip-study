/** The room's shared Y.Doc, turned back into what the editors save: ProseMirror JSON for
 * documents, {lang, code, stdin?} for code, {rows, header} for sheets, and the notes and tasks.
 *
 * TipTap's collaboration binding (y-prosemirror, as @tiptap/y-tiptap) keeps a document in a
 * Y.XmlFragment: every node is a Y.XmlElement named after the node with its non-null attributes,
 * and runs of text are Y.XmlText whose delta attributes are the marks (mark name → mark attrs).
 * Marks that may overlap themselves get a `--<hash>` suffix, which is taken off here. This is a
 * small converter of our own rather than the binding itself, whose editor imports a Worker
 * doesn't want. */
import * as Y from 'yjs';
import { YDOC } from '../shared/rooms.ts';
import { countWords } from '../src/lib/autosave.ts';
import { evaluate, toCsv, type Grid } from '../src/lib/sheet.ts';

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
}

export type DocKind = 'doc' | 'code' | 'sheet';

export interface SavedDocument {
  id: string;
  kind: DocKind;
  title: string;
  sort: number;
  content: Record<string, unknown>;
  text: string;
  words: number;
}

export interface SavedNote {
  id: string;
  body: string;
  pinned: boolean;
}

export interface SavedTask {
  id: string;
  title: string;
  due_on: string | null;
  done: boolean;
}

export interface SavePayload {
  documents: SavedDocument[];
  notes: SavedNote[];
  tasks: SavedTask[];
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day as YYYY-MM-DD (the database casts it to a date; a bad one would fail the save). */
const isDay = (s: string): boolean => DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const KINDS = new Set<DocKind>(['doc', 'code', 'sheet']);

/** y-prosemirror's suffix on marks that can overlap themselves: `--` and eight base64 characters. */
const HASHED_MARK = /(.*)(--[a-zA-Z0-9+/=]{8})$/;

export const markName = (attribute: string): string => HASHED_MARK.exec(attribute)?.[1] ?? attribute;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);

// ── Documents: Y.XmlFragment → ProseMirror JSON ────────────────────────

function textNodes(text: Y.XmlText): PMNode[] {
  const out: PMNode[] = [];
  for (const op of text.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
    if (typeof op.insert !== 'string' || op.insert === '') continue; // ProseMirror has no empty or embedded text
    const node: PMNode = { type: 'text', text: op.insert };
    const marks: PMMark[] = [];
    for (const [key, value] of Object.entries(op.attributes ?? {})) {
      if (key === 'ychange' || value === null || value === undefined) continue;
      const mark: PMMark = { type: markName(key) };
      if (isPlainObject(value) && Object.keys(value).length > 0) mark.attrs = { ...value };
      marks.push(mark);
    }
    if (marks.length) node.marks = marks;
    out.push(node);
  }
  return out;
}

function children(parent: Y.XmlFragment | Y.XmlElement): PMNode[] {
  const out: PMNode[] = [];
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlElement) out.push(elementNode(child));
    else if (child instanceof Y.XmlText) out.push(...textNodes(child));
    // Y.XmlHook isn't something y-prosemirror makes; there is nothing to show for it.
  }
  return out;
}

function elementNode(el: Y.XmlElement): PMNode {
  const node: PMNode = { type: el.nodeName };
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(el.getAttributes() as Record<string, unknown>)) {
    if (key !== 'ychange' && value !== null && value !== undefined) attrs[key] = value;
  }
  if (Object.keys(attrs).length) node.attrs = attrs;
  const content = children(el);
  if (content.length) node.content = content;
  return node;
}

/** A TipTap document's ProseMirror JSON, the way `editor.getJSON()` gives it (attributes left at
 * their defaults are left out; ProseMirror fills them in when the editor loads it). */
export function fragmentToProseMirror(fragment: Y.XmlFragment): PMNode {
  const content = children(fragment);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** Inline nodes in Chip Study's schema; everything else is a block. */
const INLINE = new Set(['text', 'hardBreak', 'inlineMath', 'citation', 'mention', 'emoji']);

/** How nodes read as text: the schema's own (hard breaks, citations) and the editor's
 * (math as LaTeX), as in src/workspace/extensions.ts plainText(). */
const AS_TEXT: Record<string, (node: PMNode) => string> = {
  hardBreak: () => '\n',
  inlineMath: (n) => `$${String(n.attrs?.latex ?? '')}$`,
  blockMath: (n) => `$$${String(n.attrs?.latex ?? '')}$$`,
  citation: (n) => String(n.attrs?.label ?? ''),
};

/** The document as plain text, exactly as the editor's getText does it: a blank line before every
 * block but the first, math as LaTeX, citations as they read. */
export function plainText(doc: PMNode): string {
  let text = '';
  let first = true;
  const visit = (node: PMNode) => {
    if (!INLINE.has(node.type) && !first) text += '\n\n';
    first = false;
    const asText = AS_TEXT[node.type];
    if (asText) {
      text += asText(node);
      return;
    }
    if (node.type === 'text') {
      text += node.text ?? '';
      return;
    }
    node.content?.forEach(visit);
  };
  doc.content?.forEach(visit);
  return text;
}

// ── Code and sheets ─────────────────────────────────────────────────────

/** Reads a field of a Y.Map entry (or of a plain object, if a screen stored one). */
export type Getter = (key: string) => unknown;

export function getter(entry: unknown): Getter | null {
  if (entry instanceof Y.Map) return (key) => entry.get(key);
  if (isPlainObject(entry)) return (key) => entry[key];
  return null;
}

const str = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v instanceof Y.Text) return v.toString();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
};

/** A code document: `{lang, code, stdin?}` (lang left out when the room never set one, so the
 * editor works it out from the file name as it does today). */
export function codeContent(meta: Getter, text: Y.Text): { content: Record<string, unknown>; text: string } {
  const code = text.toString();
  const content: Record<string, unknown> = {};
  const lang = str(meta('lang'));
  if (lang) content.lang = lang;
  content.code = code;
  const stdin = str(meta('stdin'));
  if (stdin) content.stdin = stdin;
  return { content, text: code };
}

/** A sheet: `{rows, header}`, with its worked-out values as CSV for the text. */
export function sheetContent(meta: Getter, rows: Y.Array<unknown>): { content: Record<string, unknown>; text: string } {
  const grid: Grid = rows.toArray().map((row) => {
    const cells = row instanceof Y.Array ? row.toArray() : Array.isArray(row) ? row : [];
    return cells.map(str);
  });
  const header = meta('header');
  return { content: { rows: grid, header: typeof header === 'boolean' ? header : true }, text: toCsv(evaluate(grid)) };
}

// ── The whole room ──────────────────────────────────────────────────────

export const isSeeded = (doc: Y.Doc): boolean => doc.getMap(YDOC.room).get('seeded') === true;

function documentOf(doc: Y.Doc, id: string, meta: Getter): SavedDocument | null {
  const kind = meta('kind') as DocKind;
  if (!UUID.test(id) || !KINDS.has(kind)) return null;
  const sort = Number(meta('sort'));
  const base = { id, kind, title: str(meta('title')), sort: Number.isFinite(sort) ? Math.trunc(sort) : 0 };
  if (kind === 'code') return { ...base, ...codeContent(meta, doc.getText(YDOC.code(id))), words: 0 };
  if (kind === 'sheet') return { ...base, ...sheetContent(meta, doc.getArray(YDOC.sheet(id))), words: 0 };
  const content = fragmentToProseMirror(doc.getXmlFragment(YDOC.doc(id)));
  const text = plainText(content);
  return { ...base, content: content as unknown as Record<string, unknown>, text, words: countWords(text) };
}

const entries = (arr: Y.Array<unknown>): Getter[] => arr.toArray().map(getter).filter((g): g is Getter => g !== null);

/** One row per id, the first kept: the database can't take the same id twice in one save. */
const firstOfEach = <T extends { id: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id) !== undefined);
};

/** What to save, or null while the room hasn't been seeded: an empty room must never be saved over
 * the host's work. [seededBefore] says the room was seeded earlier (so a later edit that takes
 * the flag away doesn't stop the saving). Rows without a UUID id (or documents of an unknown
 * kind) are left out: the database couldn't keep them. A document whose shared type is of the
 * wrong kind is left out too, rather than failing the whole save. */
export function buildSave(doc: Y.Doc, seededBefore = false): SavePayload | null {
  if (!seededBefore && !isSeeded(doc)) return null;
  const documents: SavedDocument[] = [];
  doc.getMap(YDOC.documents).forEach((entry, id) => {
    const meta = getter(entry);
    if (!meta) return;
    try {
      const saved = documentOf(doc, id, meta);
      if (saved) documents.push(saved);
    } catch (e) {
      console.warn('room save: skipped document', id, e instanceof Error ? e.message : e);
    }
  });
  documents.sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));

  const notes: SavedNote[] = [];
  for (const m of entries(doc.getArray(YDOC.notes))) {
    const id = str(m('id'));
    if (UUID.test(id)) notes.push({ id, body: str(m('body')), pinned: m('pinned') === true });
  }

  const tasks: SavedTask[] = [];
  for (const m of entries(doc.getArray(YDOC.tasks))) {
    const id = str(m('id'));
    const due = str(m('due_on'));
    if (UUID.test(id)) tasks.push({ id, title: str(m('title')), due_on: isDay(due) ? due : null, done: m('done') === true });
  }
  return { documents, notes: firstOfEach(notes), tasks: firstOfEach(tasks) };
}

/** A quick fingerprint of a saved row, to send only what changed since the last save: two 32-bit
 * hashes and the length. Not for security; a change it missed would go with the next one. */
export function fingerprint(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return `${s.length.toString(36)}.${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}
