import { site } from '../content/site.ts';

/** Invite a friend: a link with ?ref=CODE is kept on the device from whatever page it lands on,
 * through signing in, and used once by the new account (study_referral_redeem). Nothing here
 * talks to the server, so the landing page stays light. */

const KEY = 'chip-study-ref';
/** Kept this long: an account can only say who brought it in its first 14 days anyway. */
const KEEP_MS = 30 * 86_400_000;
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/** The invite code in an address's query, if it's one: "?ref=abcd2345" is ABCD2345. */
export function referralFrom(search: string): string | null {
  const raw = new URLSearchParams(search).get('ref');
  const code = raw?.trim().toUpperCase() ?? '';
  return CODE.test(code) ? code : null;
}

export function referralLink(code: string): string {
  return `${site.url}/?ref=${code}`;
}

export function keepReferral(code: string, now = Date.now()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: now }));
  } catch {
    // Private mode: the friend just isn't credited.
  }
}

/** The code waiting to be used, if there is one and it isn't too old. */
export function pendingReferral(now = Date.now()): string | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { code?: string; at?: number } | null;
    if (!kept?.code || !CODE.test(kept.code) || typeof kept.at !== 'number' || now - kept.at > KEEP_MS) {
      if (kept) localStorage.removeItem(KEY);
      return null;
    }
    return kept.code;
  } catch {
    return null;
  }
}

export function dropReferral() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

/** Keeps the page's ?ref= code (if any) and takes it out of the address. */
export function captureReferral() {
  const code = referralFrom(location.search);
  if (!code) return;
  keepReferral(code);
  const url = new URL(location.href);
  url.searchParams.delete('ref');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

/** The server's reasons a code can't be used, which are nobody's business to see: a code that
 * isn't one, your own, one already used, or an account older than 14 days. */
export function quietReferralError(raw: string): boolean {
  return /no such code|your own code|already referred|too late/.test(raw);
}
