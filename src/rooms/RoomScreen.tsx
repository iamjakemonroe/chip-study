import { AnimatePresence, motion } from 'framer-motion';
import { CloudOff, DoorClosed, Info, ListChecks, MessageSquare, NotebookPen, RefreshCw, ScrollText, Sparkles, Timer, UserPlus, Users, WifiOff, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Logo } from '../components/Logo.tsx';
import { Orb } from '../components/Orb.tsx';
import { Segmented } from '../components/ui.tsx';
import { useAuth } from '../store/auth.ts';
import { toast } from '../store/toast.ts';
import { NotesPanel } from '../workspace/panels/NotesPanel.tsx';
import { TasksPanel } from '../workspace/panels/TasksPanel.tsx';
import { RoomBindingContext } from '../workspace/roomBinding.ts';
import { useWorkspace } from '../workspace/store.ts';
import type { JoinResult, RoomPeek } from './api.ts';
import { makeBinding } from './binding.ts';
import { ControlsBar } from './Controls.tsx';
import type { LobbyResult } from './Lobby.tsx';
import { ChatPanel } from './panels/ChatPanel.tsx';
import { PeoplePanel } from './panels/PeoplePanel.tsx';
import { RoomBrief } from './panels/RoomBrief.tsx';
import { RoomChip } from './panels/RoomChip.tsx';
import { isManager } from './people.ts';
import { RoomWorkspace } from './RoomWorkspace.tsx';
import { roomSession, RoomSession } from './session.ts';
import { ShareSheet } from './ShareSheet.tsx';
import { openPanel, useRoom, type RoomEnd, type RoomPanel } from './store.ts';
import { RoomAudio, Stage, TileStrip, useStage } from './Tiles.tsx';

const ease = [0.2, 0.7, 0.1, 1] as const;

function useMedia(query: string) {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const set = () => setOn(m.matches);
    m.addEventListener('change', set);
    return () => m.removeEventListener('change', set);
  }, [query]);
  return on;
}

/** The room: the shared work in the middle, people's video in a strip, a stage for a screen share
 * or a pinned person, the controls, and People, Chat, Chip and the shared plan, notes and brief
 * beside it (over it, on smaller screens). */
export default function RoomScreen({ token, peek, join, media }: { token: string; peek: RoomPeek; join: JoinResult; media: LobbyResult }) {
  const me = useAuth((s) => s.me);
  const userId = useAuth((s) => s.session?.user.id ?? '');
  const [session, setSession] = useState<RoomSession | null>(null);
  // A fresh room each visit: nothing shown from the last one.
  useState(() => {
    useRoom.getState().reset();
    useWorkspace.getState().reset();
    return 0;
  });

  // Made once the screen has settled (React's StrictMode sets screens up twice in development).
  useEffect(() => {
    let s: RoomSession | null = null;
    const t = setTimeout(() => {
      useWorkspace.getState().reset();
      useRoom.getState().reset();
      s = new RoomSession({
        roomId: join.room_id,
        token,
        title: peek.title ?? 'Study room',
        hostName: peek.host ?? 'the host',
        classRoom: !!peek.class_room,
        me: { id: userId, name: me?.name?.trim() || 'You' },
        role: join.role,
        canEdit: join.can_edit,
        mic: media.mic,
        micOn: media.micOn,
        cam: media.cam,
        camOn: media.camOn,
        devices: media.devices,
      });
      s.start();
      setSession(s);
    }, 0);
    return () => {
      clearTimeout(t);
      s?.stop();
      useWorkspace.getState().reset();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ended = useRoom((s) => s.ended);
  if (ended) return <Ended why={ended} token={token} />;
  if (!session) return null;
  return <Room session={session} />;
}

function Room({ session }: { session: RoomSession }) {
  const wide = useMedia('(min-width: 1100px)');
  const phone = useMedia('(max-width: 639px)');
  const generation = useRoom((s) => s.docGeneration);
  const you = useRoom((s) => s.you);
  const panel = useRoom((s) => s.panel);
  const view = useRoom((s) => s.view);
  const readonlyNotice = useRoom((s) => s.readonlyNotice);
  const manage = useRoom((s) => s.manage);
  const [sharing, setSharing] = useState(false);
  const stage = useStage();
  const canEdit = !!you?.canEdit;

  const binding = useMemo(
    () =>
      makeBinding({
        y: session.y,
        canEdit,
        me: { id: you?.userId ?? '', name: you?.name ?? '' },
        nameOf: (id) => session.nameOf(id),
        askChip: (mode, text, selection) => void session.askChip(mode, text, selection),
      }),
    [session, generation, canEdit, you?.userId, you?.name], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (readonlyNotice) {
      toast('That change wasn’t kept: you’re viewing. A host can let you edit.', 'info');
      useRoom.setState({ readonlyNotice: false });
    }
  }, [readonlyNotice]);

  // A host who opens the room, alone: the invite sheet, once.
  useEffect(() => {
    if (!manage) return;
    const key = `chip-study-room-invited:${manage.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    if (manage.members.filter((m) => m.state === 'in').length <= 1) setSharing(true);
  }, [manage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onStage = !!stage && view === 'stage';

  return (
    <RoomBindingContext.Provider value={binding}>
      <div className={`room ${phone ? 'is-phone' : ''}`}>
        <Header stageAvailable={!!stage} onShare={() => setSharing(true)} />
        <Banners />
        <div className="room-body">
          <main className="room-main" id="main">
            <TileStrip compact={phone} />
            <div className="room-work">{onStage ? <Stage stage={stage} onClose={() => useRoom.setState({ view: 'work' })} /> : <RoomWorkspace />}</div>
          </main>
          <AnimatePresence initial={false}>
            {wide && panel && (
              <motion.aside
                key="side"
                className="room-side"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--room-side-w)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.35, ease }}
                aria-label="Room panels"
              >
                <div className="room-side-inner">
                  <SidePanel />
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
        <ControlsBar compact={phone} onShare={() => setSharing(true)} />
        {!wide && (
          <AnimatePresence>
            {panel && (
              <motion.div className="fixed inset-0 z-50 flex justify-end" initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
                <motion.div className="absolute inset-0 bg-[rgb(25_26_46/0.25)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => openPanel(null)} />
                <motion.div
                  className="relative flex h-full w-full max-w-[440px] flex-col bg-[var(--color-paper)] shadow-[var(--shadow-lift)] sm:rounded-l-[1.75rem]"
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ duration: 0.35, ease }}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Room panels"
                >
                  <SidePanel closable />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        <RoomAudio />
        {manage && isManager(you?.role) && (
          <ShareSheet
            open={sharing}
            onClose={() => setSharing(false)}
            info={manage}
            onChange={(info) => {
              useRoom.setState({ manage: info });
              session.afterChange();
            }}
          />
        )}
      </div>
    </RoomBindingContext.Provider>
  );
}

function Header({ stageAvailable, onShare }: { stageAvailable: boolean; onShare: () => void }) {
  const title = useRoom((s) => s.title);
  const classRoom = useRoom((s) => s.classRoom);
  const people = useRoom((s) => s.people);
  const you = useRoom((s) => s.you);
  const view = useRoom((s) => s.view);
  const connection = useRoom((s) => s.connection);
  const here = people.filter((p) => p.connected).length || 1;
  return (
    <header className="room-header">
      <Link to="/app" className="hidden flex-none sm:block" aria-label="Chip Study" title="Chip Study (opens your desk; you stay in the room until you leave)" target="_blank" rel="noopener">
        <Logo word={false} size={26} />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="flex min-w-0 items-center gap-2 text-[0.98rem] font-semibold leading-tight tracking-[-0.01em]">
          <span className={`room-live ${connection === 'live' ? '' : 'is-away'}`} aria-hidden="true" />
          <span className="truncate">{title}</span>
        </h1>
        <p className="flex items-center gap-1.5 truncate text-xs text-ink-3">
          {classRoom ? 'Class room' : 'Study room'} · {here === 1 ? 'Just you' : `${here} here`}
          <span className="hidden sm:inline">· Nothing is recorded</span>
        </p>
      </div>
      {stageAvailable && (
        <Segmented
          size="sm"
          label="What’s in the middle"
          value={view}
          onChange={(v) => useRoom.setState({ view: v })}
          options={[
            { value: 'work', label: 'Work' },
            { value: 'stage', label: 'Stage' },
          ]}
        />
      )}
      <Countdown />
      {isManager(you?.role) && (
        <button className="btn btn-ghost btn-sm hidden sm:inline-flex" onClick={onShare}>
          <UserPlus size={15} /> Invite
        </button>
      )}
    </header>
  );
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

/** A free room's time left, with its five-minute warning. */
function Countdown() {
  const endsAt = useRoom((s) => s.endsAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (endsAt === null) return null;
  const left = endsAt - now;
  const soon = left <= 5 * 60_000;
  return (
    <span className={`room-timer ${soon ? 'is-soon' : ''}`} role="timer" aria-label={`${Math.max(0, Math.ceil(left / 60_000))} minutes left`} title="Free rooms last an hour">
      <Timer size={14} /> {clock(left)}
      <span className="hidden sm:inline">left</span>
    </span>
  );
}

function Banners() {
  const connection = useRoom((s) => s.connection);
  const online = useRoom((s) => s.online);
  const ending = useRoom((s) => s.ending);
  const endsAt = useRoom((s) => s.endsAt);
  const media = useRoom((s) => s.media);
  const host = useRoom((s) => s.hostName);
  const you = useRoom((s) => s.you);
  const tier = useAuth((s) => s.me?.tier);
  const [late, setLate] = useState(false);
  const [mediaSeen, setMediaSeen] = useState(false);
  const [endingSeen, setEndingSeen] = useState(false);

  // A blip isn't worth a banner: it shows after a moment away.
  useEffect(() => {
    if (connection !== 'reconnecting') return setLate(false);
    const t = setTimeout(() => setLate(true), 1500);
    return () => clearTimeout(t);
  }, [connection]);

  const items: { key: string; tone: 'warn' | 'info' | 'soon'; icon: ReactNode; text: ReactNode; close?: () => void }[] = [];
  if (!online) items.push({ key: 'offline', tone: 'warn', icon: <WifiOff size={15} />, text: 'You’re offline. Your changes are kept here and go to the room when you’re back.' });
  else if (late)
    items.push({ key: 'reconnecting', tone: 'warn', icon: <RefreshCw size={15} className="animate-spin" />, text: 'Reconnecting to the room… Your changes are kept and sync when it’s back.' });
  if (ending && endsAt !== null && !endingSeen)
    items.push({
      key: 'ending',
      tone: 'soon',
      icon: <Timer size={15} />,
      text: (
        <>
          About 5 minutes left. Everything is saved to {you?.role === 'host' ? 'your' : `${host}’s`} assignment.
          {you?.role === 'host' && tier !== 'pro' && (
            <>
              {' '}
              <Link to="/app/plan" target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
                Pro rooms have no time limit.
              </Link>
            </>
          )}
        </>
      ),
      close: () => setEndingSeen(true),
    });
  if (media === 'unavailable' && !mediaSeen)
    items.push({
      key: 'media',
      tone: 'info',
      icon: <CloudOff size={15} />,
      text: 'Video and voice aren’t switched on for rooms yet. Editing together, chat and Chip all work.',
      close: () => setMediaSeen(true),
    });
  if (media === 'failed' && !mediaSeen)
    items.push({ key: 'media-failed', tone: 'warn', icon: <Info size={15} />, text: 'Video and voice couldn’t connect. Editing, chat and Chip still work.', close: () => setMediaSeen(true) });
  if (!items.length) return null;
  return (
    <div className="room-banners" aria-live="polite">
      {items.map((b) => (
        <div key={b.key} className={`room-banner is-${b.tone}`} role={b.tone === 'warn' ? 'alert' : 'status'}>
          <span className="flex-none">{b.icon}</span>
          <span className="min-w-0 flex-1">{b.text}</span>
          {b.close && (
            <button className="icon-btn h-7 w-7 flex-none" onClick={b.close} aria-label="Dismiss">
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const TABS: { id: RoomPanel; name: string; icon: ReactNode }[] = [
  { id: 'people', name: 'People', icon: <Users size={16} /> },
  { id: 'chat', name: 'Chat', icon: <MessageSquare size={16} /> },
  { id: 'chip', name: 'Chip', icon: <Orb size={16} /> },
  { id: 'tasks', name: 'Plan', icon: <ListChecks size={16} /> },
  { id: 'notes', name: 'Notes', icon: <NotebookPen size={16} /> },
  { id: 'brief', name: 'Brief', icon: <ScrollText size={16} /> },
];

function SidePanel({ closable }: { closable?: boolean }) {
  const panel = useRoom((s) => s.panel) ?? 'people';
  const unreadChat = useRoom((s) => s.unreadChat);
  const unreadChip = useRoom((s) => s.unreadChip);
  const topic = useWorkspace((s) => s.assignment?.kind === 'topic');
  const badge = (id: RoomPanel) => (id === 'chat' ? unreadChat : id === 'chip' ? unreadChip : 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex flex-none items-stretch border-b border-line px-1.5 pt-1.5" aria-label="Room panels">
        <div className="grid min-w-0 flex-1 grid-cols-6">
          {TABS.map((t) => (
            <button key={t.id} className={`ws-ptab relative ${t.id === panel ? 'is-active' : ''}`} onClick={() => openPanel(t.id)} aria-current={t.id === panel ? 'page' : undefined}>
              {t.icon}
              <span>{t.id === 'brief' && topic ? 'About' : t.name}</span>
              {badge(t.id) > 0 && t.id !== panel && <span className="room-tab-badge">{badge(t.id) > 9 ? '9+' : badge(t.id)}</span>}
            </button>
          ))}
        </div>
        <button className="icon-btn my-auto ml-1 flex-none" onClick={() => openPanel(null)} aria-label="Close the panel" title={closable ? 'Close' : 'Close (Esc)'}>
          <X size={17} />
        </button>
      </nav>
      <div className="min-h-0 flex-1">
        {panel === 'people' && <PeoplePanel />}
        {panel === 'chat' && <ChatPanel />}
        {panel === 'chip' && <RoomChip />}
        {panel === 'tasks' && (
          <TasksPanel
            onPlan={() =>
              void roomSession()?.askChip(
                'plan',
                topic ? 'Make us a study plan: what to learn in what order, with practice and review, with dates.' : 'Make us a plan to the due date: an outline and the steps, with dates.',
              )
            }
          />
        )}
        {panel === 'notes' && <NotesPanel />}
        {panel === 'brief' && <RoomBrief />}
      </div>
    </div>
  );
}

/** What ended someone's visit, said kindly. [whose] is "your" or "Ada’s". */
const ENDED: Record<RoomEnd, { title: string; body: (whose: string, host: string) => string; again?: boolean }> = {
  host: { title: 'The room has ended', body: (w) => `Everything you wrote together is saved to ${w} assignment.` },
  time: { title: 'Time’s up', body: (w) => `Free rooms last an hour. Everything you wrote together is saved to ${w} assignment. Pro rooms have no time limit.` },
  removed: { title: 'You’ve left the room', body: () => 'A host took you out of this room, so you can’t rejoin with this link. Your part of the shared work stays.' },
  full: { title: 'The room is full', body: () => 'It has as many people as it can take right now. Try again when someone leaves.', again: true },
  unavailable: { title: 'Rooms aren’t open yet', body: () => 'Studying together live is nearly ready. Try again soon.', again: true },
  signed_out: { title: 'Your sign-in has run out', body: () => 'Sign in again to come back to the room.' },
  not_in_room: { title: 'You’re not in this room any more', body: () => 'Ask the host for the link again.' },
  waiting: { title: 'Waiting to be let in', body: (_w, h) => `${h} hasn’t let you in yet. Open the link again to wait.`, again: true },
  left: { title: 'You left the room', body: (w) => `The work you did together is saved to ${w} assignment.`, again: true },
};

function Ended({ why, token }: { why: RoomEnd; token: string }) {
  const navigate = useNavigate();
  const host = useRoom((s) => s.hostName);
  const you = useRoom((s) => s.you);
  const assignment = useWorkspace((s) => s.assignment?.id ?? null);
  const mine = you?.role === 'host';
  const e = ENDED[why];
  return (
    <div className="min-h-dvh">
      <div className="daylight" />
      <header className="mx-auto flex max-w-2xl items-center justify-between px-5 py-5">
        <Link to="/app" aria-label="Your desk">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
        <div className="card px-6 py-10 text-center sm:px-10" role="status">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-iris-soft text-iris">{why === 'time' ? <Timer size={22} /> : <DoorClosed size={22} />}</span>
          <h1 className="mt-5 text-[1.5rem] font-semibold tracking-[-0.02em]">{e.title}</h1>
          <p className="mx-auto mt-2 max-w-md leading-relaxed text-ink-2">{e.body(mine ? 'your' : `${host}’s`, host)}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            {e.again && why !== 'left' && (
              <button className="btn btn-primary" onClick={() => navigate(0)}>
                <RefreshCw size={16} /> Try again
              </button>
            )}
            {why === 'left' && (
              <button className="btn btn-primary" onClick={() => navigate(0)}>
                Rejoin
              </button>
            )}
            {mine && assignment && (
              <Link to={`/app/a/${assignment}`} className="btn btn-ghost">
                Open the assignment
              </Link>
            )}
            {why === 'signed_out' ? (
              <Link to={`/signin?next=${encodeURIComponent(`/room/${token}`)}`} className="btn btn-primary">
                Sign in
              </Link>
            ) : (
              <Link to="/app" className="btn btn-ghost">
                Back to my desk
              </Link>
            )}
          </div>
          {why === 'time' && mine && (
            <p className="mt-6 flex items-center justify-center gap-1.5 text-sm text-ink-3">
              <Sparkles size={14} className="text-iris" />
              <Link to="/app/plan" className="font-semibold text-iris-2 hover:underline">
                Pro: rooms of 10, with no time limit
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
