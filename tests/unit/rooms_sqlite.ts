/** Runs the room's store (worker/store.ts) on node:sqlite, the way a Durable Object's SQL runs it:
 * blobs go in as ArrayBuffers and come out as bytes. */
import { DatabaseSync } from 'node:sqlite';
import type { Row, Sql } from '../../worker/store.ts';

export function memorySql(): Sql & { db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(query: string, ...bindings: unknown[]) {
      const args = bindings.map((b) => (b instanceof ArrayBuffer ? new Uint8Array(b) : b)) as (string | number | null | Uint8Array)[];
      const rows = db.prepare(query).all(...args) as Row[];
      return { toArray: () => rows };
    },
  };
}
