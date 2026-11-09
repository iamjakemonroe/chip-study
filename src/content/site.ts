import type { Currency } from '../lib/currency.ts';

/** Facts the whole site shares. */
export const site = {
  name: 'Chip Study',
  host: 'study.kaivon.app',
  url: 'https://study.kaivon.app',
  email: 'support@kaivon.app',
  kaivon: 'https://kaivon.app',
  utopia: 'https://utopia.kaivon.app',
  year: 2026,
} as const;

/** Chip Study Pro a month, and the student plan (Pro for less, for a school email), in each
 * currency it's sold in: web_plan_prices on Utopia's project (study.pro.monthly and
 * study.pro.student.monthly), shown before anyone signs in. Change them together. Pounds are
 * about 80% of the dollar price; naira is the dollar price's digits times 1,000. */
export const PLAN_PRICES: Record<Currency, { pro: number; student: number }> = {
  USD: { pro: 7.99, student: 5.99 },
  GBP: { pro: 6.49, student: 4.99 },
  NGN: { pro: 7990, student: 5990 },
};

/** The price for institutions, per student per year (study_institution_prices), for the Terms;
 * the pages ask the server for it. */
export const INSTITUTION_PRICES: Record<Currency, number> = { USD: 45, GBP: 36, NGN: 45_000 };

/** How much less the student plan is, in whole percent ("25"). */
export const studentSaving = (p: { pro: number; student: number }) => Math.round((1 - p.student / p.pro) * 100);

/** Whether Pro can be bought yet (live Flutterwave keys). The app asks the server; the landing
 * page goes by the build. */
export const proLive = import.meta.env.VITE_PRO_LIVE === 'true';
