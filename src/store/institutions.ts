import { create } from 'zustand';
import { amStaff, myInstitutions } from '../lib/api.ts';
import type { MyInstitution, SuggestedInstitution } from '../lib/types.ts';
import { useAuth } from './auth.ts';

interface InstitutionsState {
  /** The institutions you're in: null until known. */
  mine: MyInstitution[] | null;
  /** Active institutions with your email's domain that you could join. */
  suggested: SuggestedInstitution[];
  /** Whether you're on Kaivon's staff (and can review institutions). */
  staff: boolean;
  /** Asks once a session (again with [force], after joining or leaving). */
  load: (force?: boolean) => Promise<void>;
}

let asking: Promise<void> | null = null;
let forUser: string | null = null;

const staffKey = (user: string) => `chip-study-staff:${user}`;

/** Whether this account is Kaivon staff, asked once a session (kept for the tab). */
async function askStaff(user: string): Promise<boolean> {
  try {
    const kept = sessionStorage.getItem(staffKey(user));
    if (kept) return kept === '1';
  } catch {
    // No storage: ask.
  }
  try {
    const staff = await amStaff();
    remember(user, staff);
    return staff;
  } catch {
    return false;
  }
}

function remember(user: string, staff: boolean) {
  try {
    sessionStorage.setItem(staffKey(user), staff ? '1' : '0');
  } catch {
    // Asked again next time.
  }
}

/** The institutions side of your account: which you're in, which you could join, and whether
 * you're Kaivon staff. Shared by the top bar, the desk, settings and the plan. */
export const useInstitutions = create<InstitutionsState>((set, get) => ({
  mine: null,
  suggested: [],
  staff: false,

  load: (force = false) => {
    const user = useAuth.getState().session?.user.id ?? null;
    if (!user) return Promise.resolve();
    if (!force && forUser === user && (asking || get().mine !== null)) return asking ?? Promise.resolve();
    forUser = user;
    const run: Promise<void> = Promise.all([myInstitutions(), askStaff(user)])
      .then(([{ mine, suggested }, staff]) => {
        if (forUser === user) set({ mine, suggested, staff });
      })
      .catch(() => undefined)
      .finally(() => {
        if (asking === run) asking = null;
      });
    asking = run;
    return run;
  },
}));

// Someone else signed in (or out): forget the last account's institutions.
useAuth.subscribe((s, before) => {
  if (s.session?.user.id === before.session?.user.id) return;
  forUser = null;
  asking = null;
  useInstitutions.setState({ mine: null, suggested: [], staff: false });
});
