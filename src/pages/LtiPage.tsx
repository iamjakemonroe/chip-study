import { ArrowLeft, BookOpen, CircleAlert, Link2, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { AgeGate } from '../components/AgeGate.tsx';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Logo } from '../components/Logo.tsx';
import { Spinner } from '../components/ui.tsx';
import { site } from '../content/site.ts';
import { ltiLink, ltiPendingPeek } from '../lib/api.ts';
import { aRole } from '../lib/institutions.ts';
import { forgetLtiArrival, ltiError, takeLtiArrival, type LtiArrival } from '../lib/lti.ts';
import { supabase } from '../lib/supabase.ts';
import type { LtiPending } from '../lib/types.ts';
import { useAge } from '../store/age.ts';
import { useAuth } from '../store/auth.ts';
import { useInstitutions } from '../store/institutions.ts';
import { toast } from '../store/toast.ts';

/** Where a learning platform (Moodle, Canvas, Blackboard, Brightspace) sends people: signed in
 * already (open their class), asked to sign in once to link their course account, or told kindly
 * what went wrong. Everything arrives in the address's fragment, which is read once and cleared. */
export function LtiPage() {
  const [arrival] = useState<LtiArrival>(() => takeLtiArrival());
  const ready = useAuth((s) => s.ready);

  useEffect(() => {
    document.title = 'From your course · Chip Study';
  }, []);

  let body: ReactNode;
  if (!ready) body = <Loading />;
  else if (arrival.kind === 'signin') body = <SignInArrival arrival={arrival} />;
  else if (arrival.kind === 'link') body = <LinkArrival token={arrival.token} />;
  else if (arrival.kind === 'error') {
    const e = ltiError(arrival.code);
    body = (
      <Notice icon={<CircleAlert size={22} />} title={e.title}>
        <p>{e.body}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {arrival.code === 'linked_elsewhere' && (
            <Link to="/signin?next=%2Fapp" className="btn btn-primary">
              Sign in
            </Link>
          )}
          <Link to="/" className={`btn ${arrival.code === 'linked_elsewhere' ? 'btn-ghost' : 'btn-primary'}`}>
            Go to Chip Study
          </Link>
        </div>
      </Notice>
    );
  } else {
    body = (
      <Notice icon={<BookOpen size={22} />} title="Open Chip Study from your course">
        <p>This page is where your learning platform sends you. Open Chip Study from the link in your course, or go to your desk.</p>
        <Link to="/app" className="btn btn-primary mt-6">
          Go to my desk
        </Link>
      </Notice>
    );
  }

  return (
    <div className="min-h-dvh">
      <div className="daylight" />
      <header className="mx-auto flex max-w-2xl items-center justify-between px-5 py-5">
        <Link to="/" aria-label="Chip Study home">
          <Logo />
        </Link>
        <Link to="/app" className="btn btn-quiet btn-sm">
          <ArrowLeft size={16} /> Your desk
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-4 sm:px-5">{body}</main>
      <AgeGate />
    </div>
  );
}

/** Where to go once in: a teacher to their institution's classes, a student to their desk. */
function openClass(navigate: ReturnType<typeof useNavigate>, inst: string | null, role: string | null) {
  void useInstitutions.getState().load(true);
  if (inst && (role === 'teacher' || role === 'admin')) navigate(`/app/institution/${inst}?tab=classes`, { replace: true });
  else navigate('/app', { replace: true });
}

/** Signed in by the platform: straight in, or first "Continue as <email>?" when the launch came
 * without its cookie (so nobody can push a launch into someone else's browser). */
function SignInArrival({ arrival }: { arrival: Extract<LtiArrival, { kind: 'signin' }> }) {
  const navigate = useNavigate();
  const [state, setState] = useState<'ask' | 'busy' | 'notme' | 'failed'>(arrival.confirm ? 'ask' : 'busy');
  const started = useRef(false);

  const go = async () => {
    // A sign-in link works once: never twice, even if asked twice.
    if (started.current) return;
    started.current = true;
    setState('busy');
    const { error } = await supabase.auth.verifyOtp({ token_hash: arrival.tokenHash, type: 'email' });
    forgetLtiArrival();
    if (error) {
      setState('failed');
      return;
    }
    await useAuth.getState().refresh();
    toast(arrival.role === 'student' ? 'You’re in, from your course.' : `You’re in, as ${aRole(arrival.role === 'admin' ? 'admin' : 'teacher')} of your course.`, 'good');
    openClass(navigate, arrival.inst, arrival.role);
  };

  useEffect(() => {
    if (!arrival.confirm) void go();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'busy') return <Loading label="Signing you in" />;
  if (state === 'failed') {
    const e = ltiError('expired');
    return (
      <Notice icon={<CircleAlert size={22} />} title={e.title}>
        <p>{e.body}</p>
        <Link to="/" className="btn btn-primary mt-6">
          Go to Chip Study
        </Link>
      </Notice>
    );
  }
  if (state === 'notme') {
    return (
      <Notice icon={<ShieldCheck size={22} />} title="No problem">
        <p>Nothing has changed. If this isn’t your course, close this tab. To use Chip Study as yourself, sign in.</p>
        <Link to="/signin" className="btn btn-primary mt-6">
          Sign in
        </Link>
      </Notice>
    );
  }
  return (
    <div className="card px-6 py-9 text-center sm:px-10">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-iris-soft text-iris">
        <ShieldCheck size={22} />
      </span>
      <h1 className="mt-5 text-[1.5rem] font-semibold tracking-[-0.02em]">
        Continue as <span className="break-all">{arrival.confirm}</span>?
      </h1>
      <p className="mx-auto mt-2 max-w-md leading-relaxed text-ink-2">You opened Chip Study from your course. To keep your account safe, check this is you before we sign you in.</p>
      <div className="mt-7 flex flex-col-reverse justify-center gap-2 sm:flex-row">
        <button className="btn btn-ghost" onClick={() => (forgetLtiArrival(), setState('notme'))}>
          Not me
        </button>
        <button className="btn btn-primary" onClick={() => void go()}>
          Continue
        </button>
      </div>
    </div>
  );
}

/** A launch to link: what it's for, then signing in (any way), then linking it and joining. */
function LinkArrival({ token }: { token: string }) {
  const navigate = useNavigate();
  const session = useAuth((s) => s.session);
  const email = session?.user.email ?? '';
  const [peek, setPeek] = useState<LtiPending | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let on = true;
    ltiPendingPeek(token)
      .then((p) => on && setPeek(p))
      .catch((e) => on && setError((e as Error).message));
    return () => {
      on = false;
    };
  }, [token]);

  const link = async () => {
    setError('');
    if (!(await useAge.getState().ensure())) return;
    setBusy(true);
    try {
      const r = await ltiLink(token);
      forgetLtiArrival();
      await useAuth.getState().refresh();
      toast('Your course is linked. Next time it opens Chip Study, you’re straight in.', 'good');
      openClass(navigate, r.institution_id, r.role);
    } catch (e) {
      const raw = (e as { raw?: string }).raw ?? '';
      if (/link expired/.test(raw)) {
        forgetLtiArrival();
        setGone(true);
      } else setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!peek && !error) return <Loading />;
  if (gone || (peek && !peek.found)) {
    return (
      <Notice icon={<CircleAlert size={22} />} title="That link has run out">
        <p>Linking your course lasts an hour. Open Chip Study from your course again.</p>
        <Link to="/" className="btn btn-primary mt-6">
          Go to Chip Study
        </Link>
      </Notice>
    );
  }

  return (
    <div className="card px-6 py-9 sm:px-10">
      <div className="text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-iris-soft text-iris">
          <Link2 size={22} />
        </span>
        <p className="mt-5 text-sm font-semibold text-iris">From {peek?.platform || 'your learning platform'}</p>
        <h1 className="mt-1 text-[1.5rem] font-semibold leading-tight tracking-[-0.02em]">Link your course to Chip Study</h1>
      </div>
      {peek && (
        <dl className="mt-6 space-y-2 rounded-2xl bg-paper px-4 py-3 text-sm">
          <Row label="Institution" value={peek.institution ?? ''} />
          {peek.course && <Row label="Course" value={peek.course} />}
          <Row label="You’ll be" value={peek.teacher ? 'A teacher of this course' : 'A student in this course'} />
          {peek.email && <Row label="Your course email" value={peek.email} />}
        </dl>
      )}
      <p className="mt-5 text-[0.9375rem] leading-relaxed text-ink-2">
        Sign in to Chip Study once, any way you like, and your course account is linked to it. After that, opening Chip Study from your course signs you straight in.
      </p>
      {session && peek?.email && peek.email.toLowerCase() !== email.toLowerCase() && (
        <p className="mt-3 text-sm leading-relaxed text-ink-3">
          You’re signed in as <strong className="break-all font-semibold text-ink-2">{email}</strong>, not {peek.email}. That’s fine if this account is yours too.
        </p>
      )}
      {error && (
        <p className="mt-5 rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
          {error}
        </p>
      )}
      <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {session ? (
          <>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await useAuth.getState().signOut();
                navigate('/signin?next=%2Flti', { replace: true });
              }}
            >
              Use another account
            </button>
            <button className="btn btn-iris" disabled={busy} onClick={() => void link()}>
              {busy ? <Spinner /> : `Link and open as ${email}`}
            </button>
          </>
        ) : (
          <Link to="/signin?next=%2Flti" className="btn btn-iris">
            Sign in to link it
          </Link>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

function Loading({ label = 'Opening your course' }: { label?: string }) {
  return (
    <div className="h-72">
      <ChipLoader page={false} label={label} />
    </div>
  );
}

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="card px-6 py-10 text-center leading-relaxed text-ink-2 sm:px-10">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-iris-soft text-iris">{icon}</span>
      <h1 className="mt-5 text-[1.5rem] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      <div className="mx-auto mt-2 max-w-md">{children}</div>
      <p className="mt-8 text-xs text-ink-4">Questions? {site.email}</p>
    </div>
  );
}
