import { describe, expect, it, vi } from 'vitest';
import { termsIn } from '../../src/content/legal.ts';
import { PLAN_PRICES, studentSaving } from '../../src/content/site.ts';
import { chargeCurrency, COUNTRY_KEY, createCurrencyStore, currencyForCountry, currencyForTimeZone, formatMoney, GEO_TIMEOUT, priceNote, type Currency } from '../../src/lib/currency.ts';

describe('the currency rule', () => {
  it('goes by country: naira in Nigeria, pounds in the UK and the Crown Dependencies, euros where the euro is the money, dollars everywhere else', () => {
    expect(currencyForCountry('NG')).toBe('NGN');
    for (const c of ['GB', 'IM', 'JE', 'GG']) expect(currencyForCountry(c), c).toBe('GBP');
    const euro = ['AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES'];
    const alsoEuro = ['AD', 'MC', 'SM', 'VA', 'ME', 'XK', 'AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'PM', 'BL', 'MF'];
    for (const c of [...euro, ...alsoEuro]) expect(currencyForCountry(c), c).toBe('EUR');
    // Europe outside the euro, and everywhere else.
    for (const c of ['CH', 'LI', 'RS', 'NO', 'SE', 'DK', 'PL', 'CZ', 'HU', 'RO', 'IS', 'AL', 'BA', 'MK', 'TR', 'UA']) expect(currencyForCountry(c), c).toBe('USD');
    for (const c of ['US', 'CA', 'GH', 'KE', 'ZA', 'IN', 'AU', 'BR', 'JP']) expect(currencyForCountry(c), c).toBe('USD');
    expect(currencyForCountry(' gb ')).toBe('GBP');
    expect(currencyForCountry('ng')).toBe('NGN');
    expect(currencyForCountry('de')).toBe('EUR');
  });

  it('leaves it to the time zone when the country isn’t known', () => {
    for (const c of ['XX', 'T1', '', 'GBR', '1', 'G1', null, undefined, 44, {}]) expect(currencyForCountry(c), String(c)).toBeNull();
  });

  it('guesses from the time zone until then', () => {
    expect(currencyForTimeZone('Africa/Lagos')).toBe('NGN');
    for (const tz of ['Europe/London', 'Europe/Jersey', 'Europe/Guernsey', 'Europe/Isle_of_Man']) expect(currencyForTimeZone(tz), tz).toBe('GBP');
    for (const tz of [
      'Europe/Vienna', 'Europe/Brussels', 'Europe/Zagreb', 'Europe/Nicosia', 'Europe/Tallinn', 'Europe/Helsinki', 'Europe/Mariehamn',
      'Europe/Paris', 'Europe/Berlin', 'Europe/Busingen', 'Europe/Athens', 'Europe/Dublin', 'Europe/Rome', 'Europe/Riga', 'Europe/Vilnius',
      'Europe/Luxembourg', 'Europe/Malta', 'Europe/Amsterdam', 'Europe/Lisbon', 'Europe/Bratislava', 'Europe/Ljubljana', 'Europe/Madrid',
      'Europe/Sofia', 'Europe/Andorra', 'Europe/Monaco', 'Europe/San_Marino', 'Europe/Vatican', 'Europe/Podgorica',
      'Asia/Nicosia', 'Asia/Famagusta', 'Atlantic/Madeira', 'Atlantic/Azores', 'Atlantic/Canary', 'Africa/Ceuta',
      'America/Cayenne', 'America/Guadeloupe', 'America/Martinique', 'America/Miquelon', 'America/St_Barthelemy', 'America/Marigot',
      'Indian/Reunion', 'Indian/Mayotte',
    ]) {
      expect(currencyForTimeZone(tz), tz).toBe('EUR');
    }
    for (const tz of [
      'Europe/Zurich', 'Europe/Belgrade', 'Europe/Oslo', 'Europe/Stockholm', 'Europe/Copenhagen', 'Europe/Warsaw', 'Europe/Prague', 'Europe/Budapest',
      'Europe/Bucharest', 'Europe/Istanbul', 'America/New_York', 'America/Los_Angeles', 'Africa/Accra', 'Asia/Tokyo', 'UTC',
    ]) {
      expect(currencyForTimeZone(tz), tz).toBe('USD');
    }
    expect(currencyForTimeZone(undefined)).toBe('USD');
    expect(currencyForTimeZone(null)).toBe('USD');
  });

  it('formats each currency one way', () => {
    expect(formatMoney(3.99, 'GBP')).toBe('£3.99');
    expect(formatMoney(3.99, 'USD')).toBe('$3.99');
    expect(formatMoney(1, 'USD')).toBe('$1.00');
    expect(formatMoney(3990, 'NGN')).toBe('₦3,990');
    expect(formatMoney(3990.4, 'NGN')).toBe('₦3,990');
    expect(formatMoney(1_500_000, 'NGN')).toBe('₦1,500,000');
    expect(formatMoney(36, 'GBP', { trim: true })).toBe('£36');
    expect(formatMoney(45, 'USD', { trim: true })).toBe('$45');
    expect(formatMoney(45_000, 'NGN', { trim: true })).toBe('₦45,000');
    expect(formatMoney(1912.5, 'GBP', { trim: true })).toBe('£1,912.50');
    expect(formatMoney(0, 'GBP', { trim: true })).toBe('£0');
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney(42, 'EUR')).toBe('€42.00');
    expect(formatMoney(7.49, 'EUR')).toBe('€7.49');
    expect(formatMoney(42, 'EUR', { trim: true })).toBe('€42');
    expect(formatMoney(1886.5, 'EUR', { trim: true })).toBe('€1,886.50');
    expect(formatMoney(1, 'cad')).toBe('CAD 1.00');
  });

  it('notes the one currency prices are in', () => {
    expect(priceNote('NGN')).toBe('Prices in naira.');
    expect(priceNote('GBP')).toBe('Prices in pounds.');
    expect(priceNote('EUR')).toBe('Prices in euros.');
    expect(priceNote('USD')).toBe('Prices in US dollars. Your bank converts if your card is in another currency.');
  });
});

describe('the plans’ prices', () => {
  it('are in every currency: pounds about 80% of the dollars, euros about 93%, naira the dollars’ digits times 1,000', () => {
    expect(PLAN_PRICES).toEqual({ USD: { pro: 7.99, student: 5.99 }, GBP: { pro: 6.49, student: 4.99 }, EUR: { pro: 7.49, student: 5.49 }, NGN: { pro: 7990, student: 5990 } });
    expect(studentSaving(PLAN_PRICES.USD)).toBe(25);
    expect(studentSaving(PLAN_PRICES.GBP)).toBe(23);
    expect(studentSaving(PLAN_PRICES.EUR)).toBe(27);
  });

  it('are shown and charged in US dollars where the server has no price in the visitor’s currency', () => {
    const pro = { USD: 7.99, NGN: 7990, GBP: 6.49 };
    const student = { USD: 5.99, NGN: 5990, GBP: 4.99 };
    expect(chargeCurrency('GBP', pro, student)).toBe('GBP');
    expect(chargeCurrency('NGN', pro, student)).toBe('NGN');
    expect(chargeCurrency('USD', pro, student)).toBe('USD');
    expect(chargeCurrency('GBP', { USD: 7.99, NGN: 7990 }, { USD: 5.99, NGN: 5990 })).toBe('USD');
    expect(chargeCurrency('GBP', { USD: 7.99, GBP: 6.49 }, { USD: 5.99 })).toBe('USD');
    expect(chargeCurrency('EUR', { ...pro, EUR: 7.49 }, { ...student, EUR: 5.49 })).toBe('EUR');
    expect(chargeCurrency('EUR', pro, student)).toBe('USD');
    // Before the server's prices are known: the visitor's, as the page shows.
    expect(chargeCurrency('GBP', null, undefined)).toBe('GBP');
    expect(chargeCurrency('GBP')).toBe('GBP');
  });

  it('are in one currency in the Terms', () => {
    const text = (c: Currency) => JSON.stringify(termsIn(c));
    expect(text('GBP')).toContain('Chip Study Pro costs £6.49 a month.');
    expect(text('GBP')).toContain('Students get Pro for £4.99 a month');
    expect(text('GBP')).toContain('costs £36 per student per year, billed yearly');
    expect(text('USD')).toContain('Chip Study Pro costs $7.99 a month (your bank converts if your card is in another currency).');
    expect(text('USD')).toContain('costs $45 per student per year');
    expect(text('NGN')).toContain('Chip Study Pro costs ₦7,990 a month.');
    expect(text('NGN')).toContain('costs ₦45,000 per student per year');
    expect(text('EUR')).toContain('Chip Study Pro costs €7.49 a month. It renews');
    expect(text('EUR')).toContain('Students get Pro for €5.49 a month');
    expect(text('EUR')).toContain('costs €42 per student per year, billed yearly');
    expect(text('EUR')).not.toMatch(/[$₦£]\d|US\$/);
    expect(text('GBP')).not.toMatch(/[$₦€]\d|US\$/);
    expect(text('USD')).not.toMatch(/[£₦€]\d|US\$/);
    expect(text('NGN')).not.toMatch(/[£$€]\d|US\$/);
  });
});

/** A session's storage, a time zone and /api/geo, all pretend. */
function setup({ timeZone = 'America/New_York', kept = null as string | null, answer = undefined as unknown, status = 200, type = 'application/json', hang = false } = {}) {
  const data = new Map<string, string>(kept ? [[COUNTRY_KEY, kept]] : []);
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const fetch = vi.fn(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        if (hang) {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          return;
        }
        resolve(new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), { status, headers: { 'content-type': type } }));
      }),
  );
  const store = createCurrencyStore({ timeZone: () => timeZone, storage: () => storage, fetch: fetch as unknown as typeof globalThis.fetch });
  return { store, fetch, data };
}

describe('the visitor’s currency', () => {
  it('starts from the time zone, then the country Cloudflare sees settles it and is kept for the session', async () => {
    const { store, fetch, data } = setup({ timeZone: 'Europe/London', answer: { country: 'US' } });
    expect(store.get()).toBe('GBP');
    const changed = vi.fn();
    store.subscribe(changed);
    expect(await store.refine()).toBe('USD');
    expect(store.get()).toBe('USD');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(data.get(COUNTRY_KEY)).toBe('US');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/geo');
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    // Asked once a session.
    await store.refine();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('starts from the country already known this session, without asking again', async () => {
    const { store, fetch } = setup({ timeZone: 'America/New_York', kept: 'NG' });
    expect(store.get()).toBe('NGN');
    expect(await store.refine()).toBe('NGN');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the time zone’s guess for an unknown country, a page that isn’t JSON, an error or no answer in time', async () => {
    for (const s of [
      setup({ timeZone: 'Africa/Lagos', answer: { country: 'XX' } }),
      setup({ timeZone: 'Africa/Lagos', answer: '<!doctype html>', type: 'text/html' }),
      setup({ timeZone: 'Africa/Lagos', answer: { error: 'nope' }, status: 500 }),
      setup({ timeZone: 'Africa/Lagos', answer: 'not json', type: 'application/json' }),
    ]) {
      expect(await s.store.refine()).toBe('NGN');
      expect(s.store.get()).toBe('NGN');
      expect(s.data.has(COUNTRY_KEY)).toBe(false);
    }
    vi.useFakeTimers();
    try {
      const { store } = setup({ timeZone: 'Europe/London', hang: true });
      const asked = store.refine();
      await vi.advanceTimersByTimeAsync(GEO_TIMEOUT);
      expect(await asked).toBe('GBP');
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns a UK visitor in another time zone to pounds, and a Nigerian one to naira', async () => {
    const uk = setup({ timeZone: 'America/New_York', answer: { country: 'GB' } });
    expect(uk.store.get()).toBe('USD');
    expect(await uk.store.refine()).toBe('GBP');
    const ng = setup({ timeZone: 'Europe/London', answer: { country: 'NG' } });
    expect(await ng.store.refine()).toBe('NGN');
  });

  it('turns a German visitor to euros, and a Swiss one in a euro time zone to dollars', async () => {
    const de = setup({ timeZone: 'America/New_York', answer: { country: 'DE' } });
    expect(await de.store.refine()).toBe('EUR');
    const ch = setup({ timeZone: 'Europe/Berlin', answer: { country: 'CH' } });
    expect(ch.store.get()).toBe('EUR');
    expect(await ch.store.refine()).toBe('USD');
  });
});
