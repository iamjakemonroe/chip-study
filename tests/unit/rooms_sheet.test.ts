// A room's sheet (src/rooms/ysheet.ts): rows of cells in Y.Array<Y.Array<string>>, changed cell by
// cell, and repaired after two people change the same cell at once so the columns never shift.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { YDOC } from '../../shared/rooms';
import { sheetContent } from '../../worker/ydoc';
import { addColumn, addRow, fillSheet, readGrid, removeLastColumn, removeLastRow, repairSheet, setCell, watchSheet, type YSheet } from '../../src/rooms/ysheet';

const ID = 'sheet-1';
const sheetOf = (doc: Y.Doc) => doc.getArray(YDOC.sheet(ID)) as YSheet;

/** Two screens, each with its own copy, kept apart until [sync]. */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };
  return { a, b, sync };
}

describe('the room sheet', () => {
  it('reads and changes cells, rows and columns', () => {
    const doc = new Y.Doc();
    const rows = sheetOf(doc);
    fillSheet(rows, [
      ['Item', 'Cost'],
      ['Pens', '2'],
    ]);
    expect(readGrid(rows)).toEqual([
      ['Item', 'Cost'],
      ['Pens', '2'],
    ]);
    setCell(rows, 1, 1, '3');
    setCell(rows, 1, 1, '3'); // the same value changes nothing
    addRow(rows);
    setCell(rows, 2, 0, 'Total');
    setCell(rows, 2, 1, '=SUM(B2:B2)');
    addColumn(rows);
    setCell(rows, 0, 2, 'Note');
    expect(readGrid(rows)).toEqual([
      ['Item', 'Cost', 'Note'],
      ['Pens', '3', ''],
      ['Total', '=SUM(B2:B2)', ''],
    ]);
    removeLastColumn(rows);
    removeLastRow(rows);
    expect(readGrid(rows)).toEqual([
      ['Item', 'Cost'],
      ['Pens', '3'],
    ]);
    // A cell past the end of a short row fills the gap.
    setCell(rows, 0, 4, 'E');
    expect(readGrid(rows)[0]).toEqual(['Item', 'Cost', '', '', 'E']);
    expect(readGrid(rows)[1]).toEqual(['Pens', '3', '', '', '']);
  });

  it('is what the room server saves', () => {
    const doc = new Y.Doc();
    const rows = sheetOf(doc);
    fillSheet(rows, [
      ['A', 'B'],
      ['1', '=A2*2'],
    ]);
    setCell(rows, 1, 0, '4');
    const meta = new Map<string, unknown>([['header', true]]);
    expect(sheetContent((k) => meta.get(k), rows as unknown as Y.Array<unknown>)).toEqual({
      content: { rows: [['A', 'B'], ['4', '=A2*2']], header: true },
      text: 'A,B\n4,8',
    });
  });

  it('merges two people changing different cells of the same row', () => {
    const { a, b, sync } = pair();
    fillSheet(sheetOf(a), [['1', '2', '3']]);
    sync();
    setCell(sheetOf(a), 0, 0, 'x');
    setCell(sheetOf(b), 0, 2, 'z');
    sync();
    expect(repairSheet(sheetOf(a))).toBe(false);
    expect(readGrid(sheetOf(a))).toEqual([['x', '2', 'z']]);
    expect(readGrid(sheetOf(b))).toEqual([['x', '2', 'z']]);
  });

  it('repairs two people changing the same cell at once: one value wins, the columns stay put', () => {
    const { a, b, sync } = pair();
    fillSheet(sheetOf(a), [
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
    sync();
    setCell(sheetOf(a), 0, 1, 'from a');
    setCell(sheetOf(b), 0, 1, 'from b');
    sync();
    // Before the repair, the row has grown and the third column has moved.
    expect(sheetOf(a).get(0).length).toBe(4);
    // Both screens repair at once, and agree.
    expect(repairSheet(sheetOf(a))).toBe(true);
    expect(repairSheet(sheetOf(b))).toBe(true);
    sync();
    const ga = readGrid(sheetOf(a));
    expect(ga).toEqual(readGrid(sheetOf(b)));
    expect(ga[0]).toHaveLength(3);
    expect(['from a', 'from b']).toContain(ga[0][1]);
    expect(ga[0][0]).toBe('1');
    expect(ga[0][2]).toBe('3');
    expect(ga[1]).toEqual(['4', '5', '6']);
    expect(repairSheet(sheetOf(a))).toBe(false);
  });

  it('repairs when only one screen repairs, and when repairs cross', () => {
    const { a, b, sync } = pair();
    fillSheet(sheetOf(a), [['1', '2']]);
    sync();
    setCell(sheetOf(a), 0, 0, 'a');
    setCell(sheetOf(b), 0, 0, 'b');
    sync();
    repairSheet(sheetOf(b));
    sync();
    expect(readGrid(sheetOf(a))).toEqual(readGrid(sheetOf(b)));
    expect(readGrid(sheetOf(a))[0]).toHaveLength(2);
    expect(readGrid(sheetOf(a))[0][1]).toBe('2');
  });

  it('keeps one column when two people add a column at once, and fills out short rows', () => {
    const { a, b, sync } = pair();
    fillSheet(sheetOf(a), [['1'], ['2']]);
    sync();
    addColumn(sheetOf(a));
    addColumn(sheetOf(b));
    sync();
    repairSheet(sheetOf(a));
    repairSheet(sheetOf(b));
    sync();
    expect(readGrid(sheetOf(a))).toEqual([
      ['1', ''],
      ['2', ''],
    ]);
    expect(readGrid(sheetOf(b))).toEqual(readGrid(sheetOf(a)));

    // A row added while someone else added a column ends up as wide as the rest.
    addRow(sheetOf(a));
    addColumn(sheetOf(b));
    sync();
    repairSheet(sheetOf(a));
    sync();
    const g = readGrid(sheetOf(b));
    expect(g.every((r) => r.length === g[0].length)).toBe(true);
    expect(sheetOf(b).toArray().every((r) => r.length === g[0].length)).toBe(true);
  });

  it('tells the screen about every change, repairing first on an editor’s screen', () => {
    const { a, b, sync } = pair();
    fillSheet(sheetOf(a), [['1', '2']]);
    sync();
    const seen: string[][][] = [];
    const stop = watchSheet(sheetOf(a), (g) => seen.push(g), () => true);
    setCell(sheetOf(a), 0, 0, 'mine');
    setCell(sheetOf(b), 0, 0, 'theirs');
    sync();
    stop();
    const last = seen[seen.length - 1];
    expect(last[0]).toHaveLength(2);
    expect(seen.every((g) => g[0].length === 2)).toBe(true);
    // A viewer's screen doesn't repair (its writes would be dropped); it shows what the room has.
    const viewer = new Y.Doc();
    Y.applyUpdate(viewer, Y.encodeStateAsUpdate(a));
    const shown: number[] = [];
    const stop2 = watchSheet(sheetOf(viewer), (g) => shown.push(g[0].length), () => false);
    setCell(sheetOf(viewer), 0, 1, 'x');
    stop2();
    expect(shown).toEqual([2]);
  });
});
