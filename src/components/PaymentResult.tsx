import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Hourglass, Info, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { site } from '../content/site.ts';
import { confirmPayment } from '../lib/api.ts';
import { formatMoney } from '../lib/currency.ts';
import { forgetPayment, readPaymentReturn, recallPayment, settlePayment, withoutPaymentParams, type PaymentIntent, type PaymentReturn, type PaymentView, type Unconfirmed } from '../lib/payment.ts';
import { Spinner } from './ui.tsx';

export interface PaymentResultState {
  ret: PaymentReturn;
  /** What was being paid for, if this device started the checkout. */
  intent: PaymentIntent | null;
  view: PaymentView;
}

export interface PaymentReturnHandle {
  result: PaymentResultState | null;
  open: boolean;
  close: () => void;
}

/** Back from Flutterwave on this page: takes the payment off the address straight away (a reload
 * doesn't confirm it again), then confirms it, every few seconds while it's still going through.
 * [onPaid] refreshes what the payment changed; [after] is the address's query once it's handled. */
export function usePaymentReturn({ onPaid, after }: { onPaid: () => unknown; after?: string }): PaymentReturnHandle {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<PaymentResultState | null>(null);
  const [open, setOpen] = useState(false);
  const started = useRef(false);
  const alive = useRef(true);
  const paid = useRef(onPaid);
  paid.current = onPaid;
  const rest = useRef(after);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (started.current) return;
    const ret = readPaymentReturn(params);
    if (!ret) return;
    started.current = true;
    const left = withoutPaymentParams(params);
    new URLSearchParams(rest.current ?? '').forEach((v, k) => left.set(k, v));
    setParams(left, { replace: true });
    const intent = recallPayment(ret.ref);
    setOpen(true);
    void settlePayment(ret, {
      confirm: confirmPayment,
      alive: () => alive.current,
      show: (view) => setResult({ ret, intent, view }),
    }).then(async (view) => {
      if (view.state !== 'paid') return;
      forgetPayment(ret.ref);
      await paid.current();
    });
  }, [params, setParams]);

  return { result, open: open && !!result, close: () => setOpen(false) };
}

const ease = [0.2, 0.7, 0.1, 1] as const;

/** The result of a payment, back from Flutterwave: confirming, paid, still going through, didn't
 * go through, or couldn't be confirmed. A dialog: focus stays inside it, Escape closes it, and each
 * change is read out. */
export function PaymentResult({
  payment,
  kind,
  onRetry,
  retrying = false,
}: {
  payment: PaymentReturnHandle;
  /** What this page takes payments for, when the device doesn't know (paid elsewhere). */
  kind: PaymentIntent['kind'];
  /** Starts the same payment again. */
  onRetry?: (intent: PaymentIntent | null) => void;
  retrying?: boolean;
}) {
  const { result, open, close } = payment;
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const closeRef = useRef(close);
  closeRef.current = close;
  const state = result?.view.state;
  const late = result?.view.state === 'pending' && result.view.late;

  // Focus: into the dialog when it opens (and onto the new main button as it changes), kept inside
  // it, and back where it was when it closes.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      const box = panel.current;
      if (!box) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // Every Tab is moved here, round the dialog's buttons and links: Safari's own Tab skips
      // buttons, and would leave the dialog.
      e.preventDefault();
      const items = [...box.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return box.focus();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === -1 || at === items.length - 1 ? 0 : at + 1;
      items[next].focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (before && before !== document.body) before.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const box = panel.current;
      (box?.querySelector<HTMLElement>('[data-autofocus]') ?? box)?.focus();
    }, 40);
    return () => clearTimeout(t);
  }, [open, state, late]);

  if (typeof document === 'undefined') return null;
  const intent = result?.intent ?? null;
  const what = intent?.kind ?? kind;

  return createPortal(
    <AnimatePresence>
      {open && result && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
          <motion.div
            className="absolute inset-0 bg-[rgb(25_26_46/0.32)] backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={close}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-body`}
            tabIndex={-1}
            data-payment={late ? 'late' : state}
            className="relative w-full max-w-[440px] overflow-hidden rounded-t-[1.75rem] bg-white shadow-[var(--shadow-lift)] outline-none sm:rounded-[1.75rem]"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35, ease }}
          >
            {state === 'paid' && <span className="glow-spot pointer-events-none absolute -top-28 left-1/2 h-64 w-64 -translate-x-1/2" style={{ ['--glow' as string]: 'var(--color-mint-soft)' }} aria-hidden="true" />}
            <button className="icon-btn absolute right-3 top-3 z-10" onClick={close} aria-label="Close">
              <X size={18} />
            </button>
            <div className="relative px-6 pb-6 pt-8 text-center sm:px-8 sm:pb-7 safe-bottom">
              <Body result={result} what={what} reduce={!!reduce} titleId={`${id}-title`} bodyId={`${id}-body`} />
              <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
                {state === 'failed' ? (
                  <>
                    <button className="btn btn-ghost" onClick={close}>
                      Close
                    </button>
                    {onRetry && (
                      <button className="btn btn-iris" data-autofocus disabled={retrying} onClick={() => onRetry(intent)}>
                        {retrying ? <Spinner /> : 'Try again'}
                      </button>
                    )}
                  </>
                ) : state === 'paid' ? (
                  <button className="btn btn-iris sm:min-w-44" data-autofocus onClick={close}>
                    {what === 'pro' ? 'Start studying' : 'Done'}
                  </button>
                ) : (
                  <button className={`btn ${state === 'pending' && !late ? 'btn-ghost' : 'btn-primary'} sm:min-w-32`} data-autofocus onClick={close}>
                    Close
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function dateText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

const support = (
  <a className="font-semibold text-iris underline-offset-2 hover:underline" href={`mailto:${site.email}`}>
    {site.email}
  </a>
);

const UNCONFIRMED: Record<Unconfirmed, (thing: string) => ReactNode> = {
  signin: (thing) => <>You’re signed out. If the payment went through, {thing} is on the account you paid from: sign in with it to see it.</>,
  other: (thing) => <>This payment was made from a different Chip Study account, so {thing} is on that one. Sign in with it to see it.</>,
  unknown: () => <>Flutterwave doesn’t recognise this payment. If you were charged, write to {support} with the reference below, and we’ll put it right.</>,
  missing: () => <>Flutterwave didn’t say how the payment went. If you were charged, it finishes by itself once Flutterwave confirms; if nothing changes, write to {support} with the reference below.</>,
  unreachable: () => <>We couldn’t reach the payment service to check it. If you were charged, it finishes by itself once Flutterwave confirms; if nothing changes in a few minutes, write to {support} with the reference below.</>,
};

function Body({ result, what, reduce, titleId, bodyId }: { result: PaymentResultState; what: PaymentIntent['kind']; reduce: boolean; titleId: string; bodyId: string }) {
  const { view, intent, ret } = result;
  const thing = what === 'pro' ? 'Pro' : 'the paid seats';
  const reference = (
    <p className="mt-4 text-xs text-ink-3">
      Reference <span className="select-all break-all font-mono text-ink-2">{ret.ref}</span>
    </p>
  );
  let icon: ReactNode;
  let title: string;
  let body: ReactNode;
  let more: ReactNode = null;
  if (view.state === 'paid') {
    const amount = view.amount ?? intent?.amount ?? null;
    const currency = view.currency ?? intent?.currency ?? null;
    const until = dateText(view.until);
    icon = <Tick reduce={reduce} />;
    title = what === 'pro' ? 'You’re on Pro' : 'Invoice paid';
    body = what === 'pro' ? 'Thank you. Chip’s best model, web research and everything in Pro are yours.' : 'Thank you. Your students keep Pro, on paid seats.';
    const rows: [string, string][] = [];
    if (what === 'pro') rows.push(['Plan', intent?.plan === 'student' ? 'Chip Study Pro, student price' : 'Chip Study Pro']);
    else if (intent?.title) rows.push(['Invoice', intent.title]);
    if (amount !== null && currency) rows.push(['Paid', formatMoney(amount, currency)]);
    if (until) rows.push([what === 'pro' ? 'Renews on' : 'Seats until', until]);
    more = rows.length ? (
      <dl className="mt-6 divide-y divide-line rounded-2xl border border-line bg-paper/60 text-left text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-3">
            <dt className="flex-none text-ink-3">{k}</dt>
            <dd className="min-w-0 text-right font-semibold text-ink [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
    ) : null;
  } else if (view.state === 'pending' && !view.late) {
    icon = (
      <span className="grid h-16 w-16 place-items-center rounded-full bg-iris-soft text-iris">
        <Spinner size={26} />
      </span>
    );
    title = 'Confirming your payment…';
    body = 'Flutterwave is checking it with your bank. This usually takes a few seconds.';
  } else if (view.state === 'pending') {
    icon = (
      <span className="grid h-16 w-16 place-items-center rounded-full bg-sand-soft text-[#9a7623]">
        <Hourglass size={26} />
      </span>
    );
    title = 'Still going through';
    body = <>We’ll finish this as soon as Flutterwave confirms. You can close this: {what === 'pro' ? 'Pro starts by itself' : 'the paid seats start by themselves'} once it does.</>;
    more = reference;
  } else if (view.state === 'failed') {
    icon = (
      <span className="grid h-16 w-16 place-items-center rounded-full bg-rose-soft text-rose">
        <X size={28} strokeWidth={2.4} />
      </span>
    );
    title = 'Payment not completed';
    body = 'The payment didn’t go through. Nothing was charged.';
  } else {
    icon = (
      <span className="grid h-16 w-16 place-items-center rounded-full bg-sand-soft text-[#9a7623]">
        <Info size={26} />
      </span>
    );
    title = 'We couldn’t confirm this payment';
    body = UNCONFIRMED[view.why](thing);
    more = view.why === 'signin' || view.why === 'other' ? null : reference;
  }
  return (
    <>
      <div className="flex justify-center" aria-hidden="true">
        {icon}
      </div>
      <div aria-live="polite" aria-atomic="true">
        <h2 id={titleId} className="mt-5 text-xl font-semibold tracking-[-0.015em]">
          {title}
        </h2>
        <p id={bodyId} className="mx-auto mt-2 max-w-[34ch] leading-relaxed text-ink-2">
          {body}
        </p>
      </div>
      {more}
    </>
  );
}

/** The paid tick: the circle settles, the check draws itself, and a ring fades out. Still, with
 * reduced motion. */
function Tick({ reduce }: { reduce: boolean }) {
  return (
    <motion.span
      className="relative grid h-16 w-16 place-items-center rounded-full bg-mint-soft"
      initial={reduce ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
    >
      {!reduce && (
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-mint"
          initial={{ scale: 1, opacity: 0.55 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.9, delay: 0.3, ease: 'easeOut' }}
        />
      )}
      <svg viewBox="0 0 32 32" width="30" height="30">
        <motion.path
          d="M9 16.5l4.6 4.6L23.2 11.4"
          fill="none"
          stroke="var(--color-mint)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45, delay: 0.18, ease }}
        />
      </svg>
    </motion.span>
  );
}
