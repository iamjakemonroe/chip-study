import { ArrowLeft, Clock, LinkIcon, MailX, Unlink } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Logo } from '../components/Logo.tsx';
import { Orb } from '../components/Orb.tsx';
import { Spinner } from '../components/ui.tsx';
import { site } from '../content/site.ts';
import { ConsentBody } from '../institution/Consent.tsx';
import { acceptInvite, peekInvite } from '../lib/api.ts';
import { aRole } from '../lib/institutions.ts';
import type { InvitePeek } from '../lib/types.ts';
import { AgeGate } from '../components/AgeGate.tsx';
import { useAge } from '../store/age.ts';
import { useAuth } from '../store/auth.ts';
import { useInstitutions } from '../store/institutions.ts';
import { toast } from '../store/toast.ts';

/** An invite link from an institution: study.kaivon.app/join/<token>. Signing in comes first
 * (and comes back here); then what the invite is for, what joining means, and in. A link that's
 * been used, has run out, was cancelled, or is for another email says so, kindly. */
export function JoinPage() {
  const { token = '' } = useParams();
  const ready = useAuth((s) => s.ready);
  const session = useAuth((s) => s.session);
  if (!ready) return <ChipLoader />;
  if (!session) return <Navigate to={`/signin?next=${encodeURIComponent(`/join/${token}`)}`} replace />;
  return <Join token={token} />;
}

function Join({ token }: { token: string }) {
  const navigate = useNavigate();
  const email = useAuth((s) => s.session?.user.email ?? '');
  const signOut = useAuth((s) => s.signOut);
  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Your invite · Chip Study';
    let on = true;
    peekInvite(token)
      .then((p) => on && setPeek(p))
      .catch((e) => on && setFailed((e as Error).message));
    return () => {
      on = false;
    };
  }, [token]);

  const join = async () => {
    setError('');
    // The age question comes first, if it hasn't been answered; then Join again.
    if (!(await useAge.getState().ensure())) return;
    setBusy(true);
    try {
      const r = await acceptInvite(token);
      await Promise.all([useAuth.getState().refresh(), useInstitutions.getState().load(true)]);
      if (r.role === 'student') {
        toast(`Welcome to ${r.name}. Chip Study Pro is yours while you’re there.`, 'good');
        navigate('/app', { replace: true });
      } else {
        toast(`You’re ${aRole(r.role)} at ${r.name} now.`, 'good');
        navigate(`/app/institution/${r.institution_id}`, { replace: true });
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const switchEmail = async () => {
    await signOut();
    navigate(`/signin?next=${encodeURIComponent(`/join/${token}`)}`, { replace: true });
  };

  const name = peek?.institution ?? 'the institution';
  let body: ReactNode;
  if (failed) {
    body = (
      <Notice icon={<Unlink size={22} />} title="Couldn’t open this invite">
        <p>{failed}</p>
        <button className="btn btn-primary mt-6" onClick={() => location.reload()}>
          Try again
        </button>
      </Notice>
    );
  } else if (!peek) {
    body = (
      <div className="h-72">
        <ChipLoader page={false} label="Opening your invite" />
      </div>
    );
  } else if (peek.status === 'unknown') {
    body = (
      <Notice icon={<Unlink size={22} />} title="This link doesn’t work">
        <p>It may have been cut short when it was copied. Check you have all of it, or ask whoever sent it for a new one.</p>
        <Desk />
      </Notice>
    );
  } else if (peek.status === 'used') {
    body = (
      <Notice icon={<LinkIcon size={22} />} title="This link has been used">
        <p>Each invite link works once. If you used it, you’re already part of {name}: it’s all on your desk. If not, ask {name} for a new link.</p>
        <Desk />
      </Notice>
    );
  } else if (peek.status === 'expired') {
    body = (
      <Notice icon={<Clock size={22} />} title="This link has run out">
        <p>Invite links last 30 days. Ask {name} to send you a new one.</p>
        <Desk />
      </Notice>
    );
  } else if (peek.status === 'revoked') {
    body = (
      <Notice icon={<Unlink size={22} />} title="This link was cancelled">
        <p>{name} cancelled this invite. If that’s a mistake, ask them for a new one.</p>
        <Desk />
      </Notice>
    );
  } else if (!peek.email_matches) {
    body = (
      <Notice icon={<MailX size={22} />} title="This invite is for another email">
        <p>
          You’re signed in as <strong className="break-all font-semibold text-ink">{email}</strong>, but {name} sent this link to a different email. Sign in with that one to join, or ask them to invite this email instead.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary" onClick={() => void switchEmail()}>
            Sign in with another email
          </button>
          <Link to="/app" className="btn btn-ghost">
            Go to my desk
          </Link>
        </div>
      </Notice>
    );
  } else {
    const role = peek.role ?? 'student';
    body = (
      <div className="card px-6 py-8 sm:px-9 sm:py-10">
        <div className="text-center">
          <Orb size={52} className="mx-auto" />
          <p className="mt-5 text-sm font-semibold text-iris">You’re invited</p>
          <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
            Join {name}
            {role !== 'student' ? ` as ${aRole(role)}` : ''}
          </h1>
        </div>
        <div className="mt-6">
          <ConsentBody name={peek.institution} role={role} className={peek.class} />
        </div>
        {error && (
          <p className="mt-5 rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
            {error}
          </p>
        )}
        <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Link to="/app" className="btn btn-ghost">
            Not now
          </Link>
          <button className="btn btn-iris" disabled={busy} onClick={() => void join()}>
            {busy ? <Spinner /> : `Join ${name}`}
          </button>
        </div>
        <p className="mt-5 text-center text-xs text-ink-4">
          Signed in as <span className="break-all">{email}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <div className="daylight" />
      <header className="mx-auto flex max-w-2xl items-center justify-between px-5 py-5">
        <Link to="/app" aria-label="Your desk">
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

function Desk() {
  return (
    <Link to="/app" className="btn btn-primary mt-6">
      Go to my desk
    </Link>
  );
}
