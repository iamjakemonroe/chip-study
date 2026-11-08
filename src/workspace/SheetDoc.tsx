import { ClipboardCopy, Columns3, Download, FileInput, Minus, Plus, Rows3 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { colName, evaluate, show, toCsv, type Grid } from '../lib/sheet.ts';
import type { StudyDocument } from '../lib/types.ts';
import { toast } from '../store/toast.ts';
import { useRoomBinding } from './roomBinding.ts';
import { editors, useWorkspace } from './store.ts';
import { useSaver } from './useSaver.ts';

const MAX_ROWS = 200;
const MAX_COLS = 26;

const blank = (rows: number, cols: number): Grid => Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A small table with formulas, for data, budgets and results. It can go into the document as a
 * table. In a study room it's the room's shared sheet, changed cell by cell, live. */
export default function SheetDoc({ doc }: { doc: StudyDocument }) {
  const room = useRoomBinding();
  const canEdit = room ? room.canEdit : true;
  const live = useMemo(() => room?.sheet(doc.id) ?? null, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { saver } = useSaver(doc, { off: !!room });
  const start = (live ? { rows: live.read(), header: live.header() } : doc.content) as { rows?: Grid; header?: boolean };
  const [grid, setGrid] = useState<Grid>(() => (start.rows?.length ? start.rows : blank(8, 5)));
  const [header, setHeader] = useState(start.header ?? true);
  const [editing, setEditing] = useState<string | null>(null);
  const values = useMemo(() => evaluate(grid), [grid]);
  const latest = useRef({ grid, header, values });
  latest.current = { grid, header, values };

  useEffect(() => {
    if (!live) return;
    const show = () => {
      const rows = live.read();
      setGrid(rows.length ? rows : blank(1, 1));
      setHeader(live.header());
    };
    show();
    return live.watch(show);
  }, [live]);

  useEffect(() => {
    editors.doc = null;
    editors.text = () => `Table "${doc.title}" (CSV, worked-out values):\n${toCsv(latest.current.values)}`;
    return () => {
      editors.text = () => '';
    };
  }, [doc.id, doc.title]);

  const commit = (next: Grid, nextHeader = header) => {
    setGrid(next);
    setHeader(nextHeader);
    saver.change(() => {
      const csv = toCsv(evaluate(next));
      return { content: { rows: next, header: nextHeader }, text: csv, words: 0, chipWords: 0 };
    });
  };

  const setCell = (r: number, c: number, v: string) => (live ? live.setCell(r, c, v) : commit(grid.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row))));
  const addRow = () => (live ? live.addRow() : commit([...grid, Array.from({ length: grid[0]?.length ?? 0 }, () => '')]));
  const addColumn = () => (live ? live.addColumn() : commit(grid.map((row) => [...row, ''])));
  const removeRow = () => (live ? live.removeRow() : commit(grid.slice(0, -1)));
  const removeColumn = () => (live ? live.removeColumn() : commit(grid.map((row) => row.slice(0, -1))));
  const setHead = (on: boolean) => (live ? live.setHeader(on) : commit(grid, on));
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  const tableHtml = () => {
    const cell = (v: string, h: boolean) => (h ? `<th><p>${escape(v)}</p></th>` : `<td><p>${escape(v)}</p></td>`);
    return `<table>${values.map((row, r) => `<tr>${row.map((v) => cell(show(v), header && r === 0)).join('')}</tr>`).join('')}</table>`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-line/70 bg-white/80 px-3 py-2 backdrop-blur">
        <button className="btn btn-quiet btn-sm h-8 flex-none" disabled={!canEdit || rows >= MAX_ROWS} onClick={addRow}>
          <Rows3 size={15} /> <Plus size={12} /> Row
        </button>
        <button className="btn btn-quiet btn-sm h-8 flex-none" disabled={!canEdit || cols >= MAX_COLS} onClick={addColumn}>
          <Columns3 size={15} /> <Plus size={12} /> Column
        </button>
        <button className="btn btn-quiet btn-sm h-8 flex-none" disabled={!canEdit || rows <= 1} onClick={removeRow} aria-label="Remove the last row">
          <Rows3 size={15} /> <Minus size={12} />
        </button>
        <button className="btn btn-quiet btn-sm h-8 flex-none" disabled={!canEdit || cols <= 1} onClick={removeColumn} aria-label="Remove the last column">
          <Columns3 size={15} /> <Minus size={12} />
        </button>
        <label className="ml-1 flex flex-none items-center gap-2 text-sm font-medium text-ink-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-iris)]" checked={header} disabled={!canEdit} onChange={(e) => setHead(e.target.checked)} /> Header row
        </label>
        <span className="flex-1" />
        <button
          className="btn btn-quiet btn-sm h-8 flex-none"
          onClick={() => {
            void navigator.clipboard?.writeText(toCsv(values));
            toast('Copied as CSV.', 'info');
          }}
        >
          <ClipboardCopy size={15} /> Copy
        </button>
        <button
          className="btn btn-quiet btn-sm h-8 flex-none"
          onClick={async () => {
            const { download, fileName } = await import('../lib/exports.ts');
            download(toCsv(values), fileName(doc.title, 'csv'), 'text/csv;charset=utf-8');
          }}
        >
          <Download size={15} /> CSV
        </button>
        {canEdit && <button
          className="btn btn-ghost btn-sm h-8 flex-none"
          onClick={() => {
            const main = useWorkspace.getState().docs.find((d) => d.kind === 'doc');
            if (!main) return toast('Add a document first.', 'info');
            editors.pending = tableHtml();
            useWorkspace.setState({ activeDoc: main.id });
          }}
        >
          <FileInput size={15} /> {room ? 'Put in the document' : 'Put in my document'}
        </button>}
      </div>
      <div className="scroll-soft min-h-0 flex-1 overflow-auto bg-white/60 p-4">
        <table className="sheet border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sheet-corner" />
              {grid[0]?.map((_, c) => (
                <th key={c} className="sheet-col">
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, r) => (
              <tr key={r}>
                <th className="sheet-row">{r + 1}</th>
                {row.map((raw, c) => {
                  const id = `${r}:${c}`;
                  const v = values[r][c];
                  const isNum = typeof v === 'number';
                  const err = typeof v === 'string' && v.startsWith('#');
                  return (
                    <td key={c} className={`sheet-cell ${header && r === 0 ? 'is-head' : ''}`}>
                      <input
                        aria-label={`Cell ${colName(c)}${r + 1}`}
                        className={`${isNum && editing !== id ? 'text-right tabular-nums' : ''} ${err ? 'text-rose' : ''}`}
                        value={editing === id ? raw : show(v)}
                        readOnly={!canEdit}
                        onFocus={() => setEditing(id)}
                        onBlur={() => setEditing(null)}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const next = document.querySelector<HTMLInputElement>(`[aria-label="Cell ${colName(c)}${r + 2}"]`);
                            next?.focus();
                          }
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-ink-3">Formulas start with =, like =SUM(B2:B8), =AVERAGE(C2:C5) or =B2*1.2. Also MIN, MAX, COUNT, MEDIAN, ROUND, SQRT and ^.</p>
      </div>
    </div>
  );
}
