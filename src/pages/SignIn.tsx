import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, GraduationCap, Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Logo } from '../components/Logo.tsx';
import { Orb } from '../components/Orb.tsx';
import { Spinner } from '../components/ui.tsx';
import { PLAN_PRICES, studentSaving } from '../content/site.ts';
import { formatMoney, useCurrency } from '../lib/currency.ts';
import { looksLikeSchoolEmail } from '../lib/school.ts';
import { safeNext } from '../lib/session.ts';
import { finishOAuth, sendCode, signInWith, SSO_ON, useAuth, verifyCode } from '../store/auth.ts';

const ease = [0.2, 0.7, 0.1, 1] as const;

/** Signing in with a Kaivon account (the same one as Utopia): an email, then the code we send. */
export function SignIn() {
  const session = useAuth((s) => s.session);
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const school = looksLikeSchoolEmail(email);
  const currency = useCurrency();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Sign in · Chip Study';
    if (SSO_ON) void finishOAuth().then((why) => why && setError(why));
  }, []);
  useEffect(() => {
    if (step === 'code') setTimeout(() => codeRef.current?.focus(), 250);
  }, [step]);

  if (session && !busy) return <Navigate to={next} replace />;

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setError('That email doesn’t look right.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await sendCode(address);
      setStep('code');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    const token = value.replace(/\D/g, '');
    if (token.length < 6) return;
    setBusy(true);
    setError('');
    try {
      await verifyCode(email.trim(), token);
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="daylight" />
      <aside className="relative hidden overflow-hidden lg:block" aria-hidden="true">
        <div className="signin-art absolute inset-4 overflow-hidden rounded-[2rem]">
          <div className="signin-blob signin-blob-a" />
          <div className="signin-blob signin-blob-b" />
          <div className="signin-blob signin-blob-c" />
          <div className="absolute inset-0 flex flex-col justify-between p-12">
            <Logo size={30} />
            <div className="max-w-md">
              <Orb size={72} />
              <p className="mt-8 text-[2rem] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">
                Understand anything. Really learn it.
              </p>
              <ul className="mt-8 space-y-3 text-ink-2">
                {['A tutor that guides you, not just answers', 'Practice that sticks, from your own notes', 'Assignment help you can declare, honestly'].map((t) => (
                  <li key={t} className="flex items-center gap-3">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-white/80 text-iris shadow-sm">
                      <Check size={14} strokeWidth={2.5} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-sm text-ink-3">Made by Kaivon</p>
          </div>
        </div>
      </aside>

      <main className="flex min-h-dvh flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <a href="/" className="lg:hidden" aria-label="Chip Study home">
            <Logo />
          </a>
          <a href="/" className="btn btn-quiet btn-sm">
            <ArrowLeft size={16} /> Home
          </a>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <AnimatePresence mode="wait">
            {step === 'email' ? (
              <motion.form
                key="email"
                onSubmit={send}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease }}
              >
                <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">Sign in to Chip Study</h1>
                <p className="mt-2 leading-relaxed text-ink-2">
                  Use your <strong className="font-semibold text-ink">Kaivon account</strong>, the same one you use in Utopia. New here? We’ll make you one.
                </p>
                {next.startsWith('/join/') && (
                  <p className="mt-3 rounded-2xl bg-iris-soft px-4 py-3 text-sm leading-relaxed text-iris-2">
                    You have an invite. Sign in with the email it was sent to, and it opens next.
                  </p>
                )}
                {next === '/lti' && (
                  <p className="mt-3 rounded-2xl bg-iris-soft px-4 py-3 text-sm leading-relaxed text-iris-2">
                    Sign in once to link your course. Next time, opening Chip Study from your course signs you straight in.
                  </p>
                )}
                {SSO_ON && (
                  <div className="mt-6 grid gap-2">
                    {(
                      [
                        ['google', 'Continue with Google'],
                        ['azure', 'Continue with Microsoft'],
                      ] as const
                    ).map(([provider, label]) => (
                      <button
                        key={provider}
                        type="button"
                        className="btn btn-ghost w-full"
                        disabled={busy}
                        onClick={async () => {
                          setError('');
                          try {
                            await signInWith(provider, next);
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }}
                      >
                        {provider === 'google' ? <GoogleMark /> : <MicrosoftMark />} {label}
                      </button>
                    ))}
                    <p className="my-2 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink-4">
                      <span className="h-px flex-1 bg-line" /> or with your email <span className="h-px flex-1 bg-line" />
                    </p>
                  </div>
                )}
                <label className="label mt-8" htmlFor="email">
                  Email
                </label>
                <div className="relative">
                  <Mail size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4" />
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    className="field pl-10"
                    placeholder="you@school.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                </div>
                <p className={`mt-2 flex items-center gap-1.5 text-sm ${school ? 'font-semibold text-mint' : 'text-ink-3'}`} aria-live="polite">
                  <GraduationCap size={15} className="flex-none" />
                  {school ? `A school email: Pro is yours at the student price, ${formatMoney(PLAN_PRICES[currency].student, currency)} a month.` : `Student? Use your school email and Pro is ${studentSaving(PLAN_PRICES[currency])}% off.`}
                </p>
                {error && (
                  <p className="mt-3 text-sm text-rose" role="alert">
                    {error}
                  </p>
                )}
                <button className="btn btn-primary mt-5 w-full" disabled={busy}>
                  {busy ? <Spinner /> : <>Email me a code <ArrowRight size={16} /></>}
                </button>
                <p className="mt-6 text-center text-xs leading-relaxed text-ink-3">
                  By continuing you agree to the <a className="underline underline-offset-2" href="/terms">Terms</a> and{' '}
                  <a className="underline underline-offset-2" href="/privacy">Privacy Policy</a>.
                </p>
              </motion.form>
            ) : (
              <motion.form
                key="code"
                onSubmit={(e) => {
                  e.preventDefault();
                  void verify();
                }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease }}
              >
                <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">Check your email</h1>
                <p className="mt-2 leading-relaxed text-ink-2">
                  We sent a code to <strong className="break-all font-semibold text-ink">{email.trim()}</strong>. It may come from Utopia: it’s the same account.
                </p>
                <label className="label mt-8" htmlFor="code">
                  Code
                </label>
                <input
                  id="code"
                  ref={codeRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="field text-center font-mono text-2xl tracking-[0.4em]"
                  placeholder="••••••••"
                  maxLength={10}
                  value={code}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 8);
                    setCode(v);
                    if (v.length === 8) void verify(v);
                  }}
                />
                {error && (
                  <p className="mt-3 text-sm text-rose" role="alert">
                    {error}
                  </p>
                )}
                <button className="btn btn-primary mt-5 w-full" disabled={busy || code.length < 6}>
                  {busy ? <Spinner /> : 'Sign in'}
                </button>
                <div className="mt-5 flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="font-medium text-ink-3 hover:text-ink"
                    onClick={() => {
                      setStep('email');
                      setCode('');
                      setError('');
                    }}
                  >
                    Use another email
                  </button>
                  <button
                    type="button"
                    className="font-medium text-iris hover:text-iris-2 disabled:text-ink-4"
                    disabled={busy || resent}
                    onClick={async () => {
                      await send();
                      setResent(true);
                      setTimeout(() => setResent(false), 60000);
                    }}
                  >
                    {resent ? 'Sent again' : 'Send a new code'}
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}
