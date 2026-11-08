// The asker's relay of a shared Chip answer (src/rooms/relay.ts): chip-ask, then chip-chunk at most
// four a second (each the whole answer so far, the latest always sent once the gap is over), then
// chip-done at once, and nothing after it.
import { describe, expect, it } from 'vitest';
import { CHIP_ID, ROOM, type ClientMessage } from '../../shared/rooms';
import { CHUNK_GAP_MS, ChipRelay, newChipId, type Clock } from '../../src/rooms/relay';

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 1_000;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > until) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = until;
  };
  return { clock, advance, pending: () => timers.length };
}

describe('the shared Chip relay', () => {
  it('makes ids the server accepts', () => {
    const a = newChipId();
    expect(CHIP_ID.test(a)).toBe(true);
    expect(newChipId()).not.toBe(a);
  });

  it('keeps chunks at least the server’s gap apart, and sends the latest after a gap', () => {
    const sent: ClientMessage[] = [];
    const { clock, advance } = fakeClock();
    const relay = new ChipRelay((m) => sent.push(m), clock);
    expect(CHUNK_GAP_MS).toBeGreaterThanOrEqual(ROOM.chipChunkGapMs);
    relay.ask('q1', 'Why is the sky blue?');
    relay.chunk('q1', 'B');
    relay.chunk('q1', 'Be');
    relay.chunk('q1', 'Bec');
    advance(100);
    relay.chunk('q1', 'Beca');
    expect(sent).toEqual([
      { t: 'chip-ask', id: 'q1', text: 'Why is the sky blue?' },
      { t: 'chip-chunk', id: 'q1', text: 'B' },
    ]);
    advance(CHUNK_GAP_MS);
    // The newest text, once, when the gap is over.
    expect(sent.slice(2)).toEqual([{ t: 'chip-chunk', id: 'q1', text: 'Beca' }]);
    advance(CHUNK_GAP_MS * 3);
    expect(sent).toHaveLength(3);
    relay.chunk('q1', 'Because');
    expect(sent.at(-1)).toEqual({ t: 'chip-chunk', id: 'q1', text: 'Because' });
  });

  it('sends at most four chunks a second, however fast the answer streams', () => {
    const sent: ClientMessage[] = [];
    const { clock, advance } = fakeClock();
    const relay = new ChipRelay((m) => sent.push(m), clock);
    let text = '';
    for (let ms = 0; ms < 3000; ms += 16) {
      text += 'x';
      relay.chunk('q2', text);
      advance(16);
    }
    const chunks = sent.filter((m) => m.t === 'chip-chunk');
    // Every chunk carries the whole answer so far.
    for (let i = 1; i < chunks.length; i++) expect((chunks[i] as { text: string }).text.length).toBeGreaterThan((chunks[i - 1] as { text: string }).text.length);
    expect(chunks.length).toBeLessThanOrEqual(Math.ceil(3000 / ROOM.chipChunkGapMs));
    expect(chunks.length).toBeGreaterThanOrEqual(10);
  });

  it('sends chip-done at once with the final text, and nothing after it', () => {
    const sent: ClientMessage[] = [];
    const { clock, advance, pending } = fakeClock();
    const relay = new ChipRelay((m) => sent.push(m), clock);
    relay.chunk('q3', 'Hal');
    relay.chunk('q3', 'Half');
    relay.done('q3', 'Half way there.');
    expect(pending()).toBe(0);
    advance(1000);
    relay.chunk('q3', 'late');
    relay.done('q3', 'again');
    expect(sent).toEqual([
      { t: 'chip-chunk', id: 'q3', text: 'Hal' },
      { t: 'chip-done', id: 'q3', text: 'Half way there.' },
    ]);
  });

  it('keeps each question’s gap to itself, and to the server’s limits', () => {
    const sent: ClientMessage[] = [];
    const { clock } = fakeClock();
    const relay = new ChipRelay((m) => sent.push(m), clock);
    relay.chunk('a', '1');
    relay.chunk('b', '1');
    expect(sent.map((m) => (m as { id: string }).id)).toEqual(['a', 'b']);
    relay.ask('c', 'q'.repeat(ROOM.chipQuestionChars + 50));
    relay.done('c', 'a'.repeat(ROOM.chipAnswerChars + 50));
    expect((sent[2] as { text: string }).text).toHaveLength(ROOM.chipQuestionChars);
    expect((sent[3] as { text: string }).text).toHaveLength(ROOM.chipAnswerChars);
  });
});
