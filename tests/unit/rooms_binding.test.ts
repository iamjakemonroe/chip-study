// The room's side of the editors (src/rooms/binding.ts): a viewer let in to edit can edit at once
// (sheets and code included, though their binding was made before), and a note or task changed by
// two people at once keeps both people's words (src/rooms/ytext.ts).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { YDOC } from '../../shared/rooms';
import { makeBinding } from '../../src/rooms/binding';
import { readGrid, fillSheet, type YSheet } from '../../src/rooms/ysheet';
import { applyTextEdit, sharedText } from '../../src/rooms/ytext';
import { FROM_ROOM, YRoom } from '../../src/rooms/ysync';
import { mapIndex } from '../../src/lib/textEdit';

const SHEET = '33333333-3333-4333-8333-333333333333';
const CODE = '22222222-2222-4222-8222-222222222222';
const NOTE = '66666666-6666-4666-8666-666666666666';
const TASK = '77777777-7777-4777-8777-777777777777';

function room(canEdit: boolean) {
  const y = new YRoom(() => {}, { id: 'u1', name: 'Ada', color: '#6457f0' }, canEdit);
  // What the room sent: a sheet, a code file, a note and a task.
  y.doc.transact(() => {
    const docs = y.doc.getMap(YDOC.documents);
    const sheet = new Y.Map<unknown>();
    sheet.set('kind', 'sheet');
    docs.set(SHEET, sheet);
    const code = new Y.Map<unknown>();
    code.set('kind', 'code');
    code.set('lang', 'python');
    docs.set(CODE, code);
    fillSheet(y.doc.getArray(YDOC.sheet(SHEET)) as YSheet, [['a', 'b']]);
    const note = new Y.Map<unknown>();
    note.set('id', NOTE);
    note.set('body', sharedText('Read chapter 2'));
    y.doc.getArray(YDOC.notes).push([note]);
    const task = new Y.Map<unknown>();
    task.set('id', TASK);
    task.set('title', sharedText('Outline'));
    y.doc.getArray(YDOC.tasks).push([task]);
  }, FROM_ROOM);
  const binding = makeBinding({ y, canEdit, me: { id: 'u1', name: 'Ada' }, nameOf: () => 'Ada', askChip: () => {} });
  return { y, binding };
}

describe('the room binding', () => {
  it('lets a viewer who is allowed to edit change sheets, code and lists at once', () => {
    const { y, binding } = room(false);
    const sheet = binding.sheet(SHEET);
    const code = binding.code(CODE);
    sheet.setCell(0, 0, 'viewer');
    code.setLang('javascript');
    binding.lists.editNoteBody(NOTE, 'Read chapter 2', 'nope');
    expect(readGrid(y.doc.getArray(YDOC.sheet(SHEET)) as YSheet)[0][0]).toBe('a');
    expect((y.doc.getMap(YDOC.documents).get(CODE) as Y.Map<unknown>).get('lang')).toBe('python');
    // Let in to edit (nothing spoiled, so the same copy and the same, already-open editors).
    y.setCanEdit(true);
    expect(y.generation).toBe(0);
    sheet.setCell(0, 0, 'editor');
    code.setLang('javascript');
    code.setStdin('3');
    binding.lists.editNoteBody(NOTE, 'Read chapter 2', 'Read chapter 2 and 3');
    expect(readGrid(y.doc.getArray(YDOC.sheet(SHEET)) as YSheet)[0][0]).toBe('editor');
    const meta = y.doc.getMap(YDOC.documents).get(CODE) as Y.Map<unknown>;
    expect(meta.get('lang')).toBe('javascript');
    expect(meta.get('stdin')).toBe('3');
    expect(String((y.doc.getArray(YDOC.notes).get(0) as Y.Map<unknown>).get('body'))).toBe('Read chapter 2 and 3');
    // And stopped again (a fresh copy, as the contract says): nothing more goes into the old one.
    const first = y.doc;
    y.setCanEdit(false);
    sheet.setCell(0, 1, 'late');
    expect(readGrid(first.getArray(YDOC.sheet(SHEET)) as YSheet)[0][1]).toBe('b');
  });

  it('merges two people changing the same note at once', () => {
    const a = room(true);
    // Bo's screen, with the room's copy.
    const b = { y: new YRoom(() => {}, { id: 'u2', name: 'Bo', color: '#2f95d6' }, true) };
    Y.applyUpdate(b.y.doc, Y.encodeStateAsUpdate(a.y.doc), FROM_ROOM);
    const bBinding = makeBinding({ y: b.y, canEdit: true, me: { id: 'u2', name: 'Bo' }, nameOf: () => 'Bo', askChip: () => {} });
    a.binding.lists.editNoteBody(NOTE, 'Read chapter 2', 'Read chapter 2 and 3');
    bBinding.lists.editNoteBody(NOTE, 'Read chapter 2', 'Re-read chapter 2');
    Y.applyUpdate(b.y.doc, Y.encodeStateAsUpdate(a.y.doc, Y.encodeStateVector(b.y.doc)));
    Y.applyUpdate(a.y.doc, Y.encodeStateAsUpdate(b.y.doc, Y.encodeStateVector(a.y.doc)));
    const body = (d: Y.Doc) => String((d.getArray(YDOC.notes).get(0) as Y.Map<unknown>).get('body'));
    expect(body(a.y.doc)).toBe('Re-read chapter 2 and 3');
    expect(body(b.y.doc)).toBe(body(a.y.doc));
  });

  it('merges a task title changed from an older version, and never deletes words someone else changed', () => {
    const t = new Y.Doc().getText('t');
    t.insert(0, 'Outline the essay');
    // Changed from "Outline" (before someone added " the essay"): both kept.
    applyTextEdit(t, 'Outline', 'Outline now');
    expect(t.toString()).toBe('Outline now the essay');

    const u = new Y.Doc().getText('u');
    u.insert(0, 'Draft introduction');
    // Removing " intro" from "Draft intro", which someone has since made "Draft introduction": kept.
    applyTextEdit(u, 'Draft intro', 'Draft');
    expect(u.toString()).toBe('Draft introduction');

    const v = new Y.Doc().getText('v');
    v.insert(0, 'Check sources, then the plan');
    // An edit after words that moved: it follows them.
    applyTextEdit(v, 'Check the plan', 'Check the whole plan');
    expect(v.toString()).toBe('Check sources, then the whole plan');
  });

  it('keeps a caret in place when someone else edits', () => {
    expect(mapIndex('hello world', 'hello big world', 8)).toBe(12);
    expect(mapIndex('hello world', 'hello big world', 3)).toBe(3);
    expect(mapIndex('hello world', 'hi world', 11)).toBe(8);
  });
});
