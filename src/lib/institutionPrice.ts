/** The price for institutions (study_institution_prices): per student per year, billed yearly,
 * from a minimum number of students, after a free one-term pilot. Pure, so it can be tested. */

export type PriceCurrency = 'GBP' | 'USD' | 'EUR' | 'NGN';

export type InstitutionPrices = Partial<Record<PriceCurrency, { per_student_year: number; min_students: number }>>;

/** The order the others follow, after the visitor's own. */
export const PRICE_ORDER: PriceCurrency[] = ['GBP', 'USD', 'EUR', 'NGN'];

/** The visitor's currency, from their time zone: naira in Nigeria, pounds in the UK, euros in the
 * rest of Europe, dollars everywhere else. */
export function priceCurrencyFor(timeZone: string | undefined): PriceCurrency {
  if (timeZone === 'Africa/Lagos') return 'NGN';
  if (timeZone === 'Europe/London') return 'GBP';
  if (timeZone?.startsWith('Europe/')) return 'EUR';
  return 'USD';
}

export function visitorPriceCurrency(): PriceCurrency {
  try {
    return priceCurrencyFor(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return 'USD';
  }
}

const SYMBOL: Record<PriceCurrency, string> = { GBP: '£', USD: '$', EUR: '€', NGN: '₦' };

/** "£36", "$45", "€42", "₦45,000"; pence and cents only when there are some. */
export function formatPrice(amount: number, currency: PriceCurrency): string {
  const whole = Math.round(amount * 100) % 100 === 0;
  const n = currency === 'NGN' || whole ? Math.round(amount).toLocaleString('en-GB') : amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${SYMBOL[currency]}${n}`;
}

/** The currencies there are prices in: the visitor's first, then the rest in the usual order. */
export function priceCurrencies(prices: InstitutionPrices, first: PriceCurrency): PriceCurrency[] {
  const have = PRICE_ORDER.filter((c) => prices[c]);
  return have.includes(first) ? [first, ...have.filter((c) => c !== first)] : have;
}

/** "£36 per student per year (or $45 / €42 / ₦45,000)", the visitor's currency first. */
export function priceLine(prices: InstitutionPrices, first: PriceCurrency): string | null {
  const order = priceCurrencies(prices, first);
  if (!order.length) return null;
  const [main, ...rest] = order;
  const others = rest.map((c) => formatPrice(prices[c]!.per_student_year, c)).join(' / ');
  return `${formatPrice(prices[main]!.per_student_year, main)} per student per year${others ? ` (or ${others})` : ''}`;
}

/** The fewest students a yearly invoice is for. */
export function minStudents(prices: InstitutionPrices): number {
  return Math.max(...PRICE_ORDER.map((c) => prices[c]?.min_students ?? 0), 0) || 50;
}

/** What an invoice comes to: seats (at least the minimum) × the yearly price × months ÷ 12, to
 * the penny (whole naira). */
export function invoiceAmount(seats: number, months: number, price: { per_student_year: number; min_students: number } | undefined, currency: PriceCurrency): number | null {
  if (!price || !(seats > 0) || !(months > 0)) return null;
  const raw = (Math.max(seats, price.min_students) * price.per_student_year * months) / 12;
  return currency === 'NGN' ? Math.round(raw) : Math.round(raw * 100) / 100;
}
