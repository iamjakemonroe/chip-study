import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';
import { getMe } from '../lib/api.ts';
import { supabase } from '../lib/supabase.ts';
import type { Me } from '../lib/types.ts';

interface AuthState {
  ready: boolean;
  session: Session | null;
  me: Me | null;
  refresh: () => Promise<Me | null>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  session: null,
  me: null,

  refresh: async () => {
    if (!get().session) {
      set({ me: null });
      return null;
    }
    try {
      const me = await getMe();
      set({ me });
      return me;
    } catch {
      return get().me;
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, me: null });
  },
}));

let started = false;

/** Follows the sign-in for the whole app. Called once, as the app starts. */
export function startAuth() {
  if (started) return;
  started = true;
  void supabase.auth.getSession().then(({ data }) => {
    useAuth.setState({ session: data.session, ready: true });
    void useAuth.getState().refresh();
  });
  supabase.auth.onAuthStateChange((event, session) => {
    const before = useAuth.getState().session?.user.id;
    useAuth.setState({ session, ready: true });
    if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || session?.user.id !== before) {
      void useAuth.getState().refresh();
    }
  });
}

/** Sends the sign-in code. A new email makes a new Kaivon account (it works in Utopia too). */
export async function sendCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw new Error(friendly(error.message));
}

export async function verifyCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) {
    throw new Error(/expired|invalid/i.test(error.message) ? 'That code didn’t work. Check it, or send a new one.' : friendly(error.message));
  }
}

function friendly(message: string): string {
  if (/rate limit|security purposes|only request this after/i.test(message)) return 'Hang on a minute before asking for another code.';
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(message)) return 'That email doesn’t look right.';
  if (/fetch|network/i.test(message)) return 'You seem to be offline. Check your connection.';
  return 'Something went wrong. Try again in a moment.';
}
