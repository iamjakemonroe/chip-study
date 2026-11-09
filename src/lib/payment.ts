/** Coming back from Flutterwave's checkout (?status=…&tx_ref=…&transaction_id=…): what was being
 * paid for, and asking web-pay until the payment is settled. Pure apart from localStorage, so the
 * whole of it can be tested. */

/** What a checkout was for, kept on the device before going to Flutterwave, so the result can
 * say what was bought and what it cost, in the currency it was charged in. */
export interface PaymentIntent {
  ref: string;
  kind: 'pro' | 'institution';
  /** "Chip Study Pro", or the invoice's label. */
  title: string;
  amount: number;
  currency: string;
  /** Pro: which plan, so Try again starts the same one. */
  plan?: 'pro' | 'student';
  /** An invoice: which one, so Try again pays the same one. */
  invoiceId?: string;
  at: number;
}

const KEY = 'chip-study.payments';
/** Long enough for any checkout to come back; older ones are dropped. */
const KEEP_MS = 7 * 86_400_000;

function readAll(): PaymentIntent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? (list as PaymentIntent[]).filter((p) => p && typeof p.ref === 'string') : [];
  } catch {
    return [];
  }
}

function writeAll(list: PaymentIntent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private browsing: the result still shows, without the amount.
  }
}

export function rememberPayment(intent: Omit<PaymentIntent, 'at'>, now = Date.now()) {
  const kept = readAll().filter((p) => p.ref !== intent.ref && now - p.at < KEEP_MS);
  writeAll([...kept.slice(-9), { ...intent, at: now }]);
}

export function recallPayment(ref: string): PaymentIntent | null {
  return readAll().find((p) => p.ref === ref) ?? null;
}

export function forgetPayment(ref: string) {
  writeAll(readAll().filter((p) => p.ref !== ref));
}

/** What Flutterwave put on the address coming back. */
export interface PaymentReturn {
  ref: string;
  status: string | null;
  transactionId: string | null;
}

export const RETURN_PARAMS = ['status', 'tx_ref', 'transaction_id', 'invoice'];

export function readPaymentReturn(params: URLSearchParams): PaymentReturn | null {
  const ref = params.get('tx_ref');
  if (!ref) return null;
  return { ref, status: params.get('status'), transactionId: params.get('transaction_id') };
}

/** The address without Flutterwave's part, so a reload doesn't confirm it again. */
export function withoutPaymentParams(params: URLSearchParams): URLSearchParams {
  const rest = new URLSearchParams(params);
  RETURN_PARAMS.forEach((k) => rest.delete(k));
  return rest;
}

/** web-pay's answer to { action: "confirm" }: "paid" (with until), Flutterwave's own status
 * ("pending", "failed", …), "unknown" (not this payment), "other" (another account's); here also
 * "unreachable" (the call failed) and "signin" (not signed in). */
export interface ConfirmAnswer {
  status: string;
  until: string | null;
  amount?: number | null;
  currency?: string | null;
}

export type Unconfirmed = 'signin' | 'unknown' | 'other' | 'unreachable' | 'missing';

/** What the result shows. */
export type PaymentView =
  | { state: 'pending'; late: boolean }
  | { state: 'paid'; until: string | null; amount: number | null; currency: string | null }
  | { state: 'failed' }
  | { state: 'unconfirmed'; why: Unconfirmed };

const FAILED = new Set(['failed', 'cancelled', 'canceled', 'declined', 'abandoned', 'reversed']);

/** One answer, sorted: settled (paid, failed, can't be confirmed) or still to ask again. */
export function classify(answer: ConfirmAnswer): PaymentView | 'again' {
  const s = answer.status.toLowerCase();
  if (s === 'paid') {
    return { state: 'paid', until: answer.until, amount: typeof answer.amount === 'number' ? answer.amount : null, currency: answer.currency ?? null };
  }
  if (FAILED.has(s)) return { state: 'failed' };
  if (s === 'unknown' || s === 'other' || s === 'signin') return { state: 'unconfirmed', why: s };
  // "pending", Flutterwave's other in-between states, and a call that didn't get through.
  return 'again';
}

/** How often, and for how long, a payment that's still going through is asked about. */
export const CONFIRM_EVERY = 3000;
export const CONFIRM_FOR = 120_000;

/** Back from checkout: settles what Flutterwave's address already says (cancelled, no
 * transaction), else asks web-pay every CONFIRM_EVERY until the payment is settled or
 * CONFIRM_FOR has passed. [show] gets each view as it changes; the last is returned. */
export async function settlePayment(
  ret: PaymentReturn,
  deps: {
    confirm: (ref: string, transactionId: string) => Promise<ConfirmAnswer>;
    show: (view: PaymentView) => void;
    /** False once nobody is looking (the page has gone): stop asking. */
    alive?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    every?: number;
    window?: number;
  },
): Promise<PaymentView> {
  const { confirm, show, alive = () => true, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, every = CONFIRM_EVERY, window = CONFIRM_FOR } = deps;
  const status = ret.status?.toLowerCase() ?? '';
  const done = (view: PaymentView) => (show(view), view);
  if (FAILED.has(status) && !ret.transactionId) return done({ state: 'failed' });
  if (!ret.transactionId) return done({ state: 'unconfirmed', why: 'missing' });
  const start = now();
  let reached = false;
  show({ state: 'pending', late: false });
  for (;;) {
    const answer = await confirm(ret.ref, ret.transactionId);
    if (answer.status !== 'unreachable') reached = true;
    const view = classify(answer);
    if (view !== 'again') return done(view);
    if (now() - start + every > window || !alive()) {
      // Flutterwave hasn't settled it yet (its webhook finishes it later), or it couldn't be asked.
      return done(reached ? { state: 'pending', late: true } : { state: 'unconfirmed', why: 'unreachable' });
    }
    await sleep(every);
    if (!alive()) return { state: 'pending', late: false };
  }
}
