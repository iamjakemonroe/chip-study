/** The price for institutions (study_institution_prices): per student per year, billed yearly,
 * from a minimum number of students, after a free one-term pilot. Pure, so it can be tested. */
import { formatMoney, type Currency } from './currency.ts';

/** A currency the price, or an invoice, can be in. Visitors see GBP, USD or NGN (the rule in
 * currency.ts); EUR stays only so invoices already issued in euros show and pay as issued. */
export type PriceCurrency = Currency | 'EUR';

export type InstitutionPrices = Partial<Record<PriceCurrency, { per_student_year: number; min_students: number }>>;

/** The currencies a new invoice can be in, in the order staff see them. */
export const INVOICE_CURRENCIES: Currency[] = ['GBP', 'USD', 'NGN'];

/** "£36", "$45", "₦45,000"; pence and cents only when there are some ("£1,912.50"). */
export function formatPrice(amount: number, currency: PriceCurrency): string {
  return formatMoney(amount, currency, { trim: true });
}

/** The price in [currency], or in US dollars when there's none in it (which is what an invoice
 * would then be in), or null with neither. */
export function priceIn(prices: InstitutionPrices, currency: Currency): { currency: Currency; per_student_year: number; min_students: number } | null {
  const pick = prices[currency] ? currency : prices.USD ? 'USD' : null;
  return pick ? { currency: pick, ...prices[pick]! } : null;
}

/** "£36 per student per year", in the one currency the visitor sees. */
export function priceLine(prices: InstitutionPrices, currency: Currency): string | null {
  const p = priceIn(prices, currency);
  return p ? `${formatPrice(p.per_student_year, p.currency)} per student per year` : null;
}

/** The fewest students a yearly invoice is for. */
export function minStudents(prices: InstitutionPrices): number {
  return Math.max(...(['GBP', 'USD', 'EUR', 'NGN'] as const).map((c) => prices[c]?.min_students ?? 0), 0) || 50;
}

/** What an invoice comes to: seats (at least the minimum) × the yearly price × months ÷ 12, to
 * the penny (whole naira). */
export function invoiceAmount(seats: number, months: number, price: { per_student_year: number; min_students: number } | undefined, currency: PriceCurrency): number | null {
  if (!price || !(seats > 0) || !(months > 0)) return null;
  const raw = (Math.max(seats, price.min_students) * price.per_student_year * months) / 12;
  return currency === 'NGN' ? Math.round(raw) : Math.round(raw * 100) / 100;
}
