import { ChevronDown, ChevronUp, Hand, MicOff, Monitor, Pin, PinOff, RotateCcw, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Person, Rid } from '../../shared/rooms.ts';
import { canPickSpeaker, sendAudioTo } from './devices.ts';
import { unwant, want } from './layers.ts';
import { colorFor, initials, ordered, roleName } from './people.ts';
import { roomSession } from './session.ts';
import { useRoom } from './store.ts';

/** Video in a room: small tiles in a strip (each person's quarter-size layer), the stage (a
 * screen share or a pinned person, full size), and the room's sound. Names come from the room's
 * roster. */

function useRemoteTrack(trackName: string | null): MediaStreamTrack | null {
  useRoom((s) => s.trackVersion);
  return trackName ? (roomSession()?.media.track(trackName) ?? null) : null;
}

/** Asks for [rid] of [trackName] while [el] is on screen, and for nothing when it isn't. */
function useLayer(trackName: string | null, rid: Rid, el: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!trackName) return;
    const key = Symbol(trackName);
    const node = el.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      want(trackName, key, rid);
      return () => unwant(trackName, key);
    }
    const seen = new IntersectionObserver(([e]) => want(trackName, key, e.isIntersecting ? rid : null), { threshold: 0.05 });
    seen.observe(node);
    return () => {
      seen.disconnect();
      unwant(trackName, key);
    };
  }, [trackName, rid, el]);
}

function Video({ track, mirror, fit = 'cover', label }: { track: MediaStreamTrack; mirror?: boolean; fit?: 'cover' | 'contain'; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = new MediaStream([track]);
    void v.play().catch(() => undefined);
    return () => {
      v.srcObject = null;
    };
  }, [track]);
  return <video ref={ref} className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${mirror ? 'scale-x-[-1]' : ''}`} muted playsInline autoPlay aria-label={label} />;
}

export const Tile = memo(function Tile({ person, self, large, onPin }: { person: Person; self: boolean; large: boolean; onPin: (userId: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const pubs = useRoom((s) => s.pubs);
  const speaking = useRoom((s) => s.speaking.includes(person.userId));
  const hand = useRoom((s) => s.hands.includes(person.userId));
  const pinned = useRoom((s) => s.pinned === person.userId);
  const localVideo = useRoom((s) => (self ? s.localVideo : null));
  const micOn = useRoom((s) => (self ? s.mic : pubs.some((p) => p.userId === person.userId && p.kind === 'audio')));
  const videoPub = self ? null : (pubs.find((p) => p.userId === person.userId && p.kind === 'video') ?? null);
  const remote = useRemoteTrack(videoPub?.trackName ?? null);
  useLayer(videoPub?.trackName ?? null, large ? 'h' : 'q', box);
  const failed = videoPub ? roomSession()?.media.failed(videoPub.trackName) : false;
  const track = self ? localVideo : remote;
  const color = colorFor(person.userId);
  const role = roleName(person.role);
  const name = self ? `${person.name} (you)` : person.name;

  return (
    <div
      ref={box}
      className={`room-tile ${speaking ? 'is-speaking' : ''} ${pinned ? 'is-pinned' : ''}`}
      style={{ ['--person' as string]: color }}
      role="group"
      aria-label={`${name}${role ? `, ${role.toLowerCase()}` : ''}${micOn ? '' : ', muted'}${track ? '' : ', camera off'}${hand ? ', hand raised' : ''}`}
      data-person={person.userId}
    >
      {track ? (
        <Video track={track} mirror={self} label={`${person.name}’s camera`} />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <span className="room-avatar room-tile-avatar" style={{ background: color }}>
            {initials(person.name)}
          </span>
          {videoPub && !failed && <span className="room-tile-wait" aria-hidden="true" />}
        </div>
      )}
      {failed && videoPub && (
        <button className="room-tile-retry" onClick={() => roomSession()?.media.retry(videoPub.trackName)} title="Try their video again">
          <RotateCcw size={12} /> Video
        </button>
      )}
      {hand && (
        <span className="room-tile-hand" title="Hand raised">
          <Hand size={13} />
        </span>
      )}
      <div className="room-tile-label">
        {!micOn && <MicOff size={11} className="flex-none text-[#ffb3c4]" aria-hidden="true" />}
        <span className="truncate">{name}</span>
        {role && <span className="room-tile-role">{role}</span>}
      </div>
      <button
        className="room-tile-pin"
        onClick={() => onPin(person.userId)}
        aria-label={pinned ? `Unpin ${person.name}` : `Pin ${person.name} to the stage`}
        title={pinned ? 'Unpin' : 'Pin to the stage'}
      >
        {pinned ? <PinOff size={13} /> : <Pin size={13} />}
      </button>
    </div>
  );
});

/** Everyone in the room, connected now, in a strip of small tiles. */
export function TileStrip({ compact }: { compact: boolean }) {
  const people = useRoom((s) => s.people);
  const you = useRoom((s) => s.you);
  const [hidden, setHidden] = useState(false);
  const list = useMemo(() => {
    const connected = people.filter((p) => p.connected || p.userId === you?.userId);
    if (you && !connected.some((p) => p.userId === you.userId)) connected.push({ ...you, hand: false, connected: true });
    return ordered(connected, you?.userId);
  }, [people, you]);
  const pin = (userId: string) => {
    const s = useRoom.getState();
    useRoom.setState(s.pinned === userId ? { pinned: null } : { pinned: userId, view: 'stage' });
  };
  return (
    <section className={`room-strip ${compact ? 'is-compact' : ''} ${hidden ? 'is-hidden' : ''}`} aria-label="People’s video">
      {!hidden && (
        <div className="room-strip-row no-scrollbar">
          {list.map((p) => (
            <Tile key={p.userId} person={p} self={p.userId === you?.userId} large={false} onPin={pin} />
          ))}
        </div>
      )}
      {hidden && (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-1">
          {list.slice(0, 12).map((p) => (
            <Dot key={p.userId} person={p} />
          ))}
          <span className="ml-1 truncate text-xs font-medium text-ink-3">{list.length === 1 ? 'Just you' : `${list.length} here`}</span>
        </div>
      )}
      <button className="room-strip-toggle" onClick={() => setHidden((h) => !h)} aria-label={hidden ? 'Show video' : 'Hide video'} title={hidden ? 'Show video' : 'Hide video'} aria-expanded={!hidden}>
        {hidden ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>
    </section>
  );
}

function Dot({ person }: { person: Person }) {
  const speaking = useRoom((s) => s.speaking.includes(person.userId));
  return (
    <span
      className={`room-avatar h-7 w-7 flex-none text-[0.65rem] ${speaking ? 'ring-2 ring-mint ring-offset-2 ring-offset-white' : ''}`}
      style={{ background: colorFor(person.userId) }}
      title={person.name}
    >
      {initials(person.name)}
    </span>
  );
}

/** What's on the stage: someone's screen (the newest share), or the person pinned. */
export function useStage(): { kind: 'screen' | 'person'; userId: string } | null {
  const pubs = useRoom((s) => s.pubs);
  const pinned = useRoom((s) => s.pinned);
  const screen = useRoom((s) => s.screen);
  const you = useRoom((s) => s.you?.userId);
  const people = useRoom((s) => s.people);
  if (pinned && (pinned === you || people.some((p) => p.userId === pinned && p.connected))) return { kind: 'person', userId: pinned };
  const share = [...pubs].reverse().find((p) => p.kind === 'screen' && p.userId !== you);
  if (share) return { kind: 'screen', userId: share.userId };
  if (screen && you) return { kind: 'screen', userId: you };
  return null;
}

export function Stage({ stage, onClose }: { stage: { kind: 'screen' | 'person'; userId: string }; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const you = useRoom((s) => s.you);
  const people = useRoom((s) => s.people);
  const localVideo = useRoom((s) => s.localVideo);
  const mine = stage.userId === you?.userId;
  const person = people.find((p) => p.userId === stage.userId) ?? (mine && you ? { ...you, hand: false, connected: true } : null);
  const trackName = mine ? null : `${stage.userId}:${stage.kind === 'screen' ? 'screen' : 'video'}`;
  const remote = useRemoteTrack(trackName);
  useLayer(trackName, 'f', box);
  // Your own screen isn't shown back to you (it would mirror itself): a calm note instead.
  const track = mine ? (stage.kind === 'screen' ? null : localVideo) : remote;
  const name = person?.name ?? 'Someone';
  const title = stage.kind === 'screen' ? (mine ? 'You’re sharing your screen' : `${name}’s screen`) : mine ? 'You' : name;
  const color = colorFor(stage.userId);

  return (
    <section ref={box} className="room-stage" aria-label={title}>
      <div className="room-stage-bar">
        {stage.kind === 'screen' ? <Monitor size={15} className="flex-none text-iris" /> : <Pin size={15} className="flex-none text-iris" />}
        <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
        {stage.kind === 'screen' && mine && (
          <button className="btn btn-sm h-8 bg-rose px-3 text-white hover:brightness-95" onClick={() => void roomSession()?.setScreen(false)}>
            Stop sharing
          </button>
        )}
        {stage.kind === 'person' && (
          <button className="btn btn-quiet btn-sm h-8" onClick={() => useRoom.setState({ pinned: null })}>
            <PinOff size={14} /> Unpin
          </button>
        )}
        <button className="icon-btn h-8 w-8" onClick={onClose} aria-label="Back to the work" title="Back to the work">
          <X size={16} />
        </button>
      </div>
      <div className="room-stage-video" style={{ ['--person' as string]: color }}>
        {track ? (
          <Video track={track} mirror={mine && stage.kind === 'person'} fit={stage.kind === 'screen' ? 'contain' : 'cover'} label={title} />
        ) : (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-3 text-center">
              {mine && stage.kind === 'screen' ? (
                <span className="grid h-20 w-20 place-items-center rounded-full bg-iris-soft text-iris">
                  <Monitor size={34} />
                </span>
              ) : (
                <span className="room-avatar h-24 w-24 text-3xl" style={{ background: color }}>
                  {initials(name)}
                </span>
              )}
              <p className="max-w-xs text-sm leading-relaxed text-ink-3">
                {mine && stage.kind === 'screen'
                  ? 'Everyone in the room can see your screen now.'
                  : stage.kind === 'screen'
                    ? 'Their screen is on its way…'
                    : mine
                      ? 'Your camera is off.'
                      : 'Their camera is off.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The room's sound: everyone's microphone and shared screen audio, on the chosen speaker. */
export function RoomAudio() {
  const pubs = useRoom((s) => s.pubs);
  const you = useRoom((s) => s.you?.userId);
  const ended = useRoom((s) => s.ended);
  const names = pubs.filter((p) => p.userId !== you && (p.kind === 'audio' || p.kind === 'screen-audio')).map((p) => p.trackName);
  if (ended) return null;
  return (
    <div className="hidden" aria-hidden="true">
      {names.map((n) => (
        <Sound key={n} trackName={n} />
      ))}
    </div>
  );
}

function Sound({ trackName }: { trackName: string }) {
  const track = useRemoteTrack(trackName);
  const speaker = useRoom((s) => s.speaker);
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a || !track) return;
    a.srcObject = new MediaStream([track]);
    void a.play().catch(() => undefined);
    return () => {
      a.srcObject = null;
    };
  }, [track]);
  useEffect(() => {
    if (ref.current && canPickSpeaker()) void sendAudioTo(ref.current, speaker ?? roomSession()?.devices.speaker ?? null);
  }, [speaker, track]);
  return <audio ref={ref} autoPlay />;
}
