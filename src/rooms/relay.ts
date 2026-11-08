import { CHIP_ID, ROOM, type ClientMessage } from '../../shared/rooms.ts';

/** The asker's side of the room's shared Chip (docs/rooms.md, "Chip in a room"): while Chip streams
 * an answer, its screen relays it on the room socket as `chip-ask`, then `chip-chunk` (each one the
 * whole answer so far, at most four a second), then `chip-done` with the final text. The server
 * drops a chunk that comes less than 250 ms after the last, so chunks here are a little further
 * apart than that, and the last change before a gap is always sent when the gap is over. */

export const CHUNK_GAP_MS = ROOM.chipChunkGapMs + 10;

export interface Clock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

/** A new question's id: 1 to 64 of A-Z a-z 0-9 _ - (CHIP_ID), new each time. */
export function newChipId(): string {
  const id = `q${crypto.randomUUID().replace(/-/g, '')}`;
  return CHIP_ID.test(id) ? id : `q${Date.now().toString(36)}`;
}

export class ChipRelay {
  private last = new Map<string, number>();
  private pending = new Map<string, { text: string; timer: unknown }>();
  private finished = new Set<string>();

  constructor(
    private send: (msg: ClientMessage) => void,
    private clock: Clock = realClock,
    private gap = CHUNK_GAP_MS,
  ) {}

  ask(id: string, question: string): void {
    this.send({ t: 'chip-ask', id, text: question.slice(0, ROOM.chipQuestionChars) });
  }

  /** The answer so far: sent now, or when the gap since the last one is over. */
  chunk(id: string, answer: string): void {
    if (this.finished.has(id)) return;
    const text = answer.slice(0, ROOM.chipAnswerChars);
    const now = this.clock.now();
    const last = this.last.get(id);
    const waiting = this.pending.get(id);
    if (last === undefined || now - last >= this.gap) {
      if (waiting) {
        this.clock.clearTimeout(waiting.timer);
        this.pending.delete(id);
      }
      this.last.set(id, now);
      this.send({ t: 'chip-chunk', id, text });
      return;
    }
    if (waiting) {
      waiting.text = text;
      return;
    }
    const timer = this.clock.setTimeout(
      () => {
        const p = this.pending.get(id);
        this.pending.delete(id);
        if (!p || this.finished.has(id)) return;
        this.last.set(id, this.clock.now());
        this.send({ t: 'chip-chunk', id, text: p.text });
      },
      this.gap - (now - last),
    );
    this.pending.set(id, { text, timer });
  }

  /** The final answer: always sent, at once, and nothing after it. */
  done(id: string, answer: string): void {
    if (this.finished.has(id)) return;
    const waiting = this.pending.get(id);
    if (waiting) this.clock.clearTimeout(waiting.timer);
    this.pending.delete(id);
    this.last.delete(id);
    this.finished.add(id);
    this.send({ t: 'chip-done', id, text: answer.slice(0, ROOM.chipAnswerChars) });
  }

  stop(): void {
    for (const p of this.pending.values()) this.clock.clearTimeout(p.timer);
    this.pending.clear();
  }
}
