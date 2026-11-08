import { CLOSE, type ClientMessage, type ServerMessage } from '../../shared/rooms.ts';
import { RoomServerError } from './errors.ts';

/** The room socket (docs/rooms.md, "Room socket"): a fresh ticket for every connection, reconnects
 * on its own with growing gaps (straight away when the device comes back online), a "ping" about
 * every 20 seconds, binary frames for Yjs and text frames for JSON. It says how long it was away
 * each time it comes back, so media can start again after a long gap. */

export type SocketState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Why the socket stopped for good. */
export type SocketEnd = 'ended' | 'removed' | 'full' | 'waiting' | 'not_in_room' | 'unavailable' | 'signed_out';

export interface SocketOptions {
  /** A new ticket (POST /ticket). */
  ticket: () => Promise<string>;
  url: (ticket: string) => string;
  /** A fresh sign-in, when the room server says the old one has run out. */
  refreshSignIn?: () => Promise<boolean>;
  WebSocketImpl?: typeof WebSocket;
  pingMs?: number;
}

export const PING_MS = 20_000;
const BACKOFF = [400, 1000, 2000, 4000, 8000, 12_000];

export class RoomSocket {
  state: SocketState = 'connecting';
  onState?: (s: SocketState) => void;
  /** The socket is open; [awayMs] is how long it was closed (null the first time). */
  onOpen?: (awayMs: number | null) => void;
  onMessage?: (m: ServerMessage) => void;
  onBinary?: (bytes: Uint8Array) => void;
  onEnd?: (why: SocketEnd) => void;

  private ws: WebSocket | null = null;
  private stopped = false;
  private tries = 0;
  private badTickets = 0;
  private closedAt: number | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private readonly onOnline = () => {
    if (this.state === 'reconnecting' && !this.ws) this.connectSoon(0);
  };

  constructor(private opts: SocketOptions) {}

  start(): void {
    this.stopped = false;
    window.addEventListener('online', this.onOnline);
    void this.connect();
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage | 'ping'): boolean {
    if (!this.open) return false;
    this.ws!.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    return true;
  }

  sendBytes(bytes: Uint8Array): boolean {
    if (!this.open) return false;
    this.ws!.send(bytes as Uint8Array<ArrayBuffer>);
    return true;
  }

  /** Closes this connection and opens a new one (a new ticket, so the server starts afresh). */
  reconnect(): void {
    if (this.stopped) return;
    this.drop();
    this.setState('reconnecting');
    this.connectSoon(0);
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener('online', this.onOnline);
    if (this.retry) clearTimeout(this.retry);
    this.drop(CLOSE.normal);
    this.setState('closed');
  }

  private setState(s: SocketState) {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
  }

  private drop(code: number = CLOSE.normal) {
    this.generation++;
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try {
        ws.close(code, 'bye');
      } catch {
        // Already closing.
      }
    }
    if (this.closedAt === null && ws) this.closedAt = Date.now();
  }

  private end(why: SocketEnd) {
    if (this.stopped) return;
    this.stopped = true;
    window.removeEventListener('online', this.onOnline);
    if (this.retry) clearTimeout(this.retry);
    this.drop();
    this.setState('closed');
    this.onEnd?.(why);
  }

  private connectSoon(ms?: number) {
    if (this.stopped) return;
    if (this.retry) clearTimeout(this.retry);
    const wait = ms ?? BACKOFF[Math.min(this.tries, BACKOFF.length - 1)] * (0.8 + Math.random() * 0.4);
    this.tries++;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // 'online' brings it back
      void this.connect();
    }, wait);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const generation = ++this.generation;
    let ticket: string;
    try {
      ticket = await this.opts.ticket();
    } catch (e) {
      if (this.stopped || generation !== this.generation) return;
      if (e instanceof RoomServerError) {
        if (e.code === 'ended') return this.end('ended');
        if (e.code === 'room_full') return this.end('full');
        if (e.code === 'not_configured') return this.end('unavailable');
        if (e.code === 'not_in_room') return this.end(e.body.state === 'waiting' ? 'waiting' : e.body.state === 'removed' ? 'removed' : 'not_in_room');
        if (e.code === 'unauthorized') {
          const ok = (await this.opts.refreshSignIn?.()) ?? false;
          if (!ok && this.tries > 2) return this.end('signed_out');
        }
      }
      this.setState('reconnecting');
      this.connectSoon();
      return;
    }
    if (this.stopped || generation !== this.generation) return;
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    const ws = new Impl(this.opts.url(ticket));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (generation !== this.generation) return;
      const away = this.closedAt === null ? null : Date.now() - this.closedAt;
      this.closedAt = null;
      this.tries = 0;
      this.badTickets = 0;
      this.setState('open');
      if (this.ping) clearInterval(this.ping);
      this.ping = setInterval(() => this.send('ping'), this.opts.pingMs ?? PING_MS);
      this.onOpen?.(away);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (generation !== this.generation) return;
      if (typeof e.data === 'string') {
        if (e.data === 'pong') return;
        let m: ServerMessage;
        try {
          m = JSON.parse(e.data) as ServerMessage;
        } catch {
          return;
        }
        this.onMessage?.(m);
      } else if (e.data instanceof ArrayBuffer) {
        this.onBinary?.(new Uint8Array(e.data));
      }
    };
    ws.onclose = (e: CloseEvent) => {
      if (generation !== this.generation) return;
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      this.ws = null;
      if (this.closedAt === null) this.closedAt = Date.now();
      if (this.stopped) return;
      switch (e.code) {
        case CLOSE.removed:
          return this.end('removed');
        case CLOSE.ended:
          return this.end('ended');
        case CLOSE.full:
          return this.end('full');
        case CLOSE.badTicket:
          // Used or out of date: a new one at once, unless that keeps happening.
          this.badTickets++;
          this.setState('reconnecting');
          return this.connectSoon(this.badTickets > 3 ? undefined : 0);
        default:
          this.setState('reconnecting');
          this.connectSoon();
      }
    };
    ws.onerror = () => {
      // A close always follows, and handles it.
    };
  }
}
