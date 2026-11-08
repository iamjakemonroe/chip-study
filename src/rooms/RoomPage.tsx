import { ArrowLeft, Clock, DoorOpen, GraduationCap, Hourglass, Lock, ShieldOff, Unlink, Users } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { AgeGate } from '../components/AgeGate.tsx';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Logo } from '../components/Logo.tsx';
import { site } from '../content/site.ts';
import { useAge } from '../store/age.ts';
import { useAuth } from '../store/auth.ts';
import { joinRoom, peekRoom, reasonText, RoomRefused, type JoinReason, type JoinResult, type RoomPeek } from './api.ts';
import { Lobby, type LobbyResult } from './Lobby.tsx';

const RoomScreen = lazy(() => import('./RoomScreen.tsx'));

/** A room's link: study.kaivon.app/room/<token>. Signing in comes first (and comes back here);
 * then what the room is, the age question if it's needed, a kind word for any reason you can't
 * join, the lobby, the waiting room when the host lets people in one by one, and the room. */
export function RoomPage() {
  const { token = '' } = useParams();
  const ready = useAuth((s) => s.ready);
  const session = useAuth((s) => s.session);
  if (!ready) return <ChipLoader />;
  if (!session) return <Navigate to={`/signin?next=${encodeURIComponent(`/room/${token}`)}`} replace />;
  return <RoomFlow key={token} token={token} />;
}

type Phase =
  | { k: 'peek' }
  | { k: 'failed'; message: string }
  | { k: 'refused'; reason: JoinReason | 'not_found' }
  | { k: 'lobby' }
  | { k: 'waiting'; join: LobbyResult }
  | { k: 'room'; join: JoinResult; media: LobbyResult };

const WAIT_POLL_MS = 4000;

function RoomFlow({ token }: { token: string }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.me);
  const userId = useAuth((s) => s.session?.user.id ?? '');
  const [peek, setPeek] = useState<RoomPeek | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: 'peek' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const look = useCallback(async () => {
    setPhase({ k: 'peek' });
    try {
      const p = await peekRoom(token);
      setPeek(p);
      if (!p.found) return setPhase({ k: 'refused', reason: 'not_found' });
      if (p.reason === 'age_unknown') {
        // The age question first; then look again.
        const answered = await useAge.getState().ensure(() => void look());
        if (!answered) return setPhase({ k: 'refused', reason: 'age_unknown' });
      }
      if (p.reason) return setPhase({ k: 'refused', reason: p.reason });
      setPhase({ k: 'lobby' });
    } catch (e) {
      if (e instanceof RoomRefused) return setPhase({ k: 'refused', reason: e.reason });
      setPhase({ k: 'failed', message: (e as Error).message });
    }
  }, [token]);

  useEffect(() => {
    document.title = 'Study room · Chip Study';
    void look();
    return () => {
      if (waitTimer.current) clearTimeout(waitTimer.current);
    };
  }, [look]);

  const join = async (media: LobbyResult) => {
    setBusy(true);
    setError('');
    try {
      const r = await joinRoom(token);
      if (r.state === 'waiting') {
        setPhase({ k: 'waiting', join: media });
        pollWaiting(media);
      } else setPhase({ k: 'room', join: r, media });
    } catch (e) {
      stopTracks(media);
      if (e instanceof RoomRefused) setPhase({ k: 'refused', reason: e.reason });
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** While waiting to be let in: asks again every few seconds (joining again is harmless). */
  const pollWaiting = (media: LobbyResult) => {
    if (waitTimer.current) clearTimeout(waitTimer.current);
    waitTimer.current = setTimeout(async () => {
      try {
        const r = await joinRoom(token);
        if (r.state === 'in') return setPhase({ k: 'room', join: r, media });
      } catch (e) {
        if (e instanceof RoomRefused) {
          stopTracks(media);
          return setPhase({ k: 'refused', reason: e.reason });
        }
      }
      pollWaiting(media);
    }, WAIT_POLL_MS);
  };

  const leaveWaiting = (media: LobbyResult) => {
    if (waitTimer.current) clearTimeout(waitTimer.current);
    stopTracks(media);
    navigate('/app');
  };

  if (phase.k === 'room' && peek) {
    return (
      <Suspense fallback={<ChipLoader label="Entering the room" />}>
        <RoomScreen token={token} peek={peek} join={phase.join} media={phase.media} />
      </Suspense>
    );
  }

  const name = me?.name?.trim() || 'You';
  const host = peek?.host ?? 'the host';
  let body: ReactNode;
  if (phase.k === 'peek') {
    body = (
      <div className="h-72">
        <ChipLoader page={false} label="Opening the room" />
      </div>
    );
  } else if (phase.k === 'failed') {
    body = (
      <Notice icon={<Unlink size={22} />} title="Couldn’t open this room">
        <p>{phase.message}</p>
        <button className="btn btn-primary mt-6" onClick={() => void look()}>
          Try again
        </button>
      </Notice>
    );
  } else if (phase.k === 'refused') {
    const t = reasonText(phase.reason, host);
    const icon = {
      ended: <Clock size={22} />,
      removed: <ShieldOff size={22} />,
      not_invited: <GraduationCap size={22} />,
      age_unknown: <Lock size={22} />,
      adults_only: <Lock size={22} />,
      not_found: <Unlink size={22} />,
    }[phase.reason];
    body = (
      <Notice icon={icon} title={t.title}>
        <p>{t.body}</p>
        {phase.reason === 'age_unknown' ? (
          <button className="btn btn-primary mt-6" onClick={() => void useAge.getState().ensure(() => void look())}>
            Answer the question
          </button>
        ) : (
          <Link to="/app" className="btn btn-primary mt-6">
            Go to my desk
          </Link>
        )}
      </Notice>
    );
  } else if (phase.k === 'waiting') {
    body = <Waiting host={host} title={peek?.title ?? ''} camera={phase.join.camOn ? phase.join.cam : null} onLeave={() => leaveWaiting(phase.join)} />;
  } else if (peek) {
    const free = !!peek.ends_at;
    const asking = peek.admission === 'ask' && peek.state !== 'in';
    body = (
      <Lobby
        title={peek.title ?? 'Study room'}
        userId={userId}
        name={name}
        lines={
          <>
            <p className="flex items-center gap-2">
              {peek.class_room ? <GraduationCap size={15} className="flex-none text-iris" /> : <Users size={15} className="flex-none text-iris" />}
              <span>{peek.class_room ? `A class room at ${peek.institution ?? 'your institution'}, run by ${host}` : `${host}’s study room`}</span>
            </p>
            <p className="flex items-center gap-2">
              <Clock size={15} className="flex-none text-iris" />
              <span>{free ? `Open until ${new Date(peek.ends_at!).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'No time limit'}</span>
            </p>
            {asking && (
              <p className="flex items-center gap-2">
                <DoorOpen size={15} className="flex-none text-iris" />
                <span>{peek.state === 'waiting' ? 'You’ve asked to join. The host lets you in.' : 'The host lets each person in.'}</span>
              </p>
            )}
          </>
        }
        joinLabel={asking ? (peek.state === 'waiting' ? 'Wait to be let in' : 'Ask to join') : 'Join now'}
        busy={busy}
        status={
          error ? (
            <p className="rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
              {error}
            </p>
          ) : null
        }
        onJoin={(r) => void join(r)}
        onBack={() => navigate('/app')}
      />
    );
  }

  return (
    <div className="min-h-dvh">
      <div className="daylight" />
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link to="/app" aria-label="Your desk">
          <Logo />
        </Link>
        <Link to="/app" className="btn btn-quiet btn-sm">
          <ArrowLeft size={16} /> Your desk
        </Link>
      </header>
      <main className={`mx-auto px-4 pb-24 pt-2 sm:px-5 ${phase.k === 'lobby' ? 'max-w-5xl' : 'max-w-2xl'}`}>{body}</main>
      <AgeGate />
    </div>
  );
}

function stopTracks(m: LobbyResult) {
  m.mic?.stop();
  m.cam?.stop();
}

function Waiting({ host, title, camera, onLeave }: { host: string; title: string; camera: MediaStreamTrack | null; onLeave: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v || !camera) return;
    v.srcObject = new MediaStream([camera]);
    void v.play().catch(() => undefined);
  }, [camera]);
  return (
    <div className="card px-6 py-10 text-center sm:px-10" role="status" aria-live="polite">
      {camera ? (
        <video ref={video} className="mx-auto h-28 w-28 scale-x-[-1] rounded-full object-cover ring-4 ring-iris-soft" muted playsInline autoPlay aria-label="Your camera" />
      ) : (
        <span className="room-waiting mx-auto grid h-14 w-14 place-items-center rounded-full bg-iris-soft text-iris">
          <Hourglass size={24} />
        </span>
      )}
      <h1 className="mt-5 text-[1.5rem] font-semibold tracking-[-0.02em]">Waiting to be let in</h1>
      <p className="mx-auto mt-2 max-w-md leading-relaxed text-ink-2">
        You’ve asked to join <strong className="font-semibold text-ink">{title}</strong>. {host} will let you in. This page goes into the room as soon as they do.
      </p>
      <button className="btn btn-ghost mt-7" onClick={onLeave}>
        Leave
      </button>
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
