/** Which currency this buyer pays in: naira in Nigeria (by the browser's time zone), US dollars
 * everywhere else. Dollar cards from US banks refuse Nigerian processors, and Verve cards can't pay
 * in dollars, so Nigeria pays in naira. Each naira price is the dollar price's digits times 1,000
 * ($7.99 is ₦7,990), set in web_plan_prices on Utopia's project. */
export type Currency = 'USD' | 'NGN';

function inNigeria(): boolean {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone === 'Africa/Lagos';
  } catch {
    return false;
  }
}

export const CURRENCY: Currency = inNigeria() ? 'NGN' : 'USD';

/** A dollar price in this buyer's currency, before the server says. */
export const fromUsd = (usd: number) => (CURRENCY === 'NGN' ? Math.round(usd * 1000) : usd);

/** "$7.99" or "₦7,990". */
export function money(amount: number, currency: Currency = CURRENCY): string {
  return currency === 'NGN' ? `₦${Math.round(amount).toLocaleString('en-NG')}` : `$${amount.toFixed(2)}`;
}
