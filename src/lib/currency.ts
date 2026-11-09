import { useSyncExternalStore } from 'react';

/** Which currency a visitor sees prices in and pays in, the same rule on every Kaivon site: naira
 * in Nigeria, pounds in the UK, the Isle of Man and the Channel Islands, euros where the euro is
 * the money, US dollars everywhere else (Switzerland, Serbia and Europe's other non-euro countries
 * included). The country comes from Cloudflare (GET /api/geo, worker/geo.ts); until it's known,
 * the browser's time zone decides. Prices are in exactly one currency, and checkout charges it. */
export type Currency = 'USD' | 'GBP' | 'EUR' | 'NGN';

const POUND_COUNTRIES = new Set(['GB', 'IM', 'JE', 'GG']);
const POUND_ZONES = new Set(['Europe/London', 'Europe/Jersey', 'Europe/Guernsey', 'Europe/Isle_of_Man']);

/** The euro area (Bulgaria from 2026), the small states and Kosovo and Montenegro that use the
 * euro, and the French overseas parts that are in it. */
const EURO_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
  'AD', 'MC', 'SM', 'VA', 'ME', 'XK', 'AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'PM', 'BL', 'MF',
]);
/** Their time zones (Europe/Busingen is Germany's, inside Switzerland). */
const EURO_ZONES = new Set([
  'Europe/Vienna', 'Europe/Brussels', 'Europe/Zagreb', 'Europe/Nicosia', 'Europe/Tallinn', 'Europe/Helsinki', 'Europe/Mariehamn',
  'Europe/Paris', 'Europe/Berlin', 'Europe/Busingen', 'Europe/Athens', 'Europe/Dublin', 'Europe/Rome', 'Europe/Riga', 'Europe/Vilnius',
  'Europe/Luxembourg', 'Europe/Malta', 'Europe/Amsterdam', 'Europe/Lisbon', 'Europe/Bratislava', 'Europe/Ljubljana', 'Europe/Madrid',
  'Europe/Sofia', 'Europe/Andorra', 'Europe/Monaco', 'Europe/San_Marino', 'Europe/Vatican', 'Europe/Podgorica',
  'Asia/Nicosia', 'Asia/Famagusta', 'Atlantic/Madeira', 'Atlantic/Azores', 'Atlantic/Canary', 'Africa/Ceuta',
  'America/Cayenne', 'America/Guadeloupe', 'America/Martinique', 'America/Miquelon', 'America/St_Barthelemy', 'America/Marigot',
  'Indian/Reunion', 'Indian/Mayotte',
]);

/** A country's currency (ISO 3166 alpha-2), or null when the country isn't known (Cloudflare's
 * XX, Tor's T1, or anything that isn't a code), so the time zone decides. */
export function currencyForCountry(country: unknown): Currency | null {
  if (typeof country !== 'string') return null;
  const code = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return null;
  if (code === 'NG') return 'NGN';
  if (POUND_COUNTRIES.has(code)) return 'GBP';
  if (EURO_COUNTRIES.has(code)) return 'EUR';
  return 'USD';
}

/** The first guess, from the browser's time zone. */
export function currencyForTimeZone(timeZone: string | null | undefined): Currency {
  if (timeZone === 'Africa/Lagos') return 'NGN';
  if (timeZone && POUND_ZONES.has(timeZone)) return 'GBP';
  if (timeZone && EURO_ZONES.has(timeZone)) return 'EUR';
  return 'USD';
}

const SYMBOL: Record<string, string> = { USD: '$', GBP: '£', NGN: '₦', EUR: '€' };

/** "$7.99", "£6.49", "€7.49", "₦7,990" (whole naira). [trim] drops the pence or cents of a whole
 * amount, for the price for institutions ("£36", "€42"). Any other code is written before the
 * amount ("CAD 1.00"). */
export function formatMoney(amount: number, currency: string, { trim = false }: { trim?: boolean } = {}): string {
  const code = currency.toUpperCase();
  const whole = code === 'NGN' || (trim && Math.round(amount * 100) % 100 === 0);
  const n = whole
    ? Math.round(amount).toLocaleString('en-US')
    : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = SYMBOL[code];
  return symbol ? `${symbol}${n}` : `${code} ${n}`;
}

/** The currency to show and charge the server's prices in: the visitor's where every price list
 * has a price in it, else US dollars (which checkout falls back to, so what's shown is what's
 * charged). Before any list is known, the visitor's. */
export function chargeCurrency(visitor: Currency, ...lists: (Partial<Record<string, number>> | null | undefined)[]): Currency {
  const known = lists.filter((l) => !!l);
  if (!known.length) return visitor;
  return known.every((l) => l[visitor] != null) ? visitor : 'USD';
}

/** The line under prices, in the currency they're shown in. */
export function priceNote(currency: Currency): string {
  if (currency === 'NGN') return 'Prices in naira.';
  if (currency === 'GBP') return 'Prices in pounds.';
  if (currency === 'EUR') return 'Prices in euros.';
  return 'Prices in US dollars. Your bank converts if your card is in another currency.';
}

// ── The visitor's currency ────────────────────────────────────────────

/** Where the country is kept for the rest of the visit (this tab's session). */
export const COUNTRY_KEY = 'kaivon.country';
/** How long the page waits for /api/geo before keeping the time zone's guess. */
export const GEO_TIMEOUT = 1500;

interface Deps {
  timeZone: () => string | undefined;
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | null;
  fetch: typeof fetch;
}

const browser: Deps = {
  timeZone: () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  },
  storage: () => {
    try {
      return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
      return null;
    }
  },
  fetch: (...args) => fetch(...args),
};

/** The visitor's currency, kept in one place: decided at once (the country known this session,
 * or else the time zone), then refined once a session from the country Cloudflare sees. */
export function createCurrencyStore(deps: Deps = browser) {
  const read = (): string | null => {
    try {
      return deps.storage()?.getItem(COUNTRY_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let current: Currency = currencyForCountry(read()) ?? currencyForTimeZone(deps.timeZone());
  const listeners = new Set<() => void>();
  let refining: Promise<Currency> | null = null;

  const set = (next: Currency) => {
    if (next === current) return;
    current = next;
    listeners.forEach((l) => l());
  };

  return {
    get: (): Currency => current,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Asks /api/geo once a session (not at all once the country is kept), for no longer than
     * GEO_TIMEOUT; anything but a country keeps the time zone's guess. */
    refine(): Promise<Currency> {
      if (refining) return refining;
      if (currencyForCountry(read())) return (refining = Promise.resolve(current));
      refining = (async () => {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), GEO_TIMEOUT);
        try {
          const res = await deps.fetch('/api/geo', { cache: 'no-store', signal: abort.signal, headers: { accept: 'application/json' } });
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return current;
          const country = ((await res.json()) as { country?: unknown } | null)?.country;
          const found = currencyForCountry(country);
          if (!found) return current;
          try {
            deps.storage()?.setItem(COUNTRY_KEY, String(country).trim().toUpperCase());
          } catch {
            // Private browsing: asked again next visit.
          }
          set(found);
          return found;
        } catch {
          return current;
        } finally {
          clearTimeout(timer);
        }
      })();
      return refining;
    },
  };
}

const store = createCurrencyStore();

/** The visitor's currency now: read it when paying, so checkout charges what's shown. */
export const visitorCurrency = (): Currency => store.get();

/** Starts the refinement from the visitor's country (once a session). */
export const refineCurrency = (): Promise<Currency> => store.refine();

/** The visitor's currency, re-rendering when the country refines it. */
export function useCurrency(): Currency {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
