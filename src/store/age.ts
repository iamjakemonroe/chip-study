import { create } from 'zustand';
import { ageConfirm, ageGet } from '../lib/api.ts';
import type { AgeAnswer } from '../lib/types.ts';
import { useAuth } from './auth.ts';

interface AgeState {
  /** What the account said: null if it hasn't been asked yet, undefined until known (or if it
   * couldn't be asked: never in anyone's way). */
  answer: AgeAnswer | null | undefined;
  /** The question is showing. */
  asking: boolean;
  /** Not now: the one-time question waits for the next visit. */
  later: boolean;
  /** What to do once it's answered (a join that was waiting for it). */
  then: (() => void) | null;
  load: () => Promise<AgeAnswer | null | undefined>;
  /** Asks now if it hasn't been answered; runs [then] once it has (straight away if it already
   * was). Answers whether it was already answered. */
  ensure: (then?: () => void) => Promise<boolean>;
  confirm: (answer: AgeAnswer) => Promise<void>;
  close: () => void;
}

let asking: Promise<AgeAnswer | null | undefined> | null = null;
let forUser: string | null = null;

/** The age rule: 13 and over, and under 18 with a parent or guardian's agreement. Asked once, after
 * signing in, and before joining an institution if it hasn't been yet. */
export const useAge = create<AgeState>((set, get) => ({
  answer: undefined,
  asking: false,
  later: false,
  then: null,

  load: () => {
    const user = useAuth.getState().session?.user.id ?? null;
    if (!user) return Promise.resolve(undefined);
    if (forUser === user && (asking || get().answer !== undefined)) return asking ?? Promise.resolve(get().answer);
    forUser = user;
    const run = ageGet()
      .then((answer) => {
        if (forUser === user) set({ answer });
        return answer as AgeAnswer | null;
      })
      .catch(() => undefined)
      .finally(() => {
        if (asking === run) asking = null;
      });
    asking = run;
    return run;
  },

  ensure: async (then) => {
    const answer = await get().load();
    if (answer === null) {
      set({ asking: true, then: then ?? null });
      return false;
    }
    then?.();
    return true;
  },

  confirm: async (answer) => {
    await ageConfirm(answer);
    const then = get().then;
    set({ answer, asking: false, then: null });
    then?.();
  },

  close: () => set({ asking: false, later: true, then: null }),
}));

useAuth.subscribe((s, before) => {
  if (s.session?.user.id === before.session?.user.id) return;
  forUser = null;
  asking = null;
  useAge.setState({ answer: undefined, asking: false, later: false, then: null });
});
