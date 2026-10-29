import { Check, GraduationCap, Sparkles, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Orb } from '../components/Orb.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { Confirm, Ring, Spinner } from '../components/ui.tsx';
import { chipTime, describe } from '../lib/allowance.ts';
import { cancelPro, confirmPayment, payStatus, subscribePro } from '../lib/api.ts';
import { FREE_FEATURES, PRO_FEATURES, SCHOOL_EMAILS, STUDENT_FEATURES } from '../content/plans.ts';
import { site } from '../content/site.ts';
import { useAuth } from '../store/auth.ts';
import { toast } from '../store/toast.ts';

/** Your plan: what's left of Chip time, Free and Pro side by side, and paying for Pro (once it's
 * open). A school email sees Pro at the student price (and can still pick full Pro); anyone else
 * hears that students get it. Coming back from Flutterwave's checkout lands here to confirm the
 * payment. */
export function PlanPage() {
  const me = useAuth((s) => s.me);
  const refresh = useAuth((s) => s.refresh);
  const [params, setParams] = useSearchParams();
  const [pay, setPay] = useState<{ on: boolean; test: boolean } | null>(null);
  const [busy, setBusy] = useState<'pro' | 'student' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const confirmed = useRef(false);

  useEffect(() => {
    document.title = 'Your plan · Chip Study';
    void payStatus().then(setPay);
    void refresh();
  }, [refresh]);

  // Back from checkout: ?status=successful&tx_ref=…&transaction_id=…
  useEffect(() => {
    const ref = params.get('tx_ref');
    const id = params.get('transaction_id');
    const status = params.get('status');
    if (!ref || confirmed.current) return;
    confirmed.current = true;
    setParams({}, { replace: true });
    if (status !== 'successful' && status !== 'completed') {
      toast('The payment didn’t go through. Nothing was charged.', 'warn');
      return;
    }
    void confirmPayment(ref, id ?? '').then(async (r) => {
      if (r.status === 'paid') {
        await refresh();
        toast('Welcome to Pro. Chip’s best model is yours.', 'good');
      } else toast('We’re still confirming your payment. It can take a minute.', 'info');
    });
  }, [params, setParams, refresh]);

  const open = !!pay?.on && !pay.test;
  const fast = me ? chipTime(me, 'fast') : null;
  const best = me ? chipTime(me, 'best') : null;
  const price = me?.price?.amount ?? site.price;
  const studentPrice = me?.student_price?.amount ?? site.studentPrice;
  // The Pro card shows the student plan to a school email without Pro, and to its members.
  const asStudent = me?.plan === 'student' || (me?.tier === 'free' && !!me.student?.eligible);
  const shown = asStudent ? studentPrice : price;

  async function go(plan: 'pro' | 'student') {
    setBusy(plan);
    try {
      location.href = await subscribePro(plan);
    } catch (e) {
      toast((e as Error).message, 'warn');
      setBusy(null);
    }
  }

  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <h1 className="text-[2rem] font-semibold tracking-[-0.025em]">Your plan</h1>
        <p className="mt-1 text-ink-2">Chip’s time is counted fairly: a quick question uses less than a long draft.</p>

        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="card flex items-center gap-5 p-5">
            <Ring value={fast?.share ?? 0} size={72} stroke={6} color="var(--color-sky)">
              <Zap size={22} className="text-sky" />
            </Ring>
            <div>
              <p className="text-sm font-semibold text-ink-3">Chip Fast today</p>
              <p className="mt-0.5 text-lg font-semibold">{fast ? describe(fast) : '…'}</p>
            </div>
          </div>
          <div className="card flex items-center gap-5 p-5">
            <Ring value={best?.share ?? 0} size={72} stroke={6} color="var(--color-iris)">
              <Sparkles size={22} className={best ? 'text-iris' : 'text-ink-4'} />
            </Ring>
            <div>
              <p className="text-sm font-semibold text-ink-3">Chip’s best model</p>
              <p className="mt-0.5 text-lg font-semibold">{best ? describe(best) : 'With Pro'}</p>
              {me?.pro_until && <p className="text-sm text-ink-3">Pro until {new Date(me.pro_until).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</p>}
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-5 lg:grid-cols-2">
          <PlanCard
            name="Free"
            price="$0"
            note="Free, always"
            features={FREE_FEATURES}
            current={me?.tier === 'free'}
            footer={me?.tier === 'free' ? <span className="text-sm font-semibold text-ink-3">Your plan</span> : null}
          />
          <PlanCard
            name="Pro"
            tag={asStudent ? 'Student price' : undefined}
            price={`$${shown.toFixed(2)}`}
            was={asStudent ? `$${price.toFixed(2)}` : undefined}
            note="a month, cancel any time"
            features={asStudent ? STUDENT_FEATURES : PRO_FEATURES}
            current={me?.tier === 'pro'}
            glow
            footer={
              me?.tier === 'pro' ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setCancelling(true)}>
                  Cancel Pro
                </button>
              ) : pay === null ? (
                <Spinner />
              ) : open ? (
                <div>
                  <button className="btn btn-iris w-full sm:w-auto" disabled={!!busy} onClick={() => go(asStudent ? 'student' : 'pro')}>
                    {busy === (asStudent ? 'student' : 'pro') ? <Spinner /> : <>Go Pro for ${shown.toFixed(2)} a month</>}
                  </button>
                  {asStudent && (
                    <p className="mt-3 text-sm leading-relaxed text-ink-3">
                      Want more of the best model?{' '}
                      <button className="font-semibold text-iris disabled:opacity-60" disabled={!!busy} onClick={() => go('pro')}>
                        {busy === 'pro' ? 'Opening checkout…' : `Full Pro is $${price.toFixed(2)}`}
                      </button>
                      , with about 150 in-depth messages a month.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <span className="chip-tag bg-iris-soft text-iris-2">Coming soon</span>
                  <p className="mt-2 text-sm leading-relaxed text-ink-3">Pro opens very soon. Everything in Free works today.</p>
                </div>
              )
            }
          />
        </section>
        {me?.tier === 'free' && !me.student?.eligible && (
          <section className="card mt-5 flex gap-4 p-5" aria-label="Student price">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-mint-soft text-mint">
              <GraduationCap size={20} />
            </span>
            <div>
              <p className="font-semibold">Students get Pro for ${studentPrice.toFixed(2)} a month</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-3">
                That’s {Math.round((1 - studentPrice / price) * 100)}% off, on an account made with your school email ({SCHOOL_EMAILS}). It’s everything in Pro, with about 110 in-depth messages a month from Chip’s best model.
              </p>
            </div>
          </section>
        )}
        <p className="mt-6 text-center text-sm text-ink-3">Prices in US dollars. Your card’s bank converts if it’s in another currency. Payments by Flutterwave.</p>
      </main>
      <Confirm
        open={cancelling}
        title="Cancel Pro?"
        body="Nothing more will be charged. You keep Pro until the end of the month you’ve paid for, then Chip Study carries on free."
        yes="Cancel Pro"
        danger
        onClose={() => setCancelling(false)}
        onYes={async () => {
          try {
            const r = await cancelPro();
            await refresh();
            toast(r.until ? `Cancelled. Pro stays until ${new Date(r.until).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.` : 'Cancelled.', 'good');
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
    </div>
  );
}

export function PlanCard({
  name,
  tag,
  price,
  was,
  note,
  features,
  current,
  glow,
  footer,
}: {
  name: string;
  /** Beside the name, like "Student price". */
  tag?: string;
  price: string;
  /** The usual price, struck through beside a lower one. */
  was?: string;
  note: string;
  features: string[];
  current?: boolean;
  glow?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden rounded-[1.75rem] border bg-white p-6 sm:p-8 ${glow ? 'border-iris/25 shadow-[0_20px_60px_rgb(100_87_240/0.14)]' : 'border-line shadow-[var(--shadow-soft)]'}`}>
      {glow && <span className="glow-spot pointer-events-none absolute -right-24 -top-24 h-72 w-72" style={{ ['--glow' as string]: 'var(--color-iris-soft)' }} aria-hidden="true" />}
      <div className="relative">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {glow ? <Orb size={30} /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-sky-soft text-sky"><Zap size={16} /></span>}
          <h2 className="text-xl font-semibold">{name}</h2>
          {tag && <span className="chip-tag bg-iris-soft text-iris-2">{tag}</span>}
          {current && <span className="chip-tag bg-mint-soft text-mint">Current</span>}
        </div>
        <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-4xl font-semibold tracking-[-0.03em]">{price}</span>
          {was && (
            <s className="text-lg font-semibold text-ink-4">
              <span className="sr-only">usually </span>
              {was}
            </s>
          )}
          <span className="text-sm text-ink-3">{note}</span>
        </p>
        <ul className="mt-6 space-y-3">
          {features.map((f) => (
            <li key={f} className="flex gap-3 text-[0.9375rem] leading-snug text-ink-2">
              <Check size={18} className={`mt-px flex-none ${glow ? 'text-iris' : 'text-mint'}`} strokeWidth={2.4} />
              {f}
            </li>
          ))}
        </ul>
        {footer && <div className="mt-7">{footer}</div>}
      </div>
    </div>
  );
}
