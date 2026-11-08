import * as Y from 'yjs';

/** A sheet in a room: `Y.Array<Y.Array<string>>`, rows of cells (docs/rooms.md, the Yjs layout).
 *
 * Changing a cell deletes it and puts the new value in its place. Two people changing the same
 * cell at the same moment would each put a value there, and the row would grow by one, pushing the
 * cells after it a column to the right. So after every change, an editor's screen repairs that:
 * cells put in at the same place at the same time have the same left neighbour (Yjs's `origin`),
 * which never happens otherwise, and every screen keeps the first of them (Yjs orders them the
 * same way everywhere) and deletes the rest. Deleting the same cell twice is harmless, so screens
 * that repair at the same time agree. Rows shorter than the sheet are filled out with empty cells
 * the same way. */

export type YSheet = Y.Array<Y.Array<string>>;
export type Grid = string[][];

/** What the repair writes with, so it doesn't trigger itself. */
export const REPAIR = Symbol('sheet-repair');

const cellsOf = (row: unknown): string[] => (row instanceof Y.Array ? row.toArray().map((c) => (typeof c === 'string' ? c : '')) : []);

/** The sheet as a grid, every row as wide as the widest. */
export function readGrid(rows: YSheet): Grid {
  const grid = rows.toArray().map(cellsOf);
  const width = Math.max(0, ...grid.map((r) => r.length));
  return grid.map((r) => (r.length < width ? [...r, ...Array.from({ length: width - r.length }, () => '')] : r));
}

const rowAt = (rows: YSheet, r: number): Y.Array<string> | null => {
  const row = rows.get(r);
  return row instanceof Y.Array ? row : null;
};

const makeRow = (cells: string[]): Y.Array<string> => {
  const row = new Y.Array<string>();
  row.push(cells);
  return row;
};

/** Fills an empty sheet (seeding). */
export function fillSheet(rows: YSheet, grid: Grid): void {
  if (grid.length) rows.push(grid.map(makeRow));
}

export function setCell(rows: YSheet, r: number, c: number, value: string): void {
  const row = rowAt(rows, r);
  if (!row) return;
  const doc = rows.doc;
  const run = () => {
    if (c < row.length) {
      if (row.get(c) === value) return;
      row.delete(c, 1);
      row.insert(c, [value]);
    } else {
      row.push([...Array.from({ length: c - row.length }, () => ''), value]);
    }
  };
  if (doc) doc.transact(run);
  else run();
}

export function addRow(rows: YSheet): void {
  const width = Math.max(1, ...rows.toArray().map((r) => cellsOf(r).length));
  rows.push([makeRow(Array.from({ length: width }, () => ''))]);
}

export function removeLastRow(rows: YSheet): void {
  if (rows.length > 1) rows.delete(rows.length - 1, 1);
}

export function addColumn(rows: YSheet): void {
  const run = () => rows.forEach((row) => row instanceof Y.Array && row.push(['']));
  if (rows.doc) rows.doc.transact(run);
  else run();
}

export function removeLastColumn(rows: YSheet): void {
  const width = Math.max(0, ...rows.toArray().map((r) => cellsOf(r).length));
  if (width <= 1) return;
  const run = () =>
    rows.forEach((row) => {
      if (row instanceof Y.Array && row.length >= width) row.delete(width - 1, 1);
    });
  if (rows.doc) rows.doc.transact(run);
  else run();
}

/** The same place in a row: Yjs's left neighbour when the cell went in. */
const originKey = (item: Y.Item): string => (item.origin ? `${item.origin.client}:${item.origin.clock}` : 'start');

/** Cells put in at the same place at the same time, apart from the first (see above). */
function duplicates(row: Y.Array<string>): { index: number; count: number }[] {
  const seen = new Set<string>();
  const out: { index: number; count: number }[] = [];
  let index = 0;
  for (let item = row._start; item; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const key = originKey(item);
    if (seen.has(key)) out.push({ index, count: item.length });
    else seen.add(key);
    index += item.length;
  }
  return out;
}

/** Repairs the sheet after concurrent changes (see above). Answers whether it changed anything.
 * Only screens that can edit should call it (a viewer's writes are dropped). */
export function repairSheet(rows: YSheet): boolean {
  const fixes: { row: Y.Array<string>; dupes: { index: number; count: number }[] }[] = [];
  rows.forEach((row) => {
    if (!(row instanceof Y.Array)) return;
    const dupes = duplicates(row);
    if (dupes.length) fixes.push({ row, dupes });
  });
  const lengths = () => rows.toArray().flatMap((r) => (r instanceof Y.Array ? [r.length] : []));
  const ragged = () => {
    const l = lengths();
    return l.some((n) => n !== l[0]);
  };
  if (!fixes.length && !ragged()) return false;
  const run = () => {
    for (const { row, dupes } of fixes) {
      // From the end, so the earlier indexes stay right.
      for (const d of [...dupes].reverse()) row.delete(d.index, d.count);
    }
    const width = Math.max(0, ...lengths());
    rows.forEach((row) => {
      if (row instanceof Y.Array && row.length < width) row.push(Array.from({ length: width - row.length }, () => ''));
    });
  };
  if (rows.doc) rows.doc.transact(run, REPAIR);
  else run();
  return true;
}

/** Calls [onChange] with the grid whenever the sheet changes, repairing it first when [canEdit]
 * says this screen may. Answers a function that stops. */
export function watchSheet(rows: YSheet, onChange: (grid: Grid) => void, canEdit: () => boolean): () => void {
  const handler = (_events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
    if (tr.origin !== REPAIR && canEdit() && repairSheet(rows)) return; // the repair's own change comes next
    onChange(readGrid(rows));
  };
  rows.observeDeep(handler);
  return () => rows.unobserveDeep(handler);
}
