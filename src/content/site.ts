/** Facts the whole site shares. */
export const site = {
  name: 'Chip Study',
  host: 'study.kaivon.app',
  url: 'https://study.kaivon.app',
  email: 'support@kaivon.app',
  kaivon: 'https://kaivon.app',
  utopia: 'https://utopia.kaivon.app',
  year: 2026,
  /** Pro a month, in US dollars, and the student plan: Pro at 25% off for a school email. */
  price: 7.99,
  studentPrice: 5.99,
} as const;

/** Whether Pro can be bought yet (live Flutterwave keys). The app asks the server; the landing
 * page goes by the build. */
export const proLive = import.meta.env.VITE_PRO_LIVE === 'true';
