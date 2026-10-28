/** Where the sign-in is kept on the device, and a quick look at whether there is one, without
 * loading the Supabase client (the landing page stays light). */
export const AUTH_KEY = 'chip-study-auth';

export function hasSession(): boolean {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw) as { refresh_token?: string };
    return !!s?.refresh_token;
  } catch {
    return false;
  }
}
