// Filling a room with the host's work (src/rooms/seed.ts) and keeping a screen's copy honest
// (src/rooms/ysync.ts). The filling is checked against what the room server saves (worker/ydoc.ts):
// what goes in is exactly what would come back out, so a room nobody touches never changes the
// host's work.
import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FRAME, YDOC } from '../../shared/rooms';
import type { RoomWorkspace } from '../../src/rooms/api';
import { isSeeded, seedRoom } from '../../src/rooms/seed';
import { FROM_ROOM, YRoom } from '../../src/rooms/ysync';
import { extensions } from '../../src/workspace/extensions';
import { buildSave } from '../../worker/ydoc';

let schema: Schema;
beforeAll(() => {
  schema = getSchema(extensions({ onMath: () => {}, shared: true }));
});

const DOC = '11111111-1111-4111-8111-111111111111';
const CODE = '22222222-2222-4222-8222-222222222222';
const SHEET = '33333333-3333-4333-8333-333333333333';
const BAD = '44444444-4444-4444-8444-444444444444';
const EMPTY_SHEET = '55555555-5555-4555-8555-555555555555';
const NOTE = '66666666-6666-4666-8666-666666666666';
const TASK = '77777777-7777-4777-8777-777777777777';

const essay = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Water in cities' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Cities need ' },
        { type: 'text', text: 'water', marks: [{ type: 'bold' }] },
        { type: 'text', text: '. ' },
        { type: 'text', text: 'Chip wrote this', marks: [{ type: 'chip', attrs: { message: 'm-1' } }] },
      ],
    },
  ],
};

const workspace = (): RoomWorkspace => ({
  assignment: { id: 'a', title: 'Essay', course: '', brief: '', rubric: '', due_at: null, word_target: null, style: 'apa', kind: 'assignment', color: 'sky' },
  documents: [
    { id: CODE, kind: 'code', title: 'main.py', content: { lang: 'python', code: 'print("hi")\n', stdin: '3\n' }, version: 2, sort: 1 },
    { id: DOC, kind: 'doc', title: 'Draft', content: essay, version: 5, sort: 0 },
    { id: SHEET, kind: 'sheet', title: 'Budget', content: { rows: [['Item', 'Cost'], ['Pens', '2']], header: false }, version: 1, sort: 2 },
    { id: EMPTY_SHEET, kind: 'sheet', title: 'Table', content: {}, version: 1, sort: 3 },
    { id: BAD, kind: 'doc', title: 'Broken', content: { type: 'doc', content: [{ type: 'no-such-node' }] }, version: 1, sort: 4 },
  ],
  sources: [],
  notes: [{ id: NOTE, body: 'Read chapter 2', pinned: true }],
  tasks: [{ id: TASK, title: 'Outline', due_on: '2026-11-20', done: false }],
});

describe('seeding a room', () => {
  it('fills every shared type in one transaction, with room.seeded', () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    expect(seedRoom(doc, workspace(), schema)).toBe(true);
    // One update: one frame for the room, all or nothing.
    expect(updates).toHaveLength(1);
    expect(isSeeded(doc)).toBe(true);

    const docs = doc.getMap(YDOC.documents);
    expect([...docs.keys()].sort()).toEqual([CODE, DOC, SHEET, EMPTY_SHEET].sort());
    const meta = (id: string) => (docs.get(id) as Y.Map<unknown>).toJSON();
    expect(meta(DOC)).toEqual({ kind: 'doc', title: 'Draft', sort: 0 });
    expect(meta(CODE)).toEqual({ kind: 'code', title: 'main.py', sort: 1, lang: 'python', stdin: '3\n' });
    expect(meta(SHEET)).toEqual({ kind: 'sheet', title: 'Budget', sort: 2, header: false });
    expect(doc.getText(YDOC.code(CODE)).toString()).toBe('print("hi")\n');
    expect(doc.getArray(YDOC.notes).toJSON()).toEqual([{ id: NOTE, body: 'Read chapter 2', pinned: true }]);
    expect(doc.getArray(YDOC.tasks).toJSON()).toEqual([{ id: TASK, title: 'Outline', due_on: '2026-11-20', done: false }]);
  });

  it('puts in exactly what the room server would save back', () => {
    const doc = new Y.Doc();
    seedRoom(doc, workspace(), schema);
    const saved = buildSave(doc)!;
    const byId = Object.fromEntries(saved.documents.map((d) => [d.id, d]));
    // Attributes left at their defaults are left out, as editor.getJSON() leaves them for the editor to fill in.
    expect(byId[DOC].content).toEqual(essay);
    expect(byId[DOC].text).toBe('Water in cities\n\nCities need water. Chip wrote this');
    expect(byId[CODE].content).toEqual({ lang: 'python', code: 'print("hi")\n', stdin: '3\n' });
    expect(byId[SHEET].content).toEqual({ rows: [['Item', 'Cost'], ['Pens', '2']], header: false });
    // An empty sheet starts as the editor's blank table.
    expect((byId[EMPTY_SHEET].content.rows as string[][]).length).toBe(8);
    expect(saved.notes).toEqual([{ id: NOTE, body: 'Read chapter 2', pinned: true }]);
    expect(saved.tasks).toEqual([{ id: TASK, title: 'Outline', due_on: '2026-11-20', done: false }]);
  });

  it('leaves out a document the editor can’t read, rather than filling it empty', () => {
    const doc = new Y.Doc();
    seedRoom(doc, workspace(), schema);
    expect(doc.getMap(YDOC.documents).has(BAD)).toBe(false);
    expect(buildSave(doc)!.documents.some((d) => d.id === BAD)).toBe(false);
  });

  it('never fills a room twice: someone asked earlier may have finished', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    expect(seedRoom(a, workspace(), schema)).toBe(true);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const updates: Uint8Array[] = [];
    b.on('update', (u: Uint8Array) => updates.push(u));
    expect(seedRoom(b, workspace(), schema)).toBe(false);
    expect(updates).toHaveLength(0);
    expect(b.getArray(YDOC.notes).length).toBe(1);
  });

  it('fills a room with no documents, notes or tasks', () => {
    const doc = new Y.Doc();
    expect(seedRoom(doc, { ...workspace(), documents: [], notes: [], tasks: [] }, schema)).toBe(true);
    expect(isSeeded(doc)).toBe(true);
    expect(buildSave(doc)).toEqual({ documents: [], notes: [], tasks: [] });
  });
});

// ── A screen's copy ─────────────────────────────────────────────────────

const frames = (sent: Uint8Array[]) =>
  sent.map((f) => {
    const d = decoding.createDecoder(f);
    const type = decoding.readVarUint(d);
    if (type === FRAME.awareness) return 'awareness';
    return ['step1', 'step2', 'update'][decoding.readVarUint(d)];
  });

/** What the room sends: its own document's step 1, step 2, or an update. */
function fromRoom(room: Y.Doc, kind: 'step1' | 'update', update?: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, FRAME.sync);
  if (kind === 'step1') syncProtocol.writeSyncStep1(enc, room);
  else syncProtocol.writeUpdate(enc, update!);
  return encoding.toUint8Array(enc);
}

describe('a screen’s copy of the room', () => {
  const user = { id: 'u1', name: 'Ada', color: '#6457f0' };

  it('asks for the room on opening, sends an editor’s changes, and answers the room’s step 1', () => {
    const sent: Uint8Array[] = [];
    const y = new YRoom((b) => sent.push(b), user, true);
    y.opened();
    expect(frames(sent)).toEqual(['step1', 'awareness']);
    y.doc.getText('t').insert(0, 'hi');
    expect(frames(sent).at(-1)).toBe('update');
    const room = new Y.Doc();
    y.receive(fromRoom(room, 'step1'));
    expect(frames(sent).at(-1)).toBe('step2');
    y.destroy();
  });

  it('never sends a viewer’s changes, and starts afresh before letting them edit', () => {
    const sent: Uint8Array[] = [];
    const y = new YRoom((b) => sent.push(b), user, false);
    y.opened();
    const before = sent.length;
    let resets = 0;
    y.onReset = () => resets++;
    const first = y.doc;
    y.doc.getText('t').insert(0, 'a change the room would drop');
    expect(sent.length).toBe(before);
    // A viewer doesn't answer the room's step 1 either.
    y.receive(fromRoom(new Y.Doc(), 'step1'));
    expect(frames(sent.slice(before))).not.toContain('step2');
    // Allowed to edit: the spoiled copy goes, and a new one asks the room for everything.
    y.setCanEdit(true);
    expect(y.doc).not.toBe(first);
    expect(y.doc.getText('t').toString()).toBe('');
    expect(resets).toBe(1);
    expect(frames(sent).at(-2)).toBe('step1');
    y.destroy();
  });

  it('starts afresh on losing edit rights, and keeps a clean copy on gaining them', () => {
    const y = new YRoom(() => {}, user, true);
    y.opened();
    const first = y.doc;
    y.setCanEdit(false);
    expect(y.doc).not.toBe(first);
    expect(y.generation).toBe(1);
    const second = y.doc;
    y.setCanEdit(true); // nothing spoiled: the same copy
    expect(y.doc).toBe(second);
    y.destroy();
  });

  it('takes the room’s changes without sending them back', () => {
    const sent: Uint8Array[] = [];
    const y = new YRoom((b) => sent.push(b), user, true);
    y.opened();
    const room = new Y.Doc();
    let update: Uint8Array | null = null;
    room.on('update', (u: Uint8Array) => (update = u));
    room.getText('t').insert(0, 'from the room');
    const before = sent.length;
    y.receive(fromRoom(room, 'update', update!));
    expect(y.doc.getText('t').toString()).toBe('from the room');
    expect(sent.length).toBe(before);
    // A seed made on this screen goes up as one update.
    seedRoom(y.doc, workspace(), schema);
    expect(frames(sent.slice(before))).toEqual(['update']);
    y.destroy();
  });

  it('holds an editor’s changes while the socket is away, and the room’s step 1 brings them', () => {
    const sent: Uint8Array[] = [];
    const y = new YRoom((b) => sent.push(b), user, true);
    y.opened();
    y.closed();
    const before = sent.length;
    y.doc.getText('t').insert(0, 'offline');
    expect(sent.length).toBe(before);
    y.opened();
    const room = new Y.Doc();
    y.receive(fromRoom(room, 'step1'));
    const step2 = sent.at(-1)!;
    const d = decoding.createDecoder(step2);
    decoding.readVarUint(d);
    syncProtocol.readSyncMessage(d, encoding.createEncoder(), room, FROM_ROOM);
    expect(room.getText('t').toString()).toBe('offline');
    y.destroy();
  });
});
