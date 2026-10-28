/** Saving a document as the student writes, without them ever thinking about it.
 *
 * A save goes a moment after they stop typing (or every few seconds while they keep going), one
 * at a time, over the version they have. If the server has a newer version (the document was
 * saved from another tab or device) it stops and says so, rather than writing over it. If the
 * connection drops it keeps the latest text and tries again, further apart each time; every
 * change is also kept on the device as it happens, so nothing is lost if the tab closes. */

export type SaveState = 'saved' | 'pending' | 'saving' | 'retrying' | 'conflict';

export type SaveAnswer = { ok: boolean; version: number };

export interface AutosaverOptions<T> {
  /** Saves [snapshot] over [version]: ok with the new version, or not ok with the one there. */
  save: (snapshot: T, version: number) => Promise<SaveAnswer>;
  /** Quiet time before saving (ms). */
  delay?: number;
  /** The longest a change waits while typing carries on (ms). */
  maxWait?: number;
  /** Waits between tries when saving fails (ms); the last repeats. */
  backoff?: number[];
  onState?: (state: SaveState) => void;
  /** Keeps the latest snapshot on the device, on every change. */
  backup?: (snapshot: T) => void;
}

export class Autosaver<T> {
  private latest: T | null = null;
  private dirty = false;
  private saving: Promise<void> | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private longest: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private stopped = false;
  private current: SaveState = 'saved';
  /** The version the server has when there's a conflict. */
  theirs: number | null = null;

  constructor(
    public version: number,
    private readonly options: AutosaverOptions<T>,
  ) {}

  get state(): SaveState {
    return this.current;
  }

  get unsaved(): boolean {
    return this.dirty || this.saving !== null;
  }

  private set(state: SaveState) {
    if (this.current === state) return;
    this.current = state;
    this.options.onState?.(state);
  }

  /** The document changed: [snapshot] is how it is now. */
  change(snapshot: T) {
    if (this.stopped) return;
    this.latest = snapshot;
    this.dirty = true;
    this.options.backup?.(snapshot);
    if (this.current === 'conflict') return;
    if (this.current !== 'saving' && this.current !== 'retrying') this.set('pending');
    if (this.current === 'retrying') return;
    this.schedule(this.options.delay ?? 900);
  }

  private schedule(wait: number) {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.run(), wait);
    if (!this.longest) this.longest = setTimeout(() => void this.run(), this.options.maxWait ?? 5000);
  }

  private clearTimers() {
    if (this.idle) clearTimeout(this.idle);
    if (this.longest) clearTimeout(this.longest);
    this.idle = null;
    this.longest = null;
  }

  private run(): Promise<void> {
    if (this.saving) return this.saving;
    if (!this.dirty || this.stopped || this.current === 'conflict' || this.latest === null) return Promise.resolve();
    this.clearTimers();
    const snapshot = this.latest;
    this.dirty = false;
    this.set('saving');
    this.saving = (async () => {
      try {
        const answer = await this.options.save(snapshot, this.version);
        if (!answer.ok) {
          this.dirty = true;
          this.theirs = answer.version;
          this.set('conflict');
          return;
        }
        this.version = answer.version;
        this.failures = 0;
        if (this.dirty) {
          this.set('pending');
          this.schedule(this.options.delay ?? 900);
        } else {
          this.set('saved');
        }
      } catch {
        this.dirty = true;
        this.failures += 1;
        const steps = this.options.backoff ?? [1000, 2000, 5000, 10000, 20000];
        this.set('retrying');
        this.clearTimers();
        this.idle = setTimeout(() => {
          this.idle = null;
          void this.run();
        }, steps[Math.min(this.failures - 1, steps.length - 1)]);
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  /** Saves now if anything's waiting (leaving the page, switching documents). */
  async flush(): Promise<void> {
    if (this.saving) await this.saving;
    if (this.dirty && this.current !== 'conflict') await this.run();
  }

  /** After a conflict: 'mine' saves this text over theirs; 'theirs' drops this text (the caller
   * loads theirs, at [version]). */
  resolve(choice: 'mine' | 'theirs', version = this.theirs ?? this.version) {
    this.version = version;
    this.theirs = null;
    if (choice === 'theirs') {
      this.dirty = false;
      this.set('saved');
      return Promise.resolve();
    }
    this.set('pending');
    return this.run();
  }

  dispose() {
    this.stopped = true;
    this.clearTimers();
  }
}

/** A word count the way a marker counts: anything with a letter or digit between spaces. */
export function countWords(text: string): number {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.]*/gu);
  return words ? words.length : 0;
}
