/// <reference lib="webworker" />
/** Runs a .sql file in SQLite (sql.js, WebAssembly), in a fresh database each run: CREATE, INSERT,
 * then SELECT, all in one file, the way a student practises. Each query's rows come back as a
 * table; other statements say what they did. */

import initSqlJs from 'sql.js';
import wasm from 'sql.js/dist/sql-wasm-browser.wasm?url';
import type { RunEvent, RunRequest } from './runner.ts';

declare const self: DedicatedWorkerGlobalScope;

const MAX_ROWS = 500;
let run = 0;
const post = (e: RunEvent) => self.postMessage({ run, ...e });

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  run = e.data.run;
  const started = performance.now();
  let current = '';
  let rest: (() => string) | null = null;
  try {
    const SQL = await initSqlJs({ locateFile: () => wasm });
    const db = new SQL.Database();
    try {
      const statements = db.iterateStatements(e.data.main.code);
      rest = () => statements.getRemainingSQL();
      for (const stmt of statements) {
        current = stmt.getSQL().trim();
        const columns = stmt.getColumnNames();
        if (columns.length) {
          const rows: unknown[][] = [];
          let more = 0;
          while (stmt.step()) {
            if (rows.length < MAX_ROWS) rows.push(stmt.get().map((v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v)));
            else more++;
          }
          post({ type: 'table', columns, rows, more });
        } else {
          stmt.step();
          const verb = /^\s*(\w+(?:\s+(?:TABLE|VIEW|INDEX|TRIGGER))?)/i.exec(current)?.[1].toUpperCase() ?? 'Done';
          const changed = /^(INSERT|UPDATE|DELETE|REPLACE)/.test(verb) ? db.getRowsModified() : null;
          post({ type: 'note', text: changed === null ? `✓ ${verb}` : `✓ ${verb}: ${changed} row${changed === 1 ? '' : 's'}` });
        }
        stmt.free();
        current = '';
      }
      post({ type: 'done', ms: performance.now() - started });
    } catch (err) {
      // A statement that wouldn't prepare is the start of what's left (read before the database
      // closes).
      const bad = current || rest?.().trim().split(/;\s*\n/)[0] || '';
      throw new Error(`${(err as Error).message}${bad ? `\n  in: ${bad.length > 160 ? `${bad.slice(0, 160)}…` : bad}` : ''}`);
    } finally {
      db.close();
    }
  } catch (err) {
    post({ type: 'error', text: (err as Error).message, ms: performance.now() - started });
  }
};
