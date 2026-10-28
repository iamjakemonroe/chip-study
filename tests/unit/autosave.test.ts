import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosaver, countWords, type SaveAnswer } from '../../src/lib/autosave.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A pretend server that keeps a version, and can be made to fail or to be ahead. */
function server() {
  const s = {
    version: 1,
    saved: [] as string[],
    fail: 0,
    calls: 0,
    async save(text: string, version: number): Promise<SaveAnswer> {
      s.calls += 1;
      if (s.fail > 0) {
        s.fail -= 1;
        throw new Error('offline');
      }
      if (version !== s.version) return { ok: false, version: s.version };
      s.version += 1;
      s.saved.push(text);
      return { ok: true, version: s.version };
    },
  };
  return s;
}

describe('autosave', () => {
  it('waits for a quiet moment, then saves the latest text once', async () => {
    const s = server();
    const states: string[] = [];
    const a = new Autosaver<string>(1, { save: s.save, delay: 800, onState: (x) => states.push(x) });
    a.change('H');
    a.change('He');
    await vi.advanceTimersByTimeAsync(500);
    a.change('Hello');
    expect(s.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(s.saved).toEqual(['Hello']);
    expect(a.version).toBe(2);
    expect(a.state).toBe('saved');
    expect(states).toEqual(['pending', 'saving', 'saved']);
  });

  it('saves every few seconds while typing never stops', async () => {
    const s = server();
    const a = new Autosaver<string>(1, { save: s.save, delay: 800, maxWait: 3000 });
    for (let i = 0; i < 20; i++) {
      a.change(`text ${i}`);
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(s.saved.length).toBeGreaterThanOrEqual(1);
    expect(s.saved[0]).toBe('text 9');
  });

  it('keeps every change on the device as it happens', () => {
    const kept: string[] = [];
    const a = new Autosaver<string>(1, { save: server().save, backup: (t) => kept.push(t) });
    a.change('a');
    a.change('ab');
    expect(kept).toEqual(['a', 'ab']);
  });

  it('a change during a save is saved after it, over the new version', async () => {
    const s = server();
    let release!: () => void;
    const slow = (text: string, version: number) =>
      new Promise<SaveAnswer>((resolve) => {
        release = () => void s.save(text, version).then(resolve);
      });
    const a = new Autosaver<string>(1, { save: slow, delay: 100 });
    a.change('first');
    await vi.advanceTimersByTimeAsync(100);
    a.change('second');
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.state).toBe('pending');
    a['options'].save = s.save;
    await vi.advanceTimersByTimeAsync(100);
    expect(s.saved).toEqual(['first', 'second']);
    expect(a.version).toBe(3);
  });

  it('offline: keeps the text and tries again, further apart', async () => {
    const s = server();
    s.fail = 2;
    const a = new Autosaver<string>(1, { save: s.save, delay: 100, backoff: [1000, 4000] });
    a.change('draft');
    await vi.advanceTimersByTimeAsync(100);
    expect(a.state).toBe('retrying');
    a.change('draft 2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.calls).toBe(2);
    expect(a.state).toBe('retrying');
    await vi.advanceTimersByTimeAsync(3999);
    expect(s.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.saved).toEqual(['draft 2']);
    expect(a.state).toBe('saved');
  });

  it("a newer version on the server stops it instead of writing over it", async () => {
    const s = server();
    s.version = 5;
    const a = new Autosaver<string>(1, { save: s.save, delay: 100 });
    a.change('mine');
    await vi.advanceTimersByTimeAsync(100);
    expect(a.state).toBe('conflict');
    expect(a.theirs).toBe(5);
    a.change('mine, more');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.saved).toEqual([]);
    await a.resolve('mine');
    expect(s.saved).toEqual(['mine, more']);
    expect(a.version).toBe(6);
    expect(a.state).toBe('saved');
  });

  it('or takes theirs and drops this text', async () => {
    const s = server();
    s.version = 3;
    const a = new Autosaver<string>(1, { save: s.save, delay: 100 });
    a.change('mine');
    await vi.advanceTimersByTimeAsync(100);
    await a.resolve('theirs');
    expect(a.version).toBe(3);
    expect(a.unsaved).toBe(false);
    expect(a.state).toBe('saved');
  });

  it('flush saves straight away, and waits for one already going', async () => {
    const s = server();
    const a = new Autosaver<string>(1, { save: s.save, delay: 5000 });
    a.change('leaving');
    await a.flush();
    expect(s.saved).toEqual(['leaving']);
    await a.flush();
    expect(s.calls).toBe(1);
  });

  it('stops for good once disposed', async () => {
    const s = server();
    const a = new Autosaver<string>(1, { save: s.save, delay: 100 });
    a.change('x');
    a.dispose();
    a.change('y');
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.calls).toBe(0);
  });

  it('saves on while a screen still holds it (set up, taken down, set up again)', async () => {
    const s = server();
    const a = new Autosaver<string>(1, { save: s.save, delay: 100 });
    a.hold();
    // Taken down: its last flush lets go only after the screen is set up again.
    const letGo = a.flush().finally(() => a.release());
    a.hold();
    await letGo;
    a.change('still saving');
    await vi.advanceTimersByTimeAsync(200);
    expect(s.saved).toEqual(['still saving']);
    // The last screen goes: it stops.
    a.release();
    a.change('after');
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.saved).toEqual(['still saving']);
  });
});

describe('word count', () => {
  it('counts words like a marker would', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  Hello,   world!  ')).toBe(2);
    expect(countWords("It's a well-known fact — 42 times.")).toBe(6);
    expect(countWords('Café naïve résumé')).toBe(3);
    expect(countWords('e.g. U.K. 3.14')).toBe(3);
  });
});
