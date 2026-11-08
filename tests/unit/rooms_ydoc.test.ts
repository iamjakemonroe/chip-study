// The room server turns the shared Y.Doc back into what the editors save. Documents are checked
// against the real thing: Chip Study's own TipTap schema, written into Yjs by TipTap's own
// collaboration binding (@tiptap/y-tiptap), read back by our small converter, and compared with
// what the binding itself reads back.
import { getSchema, getText, getTextSerializersFromSchema, type JSONContent } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { countWords } from '../../src/lib/autosave';
import { evaluate, toCsv } from '../../src/lib/sheet';
import { extensions } from '../../src/workspace/extensions';
import { YDOC } from '../../shared/rooms';
import { changedBatches, MAX_ROWS, prints } from '../../worker/save';
import { buildSave, fingerprint, fragmentToProseMirror, markName, plainText, type SavePayload } from '../../worker/ydoc';

let schema: Schema;
beforeAll(() => {
  schema = getSchema(extensions({ onMath: () => {} }));
});

/** The editor's own plain text (src/workspace/extensions.ts plainText), for a document node. */
const editorText = (node: PMNode) =>
  getText(node, {
    blockSeparator: '\n\n',
    textSerializers: {
      ...getTextSerializersFromSchema(schema),
      inlineMath: ({ node: n }) => `$${n.attrs.latex}$`,
      blockMath: ({ node: n }) => `$$${n.attrs.latex}$$`,
      citation: ({ node: n }) => n.attrs.label,
    },
  });

const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', ...(content.length ? { content } : {}) });

const RICH: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [text('Water in cities')] },
    para(
      text('Plain, '),
      text('bold', [{ type: 'bold' }]),
      text(' and '),
      text('a link in italics', [{ type: 'link', attrs: { href: 'https://example.com/a?b=1', target: '_blank' } }, { type: 'italic' }]),
      { type: 'hardBreak' },
      text('Chip wrote this', [{ type: 'chip', attrs: { message: '6f1c' } }]),
      text(' then '),
      { type: 'inlineMath', attrs: { latex: 'x^2 + 1' } },
      text(' as shown '),
      { type: 'citation', attrs: { source: 'src-1', page: '12', label: '(Smith, 2020, p. 12)' } },
      text('.'),
    ),
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            para(text('first')),
            {
              type: 'orderedList',
              attrs: { start: 3 },
              content: [
                { type: 'listItem', content: [para(text('nested, '), text('struck', [{ type: 'strike' }]))] },
                { type: 'listItem', content: [para(text('deeper')), { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('deepest'))] }] }] },
              ],
            },
          ],
        },
        { type: 'listItem', content: [para(text('second', [{ type: 'highlight' }, { type: 'bold' }]))] },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [para(text('City'))] },
            { type: 'tableHeader', attrs: { colwidth: [120] }, content: [para(text('Litres'))] },
          ],
        },
        { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [para(text('Lagos: '), text('2,400', [{ type: 'code' }]))] }] },
      ],
    },
    { type: 'blockMath', attrs: { latex: '\\int_0^1 x\\,dx' } },
    { type: 'codeBlock', attrs: { language: 'python' }, content: [text('print("hi")\nprint(2)')] },
    { type: 'blockquote', content: [para(text('A quote '), text('underlined', [{ type: 'underline' }]))] },
    { type: 'horizontalRule' },
    para(text('Right-aligned end.')),
    para(),
  ],
};

/** Writes [json] into a Y.XmlFragment the way TipTap's collaboration binding does. */
function fragmentOf(json: JSONContent): Y.XmlFragment {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('doc/test');
  prosemirrorJSONToYXmlFragment(schema, json, fragment);
  return fragment;
}

describe('Y.XmlFragment → ProseMirror JSON', () => {
  it('reads back exactly what TipTap wrote, marks, nested lists, tables and attributes included', () => {
    const fragment = fragmentOf(RICH);
    const ours = fragmentToProseMirror(fragment);
    const theirs = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    // Our JSON leaves default attributes out, as getJSON's consumers fill them in: once the
    // editor loads it, it's the same document.
    const loaded = schema.nodeFromJSON(ours);
    loaded.check();
    expect(loaded.toJSON()).toEqual(theirs.toJSON());
    expect(loaded.eq(schema.nodeFromJSON(RICH))).toBe(true);
  });

  it('keeps node attributes and mark attributes as they are', () => {
    const ours = fragmentToProseMirror(fragmentOf(RICH));
    const heading = ours.content![0];
    expect(heading).toMatchObject({ type: 'heading', attrs: { level: 2, textAlign: 'center' } });
    const list = ours.content![2].content![0].content![1];
    expect(list).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
    const link = ours.content![1].content!.find((n) => n.text === 'a link in italics')!;
    expect(link.marks).toEqual(expect.arrayContaining([{ type: 'italic' }, expect.objectContaining({ type: 'link', attrs: expect.objectContaining({ href: 'https://example.com/a?b=1', target: '_blank' }) })]));
    const chip = ours.content![1].content!.find((n) => n.text === 'Chip wrote this')!;
    expect(chip.marks).toEqual([{ type: 'chip', attrs: { message: '6f1c' } }]);
    const cell = ours.content![3].content![1].content![0];
    expect(cell).toMatchObject({ type: 'tableCell', attrs: expect.objectContaining({ colspan: 2 }) });
  });

  it('gives the same plain text and word count as the editor', () => {
    const fragment = fragmentOf(RICH);
    const ours = plainText(fragmentToProseMirror(fragment));
    const theirs = editorText(yXmlFragmentToProseMirrorRootNode(fragment, schema));
    expect(ours).toBe(theirs);
    expect(ours).toContain('$x^2 + 1$');
    expect(ours).toContain('$$\\int_0^1 x\\,dx$$');
    expect(ours).toContain('(Smith, 2020, p. 12)');
    expect(countWords(ours)).toBe(countWords(theirs));
  });

  it("takes the hash off marks that may overlap themselves, and drops y-prosemirror's change markers", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('doc/x');
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    fragment.insert(0, [p]);
    p.insert(0, [t]);
    t.insert(0, 'two comments', { 'comment--AbC+/9z=': { id: 'c1' }, 'comment--Zz00Zz00': { id: 'c2' }, bold: {}, ychange: { type: 'added' } });
    p.setAttribute('textAlign', 'right');
    p.setAttribute('ychange', { type: 'added' } as unknown as string);
    expect(fragmentToProseMirror(fragment)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'right' },
          content: [{ type: 'text', text: 'two comments', marks: [{ type: 'comment', attrs: { id: 'c1' } }, { type: 'comment', attrs: { id: 'c2' } }, { type: 'bold' }] }],
        },
      ],
    });
    expect(markName('link')).toBe('link');
    expect(markName('my--mark')).toBe('my--mark');
    expect(markName('comment--12345678')).toBe('comment');
  });

  it('gives an empty fragment one empty paragraph, as a new document has', () => {
    const doc = new Y.Doc();
    const ours = fragmentToProseMirror(doc.getXmlFragment('doc/empty'));
    expect(ours).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(() => schema.nodeFromJSON(ours).check()).not.toThrow();
    expect(plainText(ours)).toBe('');
  });
});

// ── The whole room ──────────────────────────────────────────────────────

const ID = {
  doc: '11111111-1111-4111-8111-111111111111',
  code: '22222222-2222-4222-8222-222222222222',
  sheet: '33333333-3333-4333-8333-333333333333',
  note1: '44444444-4444-4444-8444-444444444444',
  note2: '55555555-5555-4555-8555-555555555555',
  task1: '66666666-6666-4666-8666-666666666666',
  task2: '77777777-7777-4777-8777-777777777777',
};

const entry = (fields: Record<string, unknown>) => {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return m;
};

/** A room filled the way the seeder fills it: every type in one transaction, with room.seeded. */
function seededRoom(opts: { seeded?: boolean } = {}): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const docs = doc.getMap(YDOC.documents);
    docs.set(ID.doc, entry({ kind: 'doc', title: 'Essay', sort: 0 }));
    docs.set(ID.code, entry({ kind: 'code', title: 'main.py', sort: 1, lang: 'python', stdin: '3\n' }));
    docs.set(ID.sheet, entry({ kind: 'sheet', title: 'Budget', sort: 2, header: true }));
    docs.set('not-a-uuid', entry({ kind: 'doc', title: 'Bad', sort: 3 }));
    docs.set('88888888-8888-4888-8888-888888888888', entry({ kind: 'slides', title: 'Unknown kind', sort: 4 }));
    prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: [para(text('Hello room, two words more.'))] }, doc.getXmlFragment(YDOC.doc(ID.doc)));
    doc.getText(YDOC.code(ID.code)).insert(0, 'n = int(input())\nprint(n * 2)\n');
    const rows = doc.getArray<Y.Array<string>>(YDOC.sheet(ID.sheet));
    for (const r of [['Item', 'Cost'], ['Pens', '2.5'], ['Books', '=B2*4'], ['Total', '=SUM(B2:B3)'], ['Note', 'a "quoted", comma']]) {
      const row = new Y.Array<string>();
      row.push(r);
      rows.push([row]);
    }
    doc.getArray(YDOC.notes).push([
      entry({ id: ID.note1, body: 'Read chapter 2', pinned: true }),
      entry({ id: ID.note2, body: 'Ask about sources', pinned: false }),
      entry({ id: 'nope', body: 'no uuid: skipped', pinned: false }),
    ]);
    doc.getArray(YDOC.tasks).push([
      entry({ id: ID.task1, title: 'Outline', due_on: '2026-11-20', done: false }),
      entry({ id: ID.task2, title: 'Draft', due_on: 'next week', done: true }),
    ]);
    if (opts.seeded !== false) doc.getMap(YDOC.room).set('seeded', true);
  });
  return doc;
}

describe('the save payload', () => {
  it('is never made before the room is seeded', () => {
    const doc = seededRoom({ seeded: false });
    expect(buildSave(doc)).toBeNull();
    expect(buildSave(new Y.Doc())).toBeNull();
    doc.getMap(YDOC.room).set('seeded', 'yes'); // only true counts
    expect(buildSave(doc)).toBeNull();
    doc.getMap(YDOC.room).set('seeded', true);
    expect(buildSave(doc)).not.toBeNull();
  });

  it('turns documents, code and sheets into the editors’ own formats', () => {
    const save = buildSave(seededRoom())!;
    expect(save.documents.map((d) => [d.id, d.kind, d.title, d.sort])).toEqual([
      [ID.doc, 'doc', 'Essay', 0],
      [ID.code, 'code', 'main.py', 1],
      [ID.sheet, 'sheet', 'Budget', 2],
    ]);
    const [essay, code, sheet] = save.documents;
    expect(essay.content).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello room, two words more.' }] }] });
    expect(essay.text).toBe('Hello room, two words more.');
    expect(essay.words).toBe(5);

    expect(code.content).toEqual({ lang: 'python', code: 'n = int(input())\nprint(n * 2)\n', stdin: '3\n' });
    expect(code.text).toBe('n = int(input())\nprint(n * 2)\n');
    expect(code.words).toBe(0);

    const rows = [['Item', 'Cost'], ['Pens', '2.5'], ['Books', '=B2*4'], ['Total', '=SUM(B2:B3)'], ['Note', 'a "quoted", comma']];
    expect(sheet.content).toEqual({ rows, header: true });
    expect(sheet.text).toBe(toCsv(evaluate(rows)));
    expect(sheet.text).toBe('Item,Cost\nPens,2.5\nBooks,10\nTotal,12.5\nNote,"a ""quoted"", comma"');
    expect(sheet.words).toBe(0);
  });

  it('leaves out what a code document never set, and defaults a sheet to a header row', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap(YDOC.documents).set(ID.code, entry({ kind: 'code', title: 'notes.txt', sort: 0 }));
      doc.getMap(YDOC.documents).set(ID.sheet, { kind: 'sheet', title: 'Plain object entry', sort: 1 });
      doc.getText(YDOC.code(ID.code)).insert(0, 'x');
      doc.getMap(YDOC.room).set('seeded', true);
    });
    const [code, sheet] = buildSave(doc)!.documents;
    expect(code.content).toEqual({ code: 'x' });
    expect(sheet.content).toEqual({ rows: [], header: true });
    expect(sheet.text).toBe('');
  });

  it('keeps saving a room whose flag an edit took away after it was seeded', () => {
    const doc = seededRoom();
    doc.getMap(YDOC.room).delete('seeded');
    expect(buildSave(doc)).toBeNull();
    expect(buildSave(doc, true)?.documents).toHaveLength(3);
  });

  it('keeps notes and tasks with UUID ids, and only real dates', () => {
    const save = buildSave(seededRoom())!;
    expect(save.notes).toEqual([
      { id: ID.note1, body: 'Read chapter 2', pinned: true },
      { id: ID.note2, body: 'Ask about sources', pinned: false },
    ]);
    expect(save.tasks).toEqual([
      { id: ID.task1, title: 'Outline', due_on: '2026-11-20', done: false },
      { id: ID.task2, title: 'Draft', due_on: null, done: true },
    ]);
    // A date the database couldn't read would fail the whole save: it's left out.
    const doc = seededRoom();
    (doc.getArray(YDOC.tasks).get(0) as Y.Map<unknown>).set('due_on', '2026-02-30');
    expect(buildSave(doc)!.tasks[0].due_on).toBeNull();
  });

  it('keeps one row per id, so a doubled row can’t make every save fail', () => {
    const doc = seededRoom();
    doc.getArray(YDOC.notes).push([entry({ id: ID.note1, body: 'a copy', pinned: false })]);
    doc.getArray(YDOC.tasks).push([entry({ id: ID.task1, title: 'a copy', due_on: null, done: false })]);
    const save = buildSave(doc)!;
    expect(save.notes.map((n) => n.body)).toEqual(['Read chapter 2', 'Ask about sources']);
    expect(save.tasks.map((t) => t.title)).toEqual(['Outline', 'Draft']);
  });

  it('reads note bodies and titles kept as Y.Text too', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const body = new Y.Text();
      body.insert(0, 'shared body');
      doc.getArray(YDOC.notes).push([entry({ id: ID.note1, body, pinned: false })]);
      doc.getMap(YDOC.room).set('seeded', true);
    });
    expect(buildSave(doc)!.notes).toEqual([{ id: ID.note1, body: 'shared body', pinned: false }]);
  });
});

describe('sending only what changed', () => {
  const saved = (p: SavePayload) => {
    const remembered = prints(p);
    return (key: string) => remembered.get(key) ?? null;
  };

  it('sends nothing when nothing changed since the room was filled', () => {
    const doc = seededRoom();
    const baseline = saved(buildSave(doc)!);
    expect(changedBatches(buildSave(doc)!, baseline)).toEqual([]);
  });

  it('sends just the changed document, and notes or tasks only when they changed', () => {
    const doc = seededRoom();
    const baseline = saved(buildSave(doc)!);
    doc.getText(YDOC.code(ID.code)).insert(0, '# edited\n');
    let batches = changedBatches(buildSave(doc)!, baseline);
    expect(batches).toHaveLength(1);
    expect(batches[0].body.documents?.map((d) => d.id)).toEqual([ID.code]);
    expect(batches[0].body.notes).toBeUndefined();
    expect(batches[0].body.tasks).toBeUndefined();

    (doc.getArray(YDOC.notes).get(0) as Y.Map<unknown>).set('pinned', false);
    batches = changedBatches(buildSave(doc)!, baseline);
    expect(batches[0].body.notes).toHaveLength(2);
    expect(batches[0].body.tasks).toBeUndefined();
    expect(batches[0].prints.map(([k]) => k).sort()).toEqual([`doc:${ID.code}`, 'notes']);
  });

  it('sends an emptied list (so deleting every note is saved) but never cuts a long list short', () => {
    const base: SavePayload = { documents: [], notes: [{ id: ID.note1, body: 'x', pinned: false }], tasks: [] };
    const baseline = saved(base);
    expect(changedBatches({ ...base, notes: [] }, baseline)[0].body.notes).toEqual([]);
    const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, body: '', pinned: false }));
    expect(changedBatches({ ...base, notes: many }, baseline)).toEqual([]);
  });

  it('splits many or large documents into batches the function takes', () => {
    const big = 'x'.repeat(1_500_000);
    const documents = Array.from({ length: 4 }, (_, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      kind: 'code' as const,
      title: `f${i}`,
      sort: i,
      content: { code: big },
      text: big,
      words: 0,
    }));
    const batches = changedBatches({ documents, notes: [], tasks: [] }, () => null);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) expect(JSON.stringify(b.body).length).toBeLessThan(8_000_000);
    expect(batches.flatMap((b) => b.body.documents!.map((d) => d.id))).toEqual(documents.map((d) => d.id));
    expect(batches[0].body.notes).toEqual([]); // notes went in the first batch: they changed from "never saved"
  });

  it('measures batches in bytes, and holds back a document too big for any save', () => {
    const doc = (i: number, text: string) => ({ id: `00000000-0000-4000-8000-00000000001${i}`, kind: 'code' as const, title: `f${i}`, sort: i, content: { code: text }, text, words: 0 });
    // Each document is 1.2 million characters (content and text) but 2.4 MB of UTF-8: two fit a
    // 4 MB batch by characters, not by bytes.
    const wide = 'é'.repeat(600_000);
    const batches = changedBatches({ documents: [doc(0, wide), doc(1, wide)], notes: [], tasks: [] }, (k) => (k === 'notes' || k === 'tasks' ? prints({ documents: [], notes: [], tasks: [] }).get(k)! : null));
    expect(batches).toHaveLength(2);
    const huge = 'x'.repeat(4_000_000); // content and text: 8 MB
    expect(changedBatches({ documents: [doc(2, huge)], notes: [], tasks: [] }, (k) => (k.startsWith('doc:') ? null : prints({ documents: [], notes: [], tasks: [] }).get(k)!))).toEqual([]);
  });

  it('fingerprints differ for different text and match for the same', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
    expect(fingerprint('')).not.toBe(fingerprint(' '));
  });
});
