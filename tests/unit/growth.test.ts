import { beforeEach, describe, expect, it } from 'vitest';
import { GUIDES, guideBySlug } from '../../src/content/guides.ts';
import { BLACKBOARD_APP_ID, checkPlatform, ltiAddresses, PLATFORM_HELP, PRESETS } from '../../src/content/platforms.ts';
import { priceNote } from '../../src/lib/currency.ts';
import { institutionError } from '../../src/lib/institutions.ts';
import { forgetLtiArrival, ltiError, LTI_ERRORS, parseLtiFragment, takeLtiArrival } from '../../src/lib/lti.ts';
import { dropReferral, keepReferral, pendingReferral, quietReferralError, referralFrom, referralLink } from '../../src/lib/referral.ts';
import { safeNext } from '../../src/lib/session.ts';

describe('invite links', () => {
  beforeEach(() => localStorage.clear());

  it('reads a code from the address, whatever the case, and nothing that isn’t one', () => {
    expect(referralFrom('?ref=abcd2345')).toBe('ABCD2345');
    expect(referralFrom('?x=1&ref=%20K7Q2MDXY%20')).toBe('K7Q2MDXY');
    for (const search of ['', '?ref=', '?ref=ABC', '?ref=ABCDEFGHI', '?ref=ABCD1234', '?ref=ABCDO234', '?ref=<script>']) expect(referralFrom(search), search).toBeNull();
  });

  it('makes the link to share', () => {
    expect(referralLink('ABCD2345')).toBe('https://study.kaivon.app/?ref=ABCD2345');
  });

  it('keeps a code through signing in, for 30 days at most', () => {
    const now = Date.UTC(2026, 10, 7);
    keepReferral('ABCD2345', now);
    expect(pendingReferral(now + 29 * 86_400_000)).toBe('ABCD2345');
    expect(pendingReferral(now + 31 * 86_400_000)).toBeNull();
    expect(localStorage.getItem('chip-study-ref')).toBeNull();
    keepReferral('ABCD2345', now);
    dropReferral();
    expect(pendingReferral(now)).toBeNull();
  });

  it('ignores something kept that isn’t a code', () => {
    localStorage.setItem('chip-study-ref', JSON.stringify({ code: 'nope', at: Date.now() }));
    expect(pendingReferral()).toBeNull();
    localStorage.setItem('chip-study-ref', '{not json');
    expect(pendingReferral()).toBeNull();
  });

  it('says nothing about codes that can’t be used', () => {
    for (const raw of ['no such code', 'your own code', 'already referred', 'too late']) expect(quietReferralError(raw), raw).toBe(true);
    for (const raw of ['Failed to fetch', 'save your account first']) expect(quietReferralError(raw), raw).toBe(false);
  });
});

describe('arriving from a learning platform', () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/lti');
  });

  it('reads each kind of fragment the study-lti function sends', () => {
    expect(parseLtiFragment('#token_hash=abc&type=magiclink&inst=i1&class=c1&role=student&confirm=ada%40uni.edu')).toEqual({
      kind: 'signin',
      tokenHash: 'abc',
      type: 'magiclink',
      inst: 'i1',
      cls: 'c1',
      role: 'student',
      confirm: 'ada@uni.edu',
    });
    expect(parseLtiFragment('#token_hash=abc&inst=i1&role=teacher')).toMatchObject({ kind: 'signin', cls: null, confirm: null, type: 'email' });
    expect(parseLtiFragment('#link=tok123')).toEqual({ kind: 'link', token: 'tok123' });
    expect(parseLtiFragment('#error=no_seats')).toEqual({ kind: 'error', code: 'no_seats' });
    expect(parseLtiFragment('')).toEqual({ kind: 'none' });
  });

  it('takes the fragment out of the address, and keeps it for the tab', () => {
    history.replaceState(null, '', '/lti#link=tok123');
    expect(takeLtiArrival()).toEqual({ kind: 'link', token: 'tok123' });
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/lti');
    // Read again (back from signing in): still there.
    expect(takeLtiArrival()).toEqual({ kind: 'link', token: 'tok123' });
    forgetLtiArrival();
    expect(takeLtiArrival()).toEqual({ kind: 'none' });
  });

  it('forgets a kept arrival after an hour', () => {
    const at = Date.UTC(2026, 10, 7, 9);
    history.replaceState(null, '', '/lti#link=tok123');
    takeLtiArrival(at);
    expect(takeLtiArrival(at + 59 * 60_000)).toEqual({ kind: 'link', token: 'tok123' });
    expect(takeLtiArrival(at + 61 * 60_000)).toEqual({ kind: 'none' });
  });

  it('has words for every error code the function sends, and a fallback', () => {
    for (const code of ['unknown_platform', 'bad_login', 'expired', 'bad_token', 'unknown_deployment', 'unsupported', 'anonymous', 'no_seats', 'inactive', 'linked_elsewhere', 'under_18', 'failed']) {
      expect(LTI_ERRORS[code], code).toBeDefined();
      expect(LTI_ERRORS[code].body).not.toMatch(/!/);
    }
    expect(ltiError('something new')).toBe(LTI_ERRORS.failed);
  });

  it('comes back to /lti after signing in, and nowhere odd', () => {
    expect(safeNext('/lti')).toBe('/lti');
    expect(safeNext('/lti/../evil')).toBe('/app');
    expect(safeNext('/ltix')).toBe('/app');
  });
});

describe('connecting a learning platform', () => {
  it('gives the four addresses under the study-lti function', () => {
    expect(ltiAddresses('https://atrgasakfnmixhictynh.supabase.co/').map((a) => a.url)).toEqual([
      'https://atrgasakfnmixhictynh.supabase.co/functions/v1/study-lti/launch',
      'https://atrgasakfnmixhictynh.supabase.co/functions/v1/study-lti/login',
      'https://atrgasakfnmixhictynh.supabase.co/functions/v1/study-lti/jwks',
      'https://atrgasakfnmixhictynh.supabase.co/functions/v1/study-lti/canvas.json',
    ]);
  });

  it('fills in Blackboard completely except the deployment, and Canvas’s cloud addresses', () => {
    expect(PRESETS.blackboard).toEqual({
      name: 'Blackboard',
      issuer: 'https://blackboard.com',
      client_id: BLACKBOARD_APP_ID,
      auth_url: 'https://developer.blackboard.com/api/v1/gateway/oidcauth',
      jwks_url: 'https://developer.blackboard.com/api/v1/management/applications/6b29b222-febd-4a33-b399-6e1951fc3898/jwks.json',
    });
    expect(PRESETS.canvas).toMatchObject({
      issuer: 'https://canvas.instructure.com',
      auth_url: 'https://sso.canvaslms.com/api/lti/authorize_redirect',
      jwks_url: 'https://sso.canvaslms.com/api/lti/security/jwks',
    });
    expect(PRESETS.canvas.client_id).toBeUndefined();
    for (const k of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) expect(PLATFORM_HELP[k].length, k).toBeGreaterThan(0);
  });

  it('asks for https addresses and every ID', () => {
    const ok = { name: '', issuer: 'https://canvas.instructure.com', client_id: '1000', deployment_id: '1:abc', auth_url: 'https://sso.canvaslms.com/a', jwks_url: 'https://sso.canvaslms.com/j' };
    expect(checkPlatform(ok)).toEqual({});
    expect(Object.keys(checkPlatform({ ...ok, issuer: 'http://canvas.instructure.com', client_id: ' ', jwks_url: 'sso.canvaslms.com/j' })).sort()).toEqual(['client_id', 'issuer', 'jwks_url']);
  });
});

describe('the new server errors, in words', () => {
  it('says each one plainly', () => {
    const cases: [string, RegExp][] = [
      ['under 18 not allowed here', /hasn’t said students under 18/],
      ['schools need it', /stays on/],
      ['link expired', /run out/],
      ['linked to another account', /different Chip Study account/],
      ['registered to another institution', /another institution/],
      ['institution not approved', /approved institutions/],
      ['not open', /already paid or cancelled/],
      ['no such account', /No account has that/],
    ];
    for (const [raw, said] of cases) expect(institutionError(raw), raw).toMatch(said);
  });
});

describe('the price note', () => {
  it('says the currency the prices are in', () => {
    expect(priceNote('NGN')).toBe('Prices in naira. Payments by Flutterwave.');
    expect(priceNote('USD')).toMatch(/^Prices in US dollars\./);
  });
});

describe('study guides', () => {
  it('has the four pages, each findable and complete', () => {
    expect(GUIDES.map((g) => g.slug)).toEqual(['how-to-study-for-exams', 'spaced-repetition', 'active-recall', 'using-ai-without-cheating']);
    for (const g of GUIDES) {
      expect(guideBySlug(g.slug)).toBe(g);
      expect(g.metaTitle.length, g.slug).toBeLessThanOrEqual(70);
      expect(g.description.length, g.slug).toBeGreaterThan(80);
      expect(g.description.length, g.slug).toBeLessThanOrEqual(220);
      expect(g.sections.length, g.slug).toBeGreaterThanOrEqual(5);
    }
    expect(guideBySlug('nope')).toBeUndefined();
  });

  it('is calm: no exclamation marks, no percentages or made-up figures', () => {
    for (const g of GUIDES) {
      const text = JSON.stringify(g);
      expect(text, g.slug).not.toMatch(/!/);
      expect(text, g.slug).not.toMatch(/\d+\s?%/);
    }
  });

  it('cites each source with its authors, year and where it was published', () => {
    for (const g of GUIDES) for (const s of g.sources) expect(s, g.slug).toMatch(/\(\d{4}\)\./);
  });
});
