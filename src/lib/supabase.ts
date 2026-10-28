import { createClient } from '@supabase/supabase-js';
import { AUTH_KEY } from './session.ts';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (node scripts/env.mjs).');
}

/** The one Supabase client, on Utopia's project: a Kaivon account works in Utopia, Chip Rizz and
 * here. Sign-in is by an emailed code, so there are no links to read from the address bar. */
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: AUTH_KEY,
  },
});
