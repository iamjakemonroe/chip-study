/** A room client for the integration test: a real WebSocket to the room server, a Y.Doc synced
 * over y-protocols the way the screens will sync it, awareness, and the JSON messages. */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { FRAME, type ClientMessage, type ServerMessage } from '../../shared/rooms';

export async function api(base: string, path: string, token: string | null, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

export async function ticket(base: string, roomId: string, token: string): Promise<string> {
  const r = await api(base, `/api/rooms/${roomId}/ticket`, token, { method: 'POST' });
  if (r.status !== 200) throw new Error(`ticket: ${r.status} ${JSON.stringify(r.json)}`);
  return String(r.json.ticket);
}

const SERVER = 'server';

export class RoomClient {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly messages: ServerMessage[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: (() => void)[] = [];
  private constructor(
    readonly name: string,
    readonly ws: WebSocket,
  ) {
    ws.binaryType = 'arraybuffer';
    this.closed = new Promise((resolve) => ws.addEventListener('close', (e) => resolve({ code: e.code, reason: e.reason })));
    ws.addEventListener('message', (e) => this.onMessage(e.data as string | ArrayBuffer));
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === SERVER) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, FRAME.sync);
      syncProtocol.writeUpdate(enc, update);
      this.sendBytes(encoding.toUint8Array(enc));
    });
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === SERVER) return;
      const changed = [...added, ...updated, ...removed].filter((id) => id === this.doc.clientID);
      if (!changed.length) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, FRAME.awareness);
      encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(this.awareness, changed));
      this.sendBytes(encoding.toUint8Array(enc));
    });
    this.awareness.setLocalState(null);
  }

  /** Opens the room socket with [ticketValue] and waits for it to open (or close). */
  static open(name: string, base: string, roomId: string, ticketValue: string): Promise<RoomClient> {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/rooms/${roomId}/ws?ticket=${encodeURIComponent(ticketValue)}`);
    const client = new RoomClient(name, ws);
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => {
        // Sync step 1: ask for the room's document.
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, FRAME.sync);
        syncProtocol.writeSyncStep1(enc, client.doc);
        client.sendBytes(encoding.toUint8Array(enc));
        resolve(client);
      });
      ws.addEventListener('error', () => reject(new Error(`${name}: the socket failed to open`)));
    });
  }

  /** Gets a ticket and joins; waits for hello. */
  static async join(name: string, base: string, roomId: string, token: string): Promise<RoomClient> {
    const client = await RoomClient.open(name, base, roomId, await ticket(base, roomId, token));
    await client.next('hello');
    return client;
  }

  private onMessage(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      if (data !== 'pong') this.messages.push(JSON.parse(data) as ServerMessage);
    } else {
      const d = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(d);
      if (type === FRAME.sync) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, FRAME.sync);
        syncProtocol.readSyncMessage(d, enc, this.doc, SERVER);
        if (encoding.length(enc) > 1) this.sendBytes(encoding.toUint8Array(enc));
      } else if (type === FRAME.awareness) {
        applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(d), SERVER);
      }
    }
    for (const w of this.waiters.splice(0)) w();
  }

  send(msg: ClientMessage | 'ping'): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  sendBytes(bytes: Uint8Array): void {
    // lib0 hands out Uint8Array<ArrayBufferLike>; these are always plain ArrayBuffers.
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(bytes as Uint8Array<ArrayBuffer>);
  }

  /** Waits until [check] holds (re-checked on every message), or fails after [ms]. */
  async until<T>(what: string, check: () => T | undefined | null | false, ms = 8_000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = check();
      if (v) return v;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`${this.name}: timed out waiting for ${what}; got ${JSON.stringify(this.messages.slice(-5))}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(left, 100));
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** The next message of type [t] (after [from]) that matches [match]. */
  next<T extends ServerMessage['t']>(t: T, match: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms?: number, from = 0): Promise<Extract<ServerMessage, { t: T }>> {
    return this.until(`a "${t}" message`, () => this.messages.slice(from).find((m): m is Extract<ServerMessage, { t: T }> => m.t === t && match(m as Extract<ServerMessage, { t: T }>)), ms);
  }

  /** Everything received so far of type [t]. */
  all<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  }

  close(): void {
    this.awareness.destroy();
    try {
      this.ws.close(1000, 'done');
    } catch {
      // already closed
    }
  }
}
