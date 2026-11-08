import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { YDOC } from '../../shared/rooms.ts';
import type { Mode } from '../lib/types.ts';
import type { RoomBinding, RoomCode, RoomLists, RoomSheet } from '../workspace/roomBinding.ts';
import { colorFor } from './people.ts';
import { addColumn, addRow, readGrid, removeLastColumn, removeLastRow, setCell, watchSheet, type YSheet } from './ysheet.ts';
import type { YRoom } from './ysync.ts';

/** The room's side of the workspace's editors (src/workspace/roomBinding.ts): TipTap and CodeMirror
 * bound to the shared document, the sheet, notes and tasks as Yjs changes, and cursors labelled
 * with names from the room's roster (never from what a screen puts in its awareness). */

/** An awareness that shows each person by their roster name and their colour, whatever their
 * screen claims (the server has already set `user.id` to the verified person). */
export function rosterAwareness(aw: Awareness, nameOf: (userId: string) => string | undefined): Awareness {
  const relabel = () => {
    const out = new Map<number, Record<string, unknown>>();
    aw.getStates().forEach((state, client) => {
      const user = state.user as { id?: string } | undefined;
      if (!user?.id) {
        out.set(client, state);
        return;
      }
      const color = colorFor(user.id);
      out.set(client, { ...state, user: { ...user, name: nameOf(user.id) ?? 'Someone', color, colorLight: `${color}33` } });
    });
    return out;
  };
  return {
    doc: aw.doc,
    clientID: aw.clientID,
    on: aw.on.bind(aw),
    off: aw.off.bind(aw),
    once: aw.once.bind(aw),
    getLocalState: () => aw.getLocalState(),
    setLocalState: (s: Record<string, unknown> | null) => aw.setLocalState(s),
    setLocalStateField: (k: string, v: unknown) => aw.setLocalStateField(k, v),
    getStates: relabel,
    get states() {
      return relabel();
    },
  } as unknown as Awareness;
}

/** The caret TipTap draws for someone else: a thin line in their colour and their name. */
function caret(user: Record<string, unknown>): HTMLElement {
  const color = typeof user.color === 'string' ? user.color : '#6457f0';
  const el = document.createElement('span');
  el.className = 'collab-caret';
  el.style.borderColor = color;
  const label = document.createElement('span');
  label.className = 'collab-caret-label';
  label.style.backgroundColor = color;
  label.textContent = typeof user.name === 'string' ? user.name : 'Someone';
  el.append(label);
  return el;
}

const entryOf = (fields: Record<string, unknown>) => {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return m;
};

function findIndex(arr: Y.Array<Y.Map<unknown>>, id: string): number {
  let at = -1;
  arr.forEach((m, i) => {
    if (at < 0 && m instanceof Y.Map && m.get('id') === id) at = i;
  });
  return at;
}

export interface BindingOptions {
  y: YRoom;
  canEdit: boolean;
  me: { id: string; name: string };
  nameOf: (userId: string) => string | undefined;
  askChip: (mode: Mode, text: string, selection?: string) => void;
}

export function makeBinding(o: BindingOptions): RoomBinding {
  const { y } = o;
  const doc = y.doc;
  const awareness = rosterAwareness(y.awareness, o.nameOf);
  const user = { id: o.me.id, name: o.me.name, color: colorFor(o.me.id) };
  const meta = (id: string) => {
    const m = doc.getMap(YDOC.documents).get(id);
    return m instanceof Y.Map ? m : null;
  };
  const write = (fn: () => void) => {
    if (o.canEdit) doc.transact(fn);
  };

  const lists: RoomLists = {
    addNote: (body) => write(() => doc.getArray<Y.Map<unknown>>(YDOC.notes).insert(0, [entryOf({ id: crypto.randomUUID(), body, pinned: false })])),
    updateNote: (id, patch) =>
      write(() => {
        const arr = doc.getArray<Y.Map<unknown>>(YDOC.notes);
        const m = arr.get(findIndex(arr, id));
        if (!(m instanceof Y.Map)) return;
        for (const [k, v] of Object.entries(patch)) if (v !== undefined && m.get(k) !== v) m.set(k, v);
      }),
    removeNote: (id) =>
      write(() => {
        const arr = doc.getArray<Y.Map<unknown>>(YDOC.notes);
        const i = findIndex(arr, id);
        if (i >= 0) arr.delete(i, 1);
      }),
    addTasks: (tasks) => write(() => doc.getArray<Y.Map<unknown>>(YDOC.tasks).push(tasks.map((t) => entryOf({ id: crypto.randomUUID(), title: t.title, due_on: t.due, done: false })))),
    updateTask: (id, patch) =>
      write(() => {
        const arr = doc.getArray<Y.Map<unknown>>(YDOC.tasks);
        const m = arr.get(findIndex(arr, id));
        if (!(m instanceof Y.Map)) return;
        for (const [k, v] of Object.entries(patch)) if (v !== undefined && m.get(k) !== v) m.set(k, v);
      }),
    removeTask: (id) =>
      write(() => {
        const arr = doc.getArray<Y.Map<unknown>>(YDOC.tasks);
        const i = findIndex(arr, id);
        if (i >= 0) arr.delete(i, 1);
      }),
  };

  return {
    key: y.generation,
    canEdit: o.canEdit,
    docExtensions: (id) => [Collaboration.configure({ fragment: doc.getXmlFragment(YDOC.doc(id)) }), CollaborationCaret.configure({ provider: { awareness }, user, render: caret })],
    code: (id): RoomCode => {
      const text = doc.getText(YDOC.code(id));
      const m = meta(id);
      return {
        text: text.toString(),
        lang: (m?.get('lang') as string | undefined) || undefined,
        stdin: (m?.get('stdin') as string | undefined) || undefined,
        extension: [Prec.highest(keymap.of(yUndoManagerKeymap)), yCollab(text, awareness, { undoManager: new Y.UndoManager(text) })],
        setLang: (lang) => write(() => meta(id)?.set('lang', lang)),
        setStdin: (stdin) => write(() => meta(id)?.set('stdin', stdin)),
      };
    },
    codeText: (id) => doc.getText(YDOC.code(id)).toString(),
    sheet: (id): RoomSheet => {
      const rows = doc.getArray(YDOC.sheet(id)) as YSheet;
      return {
        read: () => readGrid(rows),
        header: () => meta(id)?.get('header') !== false,
        setCell: (r, c, v) => write(() => setCell(rows, r, c, v)),
        addRow: () => write(() => addRow(rows)),
        addColumn: () => write(() => addColumn(rows)),
        removeRow: () => write(() => removeLastRow(rows)),
        removeColumn: () => write(() => removeLastColumn(rows)),
        setHeader: (on) => write(() => meta(id)?.set('header', on)),
        watch: (onChange) => {
          const stop = watchSheet(rows, onChange, () => o.canEdit);
          const m = meta(id);
          const onMeta = () => onChange();
          m?.observe(onMeta);
          return () => {
            stop();
            m?.unobserve(onMeta);
          };
        },
      };
    },
    lists,
    rename: (id, title) => write(() => meta(id)?.set('title', title.slice(0, 200))),
    askChip: o.askChip,
  };
}
