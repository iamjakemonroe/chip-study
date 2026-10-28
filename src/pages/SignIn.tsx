import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Logo } from '../components/Logo.tsx';
import { Orb } from '../components/Orb.tsx';
import { Spinner } from '../components/ui.tsx';
import { sendCode, useAuth, verifyCode } from '../store/auth.ts';

const ease = [0.2, 0.7, 0.1, 1] as const;

/** Signing in with a Kaivon account (the same one as Utopia): an email, then the code we send. */
export function SignIn() {
  const session = useAuth((s) => s.session);
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Sign in · Chip Study';
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

/** Only paths inside the app (never another site). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/app') && !next.startsWith('//') ? next : '/app';
}
