import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIRM_EVERY,
  CONFIRM_FOR,
  classify,
  forgetPayment,
  readPaymentReturn,
  recallPayment,
  rememberPayment,
  settlePayment,
  withoutPaymentParams,
  type ConfirmAnswer,
  type PaymentReturn,
  type PaymentView,
} from '../../src/lib/payment.ts';

/** Asks with pretend time: each sleep moves the clock on. */
function run(ret: PaymentReturn, answers: (ConfirmAnswer | ((n: number) => ConfirmAnswer))[], alive = () => true) {
  let t = 0;
  let asked = 0;
  const shown: PaymentView[] = [];
  const confirm = vi.fn(async (): Promise<ConfirmAnswer> => {
    const a = answers[Math.min(asked, answers.length - 1)];
    asked++;
    return typeof a === 'function' ? a(asked) : a;
  });
  const done = settlePayment(ret, {
    confirm,
    show: (v) => shown.push(v),
    alive,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
  return { done, shown, confirm, elapsed: () => t };
}

const back = (status: string | null, transactionId: string | null = '9876'): PaymentReturn => ({ ref: 'kaivon-sub-1', status, transactionId });
const paid: ConfirmAnswer = { status: 'paid', until: '2026-12-09T00:00:00Z' };
const pending: ConfirmAnswer = { status: 'pending', until: null };

describe('coming back from checkout', () => {
  it('reads Flutterwave’s part of the address, and takes it off', () => {
    const params = new URLSearchParams('invoice=1&status=successful&tx_ref=kaivon-inv-9&transaction_id=123&tab=x');
    expect(readPaymentReturn(params)).toEqual({ ref: 'kaivon-inv-9', status: 'successful', transactionId: '123' });
    expect(withoutPaymentParams(params).toString()).toBe('tab=x');
    expect(readPaymentReturn(new URLSearchParams('status=successful'))).toBeNull();
  });

  it('sorts web-pay’s answers', () => {
    expect(classify(paid)).toEqual({ state: 'paid', until: paid.until, amount: null, currency: null });
    expect(classify({ status: 'paid', until: null, amount: 6.49, currency: 'GBP' })).toMatchObject({ amount: 6.49, currency: 'GBP' });
    expect(classify({ status: 'failed', until: null })).toEqual({ state: 'failed' });
    expect(classify({ status: 'cancelled', until: null })).toEqual({ state: 'failed' });
    expect(classify({ status: 'unknown', until: null })).toEqual({ state: 'unconfirmed', why: 'unknown' });
    expect(classify({ status: 'other', until: null })).toEqual({ state: 'unconfirmed', why: 'other' });
    expect(classify({ status: 'signin', until: null })).toEqual({ state: 'unconfirmed', why: 'signin' });
    expect(classify(pending)).toBe('again');
    expect(classify({ status: 'unreachable', until: null })).toBe('again');
  });
});

describe('settling a payment', () => {
  it('a cancelled checkout fails at once, without asking', async () => {
    const r = run(back('cancelled', null), [paid]);
    expect(await r.done).toEqual({ state: 'failed' });
    expect(r.confirm).not.toHaveBeenCalled();
    expect(r.shown).toEqual([{ state: 'failed' }]);
  });

  it('with no transaction it can’t be confirmed', async () => {
    const r = run(back('successful', null), [paid]);
    expect(await r.done).toEqual({ state: 'unconfirmed', why: 'missing' });
    expect(r.confirm).not.toHaveBeenCalled();
  });

  it('paid at once: confirming, then paid', async () => {
    const r = run(back('successful'), [paid]);
    expect(await r.done).toMatchObject({ state: 'paid', until: paid.until });
    expect(r.shown.map((v) => v.state)).toEqual(['pending', 'paid']);
  });

  it('still going through: asks every few seconds, and is paid as soon as it is', async () => {
    const r = run(back('successful'), [pending, pending, { status: 'unreachable', until: null }, paid]);
    expect(await r.done).toMatchObject({ state: 'paid' });
    expect(r.confirm).toHaveBeenCalledTimes(4);
    expect(r.elapsed()).toBe(3 * CONFIRM_EVERY);
    expect(r.shown.map((v) => v.state)).toEqual(['pending', 'paid']);
  });

  it('a failed payment says so', async () => {
    const r = run(back('failed'), [{ status: 'failed', until: null }]);
    expect(await r.done).toEqual({ state: 'failed' });
  });

  it('after two minutes still pending: Flutterwave finishes it later', async () => {
    const r = run(back('successful'), [pending]);
    expect(await r.done).toEqual({ state: 'pending', late: true });
    // Asked at once and every CONFIRM_EVERY after, the last at two minutes.
    expect(r.elapsed()).toBe(CONFIRM_FOR);
    expect(r.confirm.mock.calls.length).toBe(CONFIRM_FOR / CONFIRM_EVERY + 1);
    expect(r.shown.at(-1)).toEqual({ state: 'pending', late: true });
  });

  it('never reached in two minutes: it couldn’t be confirmed', async () => {
    const r = run(back('successful'), [{ status: 'unreachable', until: null }]);
    expect(await r.done).toEqual({ state: 'unconfirmed', why: 'unreachable' });
  });

  it('another account’s payment, or one Flutterwave doesn’t know, can’t be confirmed here', async () => {
    expect(await run(back('successful'), [{ status: 'other', until: null }]).done).toEqual({ state: 'unconfirmed', why: 'other' });
    expect(await run(back('successful'), [{ status: 'unknown', until: null }]).done).toEqual({ state: 'unconfirmed', why: 'unknown' });
    expect(await run(back('successful'), [{ status: 'signin', until: null }]).done).toEqual({ state: 'unconfirmed', why: 'signin' });
  });

  it('stops asking once the page has gone', async () => {
    let on = true;
    const r = run(back('successful'), [() => ((on = false), pending)], () => on);
    await r.done;
    expect(r.confirm).toHaveBeenCalledTimes(1);
  });
});

describe('what a checkout was for', () => {
  beforeEach(() => localStorage.clear());

  it('is kept by reference until it’s settled', () => {
    rememberPayment({ ref: 'kaivon-sub-1', kind: 'pro', plan: 'student', title: 'Chip Study Pro', amount: 4.99, currency: 'GBP' });
    expect(recallPayment('kaivon-sub-1')).toMatchObject({ kind: 'pro', plan: 'student', amount: 4.99, currency: 'GBP' });
    expect(recallPayment('kaivon-sub-2')).toBeNull();
    forgetPayment('kaivon-sub-1');
    expect(recallPayment('kaivon-sub-1')).toBeNull();
  });

  it('keeps only the last few, for a week', () => {
    const now = Date.now();
    rememberPayment({ ref: 'old', kind: 'pro', title: 'x', amount: 1, currency: 'USD' }, now - 8 * 86_400_000);
    for (let i = 0; i < 12; i++) rememberPayment({ ref: `r${i}`, kind: 'pro', title: 'x', amount: 1, currency: 'USD' }, now);
    expect(recallPayment('old')).toBeNull();
    expect(recallPayment('r0')).toBeNull();
    expect(recallPayment('r11')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('chip-study.payments')!)).toHaveLength(10);
  });

  it('survives storage that isn’t there or isn’t a list', () => {
    localStorage.setItem('chip-study.payments', '{"nope":1}');
    expect(recallPayment('x')).toBeNull();
    localStorage.setItem('chip-study.payments', 'not json');
    expect(recallPayment('x')).toBeNull();
  });
});
