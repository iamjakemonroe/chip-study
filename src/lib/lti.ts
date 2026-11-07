/** Arriving from a learning platform (LTI 1.3): the study-lti function sends every outcome to
 * /lti in the address's fragment (never the query, so no server logs it). This reads it, keeps it
 * for the tab (so a sign-in in between doesn't lose it) and takes it out of the address. */

export type LtiArrival =
  | { kind: 'signin'; tokenHash: string; type: string; inst: string | null; cls: string | null; role: string | null; confirm: string | null }
  | { kind: 'link'; token: string }
  | { kind: 'error'; code: string }
  | { kind: 'none' };

const KEY = 'chip-study-lti';
/** A waiting launch lasts an hour on the server; a sign-in link much less. */
const KEEP_MS = 60 * 60_000;

export function parseLtiFragment(hash: string): LtiArrival {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const tokenHash = p.get('token_hash');
  if (tokenHash) {
    return { kind: 'signin', tokenHash, type: p.get('type') ?? 'email', inst: p.get('inst'), cls: p.get('class'), role: p.get('role'), confirm: p.get('confirm') };
  }
  const link = p.get('link');
  if (link) return { kind: 'link', token: link };
  const error = p.get('error');
  if (error) return { kind: 'error', code: error };
  return { kind: 'none' };
}

/** What the page arrived with: from the address (kept, then taken out of it), or as kept for this
 * tab (back from signing in, or read twice). */
export function takeLtiArrival(now = Date.now()): LtiArrival {
  const fresh = parseLtiFragment(location.hash);
  if (fresh.kind !== 'none') {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ at: now, arrival: fresh }));
    } catch {
      // Not kept: fine unless a sign-in comes in between.
    }
    history.replaceState(history.state, '', location.pathname + location.search);
    return fresh;
  }
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { at: number; arrival: LtiArrival } | null;
    if (kept && now - kept.at < KEEP_MS) return kept.arrival;
  } catch {
    // Nothing kept.
  }
  return { kind: 'none' };
}

/** Done with it: a sign-in link can't be used twice anyway. */
export function forgetLtiArrival() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

/** What went wrong, for each code the function can send, in words for a student or a teacher. */
export const LTI_ERRORS: Record<string, { title: string; body: string }> = {
  unknown_platform: {
    title: 'This platform isn’t connected yet',
    body: 'Your institution’s Chip Study admin needs to add this learning platform in Chip Study, under Institution, Settings, Learning platform. If it’s there already, its issuer and client ID don’t match what the platform sent.',
  },
  unknown_deployment: {
    title: 'This deployment isn’t registered',
    body: 'Your institution’s admin needs to add this deployment ID to the platform in Chip Study. Each deployment needs its own entry.',
  },
  bad_login: {
    title: 'The launch didn’t start properly',
    body: 'Open Chip Study from your course again. If it keeps happening, let your institution’s IT team know.',
  },
  expired: {
    title: 'That took too long',
    body: 'Opening Chip Study from your course runs out after a few minutes. Open it from your course again.',
  },
  bad_token: {
    title: 'We couldn’t check that launch',
    body: 'Chip Study couldn’t confirm it came from your learning platform. Open it from your course again. If it keeps happening, your IT team can check the platform’s keyset address in Chip Study.',
  },
  unsupported: {
    title: 'That kind of link isn’t supported',
    body: 'Chip Study opens from a link or an activity in your course. Ask your teacher to add it that way.',
  },
  anonymous: {
    title: 'Your platform didn’t say who you are',
    body: 'Your learning platform is set not to share who’s opening Chip Study, so we can’t sign you in. Your IT team can turn on sharing your name and email with Chip Study.',
  },
  no_seats: {
    title: 'No seats left',
    body: 'Your institution has used all its Chip Study seats. Let your teacher know: an admin can ask Kaivon for more.',
  },
  inactive: {
    title: 'Not open right now',
    body: 'Chip Study isn’t active for your institution at the moment, so you can’t join from your course. Your teacher or an admin can find out why.',
  },
  linked_elsewhere: {
    title: 'Linked to another account',
    body: 'Your course account is already linked to a different Chip Study account. Sign in with that one. If you can’t, write to support@kaivon.app.',
  },
  under_18: {
    title: 'Not for under-18s here yet',
    body: 'You told Chip Study you’re under 18, and your institution hasn’t confirmed parents’ consent for students under 18. Ask your teacher: an admin can turn it on in Chip Study, under Institution, Settings.',
  },
  failed: {
    title: 'Something went wrong',
    body: 'Open Chip Study from your course again. If it keeps happening, write to support@kaivon.app with the time it happened.',
  },
};

export function ltiError(code: string) {
  return LTI_ERRORS[code] ?? LTI_ERRORS.failed;
}
