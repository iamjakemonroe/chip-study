import { AlertCircle, Camera, CameraOff, CheckCircle2, Loader2, Mic, MicOff, ShieldCheck, Volume2, Wifi } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Spinner } from '../components/ui.tsx';
import { ROOMS_BASE } from './api.ts';
import {
  canPickSpeaker,
  checkRoute,
  checkServer,
  CHECK_STUN,
  getCamera,
  getMic,
  levelMeter,
  listDevices,
  mediaSupported,
  problemOf,
  problemText,
  saveChoice,
  savedChoice,
  type DeviceChoice,
  type DeviceProblem,
  type Devices,
  type NetworkCheck,
} from './devices.ts';
import { colorFor, initials } from './people.ts';

/** Before entering a room: see yourself, hear your microphone, pick the camera, microphone and
 * speaker, choose to start muted or with the camera off, see the name others will see, and a quick
 * check of the connection. Nothing is sent until you enter. */

export interface LobbyResult {
  mic: MediaStreamTrack | null;
  micOn: boolean;
  cam: MediaStreamTrack | null;
  camOn: boolean;
  devices: DeviceChoice;
}

export interface LobbyProps {
  title: string;
  lines: ReactNode;
  name: string;
  userId: string;
  joinLabel: string;
  busy: boolean;
  /** Shown above the Join button (waiting to be let in, an error). */
  status?: ReactNode;
  disabled?: boolean;
  onJoin: (r: LobbyResult) => void;
  onBack: () => void;
}

type Want = 'idle' | 'asking' | 'on' | 'off';

export function Lobby(p: LobbyProps) {
  const [choice, setChoice] = useState<DeviceChoice>(() => savedChoice());
  const [devices, setDevices] = useState<Devices>({ cameras: [], mics: [], speakers: [] });
  const [cam, setCam] = useState<MediaStreamTrack | null>(null);
  const [mic, setMic] = useState<MediaStreamTrack | null>(null);
  const [camWant, setCamWant] = useState<Want>('idle');
  const [micWant, setMicWant] = useState<Want>('idle');
  const [camProblem, setCamProblem] = useState<DeviceProblem | null>(null);
  const [micProblem, setMicProblem] = useState<DeviceProblem | null>(null);
  const [net, setNet] = useState<NetworkCheck | null>(null);
  /** [gone]: the lobby has closed (or handed its tracks to the room): a device that starts after that is stopped at once. */
  const tracks = useRef<{ cam: MediaStreamTrack | null; mic: MediaStreamTrack | null; handed: boolean; gone: boolean }>({ cam: null, mic: null, handed: false, gone: false });
  const [prompting, setPrompting] = useState(false);
  tracks.current.cam = cam;
  tracks.current.mic = mic;
  const supported = mediaSupported();

  const refreshDevices = useCallback(() => {
    void listDevices()
      .then(setDevices)
      .catch(() => undefined);
  }, []);

  const startCam = useCallback(
    async (deviceId: string | null) => {
      setCamWant('asking');
      setCamProblem(null);
      try {
        const t = await getCamera(deviceId);
        if (tracks.current.gone) return t.stop();
        tracks.current.cam?.stop();
        setCam(t);
        setCamWant('on');
        refreshDevices();
      } catch (e) {
        setCamProblem(problemOf(e));
        setCamWant('off');
      }
    },
    [refreshDevices],
  );

  const startMic = useCallback(
    async (deviceId: string | null) => {
      setMicWant('asking');
      setMicProblem(null);
      try {
        const t = await getMic(deviceId);
        if (tracks.current.gone) return t.stop();
        tracks.current.mic?.stop();
        setMic(t);
        setMicWant('on');
        refreshDevices();
      } catch (e) {
        setMicProblem(problemOf(e));
        setMicWant('off');
      }
    },
    [refreshDevices],
  );

  // If the browser already allows them, start straight away; otherwise ask when they tap.
  useEffect(() => {
    if (!supported) return;
    let live = true;
    const ask = async (name: 'camera' | 'microphone') => {
      try {
        const s = await navigator.permissions?.query({ name: name as PermissionName });
        return s?.state ?? 'prompt';
      } catch {
        return 'prompt';
      }
    };
    void Promise.all([ask('camera'), ask('microphone')]).then(([c, m]) => {
      if (!live) return;
      if (c === 'granted') void startCam(choice.camera);
      if (m === 'granted') void startMic(choice.mic);
      if (c === 'denied') setCamProblem('denied');
      if (m === 'denied') setMicProblem('denied');
    });
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => {
      live = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tracks not handed to the room are stopped on the way out.
  useEffect(
    () => () => {
      tracks.current.gone = true;
      if (tracks.current.handed) return;
      tracks.current.cam?.stop();
      tracks.current.mic?.stop();
    },
    [],
  );

  // Still asking after a moment: the browser is showing its prompt, so say so.
  const asking = camWant === 'asking' || micWant === 'asking';
  useEffect(() => {
    if (!asking) return setPrompting(false);
    const t = setTimeout(() => setPrompting(true), 1200);
    return () => clearTimeout(t);
  }, [asking]);

  // The connection check, once.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [server, route] = await Promise.all([checkServer(ROOMS_BASE), checkRoute(CHECK_STUN ? [{ urls: CHECK_STUN }] : [])]);
      if (live) setNet({ ...server, route });
    })();
    return () => {
      live = false;
    };
  }, []);

  const pick = (kind: keyof DeviceChoice, id: string) => {
    const next = { ...choice, [kind]: id };
    setChoice(next);
    saveChoice(next);
    if (kind === 'camera' && camWant === 'on') void startCam(id);
    if (kind === 'mic' && micWant !== 'off' && mic) void startMic(id);
  };

  const both = async () => {
    // One prompt for both where the browser allows it, so people are asked once.
    setCamWant('asking');
    setMicWant('asking');
    await Promise.all([startMic(choice.mic), startCam(choice.camera)]);
  };

  const join = () => {
    tracks.current.handed = true;
    tracks.current.gone = true;
    saveChoice(choice);
    p.onJoin({ mic, micOn: micWant === 'on' && !!mic, cam, camOn: camWant === 'on' && !!cam, devices: choice });
  };

  const asked = camWant !== 'idle' || micWant !== 'idle' || !!cam || !!mic;
  const color = colorFor(p.userId);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
      <section className="card overflow-hidden p-2.5 sm:p-3" aria-label="Your camera and microphone">
        <div className="room-preview" style={{ ['--person' as string]: color }}>
          {cam && camWant === 'on' ? (
            <Preview track={cam} />
          ) : (
            <div className="grid h-full place-items-center">
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <span className="room-avatar h-20 w-20 text-2xl" style={{ background: color }}>
                  {initials(p.name)}
                </span>
                {!asked && supported && <p className="max-w-xs text-sm text-white/85">Your camera is off. Turn it on to see yourself before you join.</p>}
                {camWant === 'asking' && (
                  <p className="flex items-center gap-2 text-sm text-white/85">
                    <Loader2 size={15} className="animate-spin" /> Starting your camera…
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2.5 bg-gradient-to-t from-black/45 to-transparent px-3 pb-3 pt-10">
            <RoundToggle
              on={micWant === 'on'}
              busy={micWant === 'asking'}
              label={micWant === 'on' ? 'Mute your microphone' : 'Turn on your microphone'}
              onClick={() => {
                if (micWant === 'on') setMicWant('off');
                else if (mic && mic.readyState === 'live') setMicWant('on');
                else void startMic(choice.mic);
              }}
              icon={micWant === 'on' ? <Mic size={19} /> : <MicOff size={19} />}
            />
            <RoundToggle
              on={camWant === 'on'}
              busy={camWant === 'asking'}
              label={camWant === 'on' ? 'Turn off your camera' : 'Turn on your camera'}
              onClick={() => {
                if (camWant === 'on') {
                  cam?.stop();
                  setCam(null);
                  setCamWant('off');
                } else void startCam(choice.camera);
              }}
              icon={camWant === 'on' ? <Camera size={19} /> : <CameraOff size={19} />}
            />
          </div>
          {mic && micWant === 'on' && <MicMeter track={mic} />}
        </div>

        {!supported ? (
          <Problem title={problemText('unsupported', 'camera').title} body={problemText('unsupported', 'camera').body} />
        ) : !asked ? (
          <div className="flex flex-col items-start gap-3 px-2 pb-1.5 pt-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm leading-relaxed text-ink-2">Others see and hear you only after you join. Nothing in a room is recorded.</p>
            <button className="btn btn-iris btn-sm flex-none" onClick={() => void both()}>
              <Camera size={15} /> Turn on camera and microphone
            </button>
          </div>
        ) : (
          <div className="space-y-2 px-1 pt-3">
            {prompting && (
              <p className="flex items-start gap-3 rounded-2xl bg-iris-soft/70 px-3.5 py-3 text-sm leading-relaxed text-iris-2" role="status">
                <ShieldCheck size={17} className="mt-0.5 flex-none" />
                <span>Your browser is asking to use your camera and microphone. Choose Allow to be seen and heard, or join without them.</span>
              </p>
            )}
            {camProblem && (
              <Problem
                {...problemText(camProblem, 'camera')}
                onRetry={camProblem === 'denied' || camProblem === 'none' || camProblem === 'in_use' || camProblem === 'failed' ? () => void startCam(choice.camera) : undefined}
              />
            )}
            {micProblem && (
              <Problem
                {...problemText(micProblem, 'microphone')}
                onRetry={micProblem === 'denied' || micProblem === 'none' || micProblem === 'in_use' || micProblem === 'failed' ? () => void startMic(choice.mic) : undefined}
              />
            )}
          </div>
        )}

        {(devices.cameras.length > 0 || devices.mics.length > 0) && (
          <div className="grid gap-3 px-1.5 pb-1.5 pt-4 sm:grid-cols-3">
            <DevicePick label="Camera" icon={<Camera size={14} />} value={choice.camera ?? cam?.getSettings().deviceId ?? ''} list={devices.cameras} onPick={(id) => pick('camera', id)} />
            <DevicePick label="Microphone" icon={<Mic size={14} />} value={choice.mic ?? mic?.getSettings().deviceId ?? ''} list={devices.mics} onPick={(id) => pick('mic', id)} />
            {canPickSpeaker() && devices.speakers.length > 0 ? (
              <DevicePick label="Speaker" icon={<Volume2 size={14} />} value={choice.speaker ?? ''} list={devices.speakers} onPick={(id) => pick('speaker', id)} />
            ) : (
              <div className="hidden sm:block" />
            )}
          </div>
        )}
      </section>

      <section className="card px-5 py-6 sm:px-7 sm:py-7">
        <h1 className="text-[1.6rem] font-semibold leading-tight tracking-[-0.02em]">{p.title}</h1>
        <div className="mt-2 space-y-1 text-sm text-ink-3">{p.lines}</div>

        <div className="mt-6 flex items-center gap-3 rounded-2xl bg-paper px-4 py-3">
          <span className="room-avatar h-9 w-9 flex-none text-sm" style={{ background: color }}>
            {initials(p.name)}
          </span>
          <p className="min-w-0 text-sm leading-snug text-ink-2">
            Others will see you as <strong className="font-semibold text-ink">{p.name}</strong>
            <span className="block text-xs text-ink-3">Your Kaivon name. Never your email.</span>
          </p>
        </div>

        <div className="mt-5 space-y-2.5 text-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">You’ll join</p>
          <JoinWith on={micWant === 'on'} onText="With your microphone on" offText="Muted" icon={micWant === 'on' ? <Mic size={15} /> : <MicOff size={15} />} />
          <JoinWith on={camWant === 'on'} onText="With your camera on" offText="With your camera off" icon={camWant === 'on' ? <Camera size={15} /> : <CameraOff size={15} />} />
        </div>

        <NetworkRows net={net} />

        {p.status && <div className="mt-5">{p.status}</div>}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn btn-ghost" onClick={p.onBack}>
            Not now
          </button>
          <button className="btn btn-iris" disabled={p.busy || p.disabled} onClick={join}>
            {p.busy ? <Spinner /> : p.joinLabel}
          </button>
        </div>
        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-ink-3">
          <ShieldCheck size={14} className="mt-px flex-none text-mint" />
          Nothing is recorded. Audio and video pass through Cloudflare’s network to reach the others.
        </p>
      </section>
    </div>
  );
}

function Preview({ track }: { track: MediaStreamTrack }) {
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
  return <video ref={ref} className="h-full w-full scale-x-[-1] object-cover" muted playsInline autoPlay aria-label="Your camera" />;
}

function MicMeter({ track }: { track: MediaStreamTrack }) {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const m = levelMeter(track);
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 60) return;
      last = t;
      if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0.04, m.level())})`;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      m.stop();
    };
  }, [track]);
  return (
    <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/35 px-2.5 py-1.5 text-white backdrop-blur" aria-label="Microphone level" role="meter">
      <Mic size={13} />
      <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-white/25">
        <span ref={bar} className="block h-full origin-left rounded-full bg-[#5fd8b6] transition-transform duration-75" style={{ transform: 'scaleX(0.04)' }} />
      </span>
    </div>
  );
}

function RoundToggle({ on, busy, label, onClick, icon }: { on: boolean; busy: boolean; label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <button
      className={`grid h-12 w-12 place-items-center rounded-full shadow-[var(--shadow-soft)] transition-colors ${on || busy ? 'bg-white text-ink hover:bg-white/90' : 'bg-rose text-white hover:brightness-95'}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={busy}
    >
      {busy ? <Loader2 size={18} className="animate-spin" /> : icon}
    </button>
  );
}

function DevicePick({ label, icon, value, list, onPick }: { label: string; icon: ReactNode; value: string; list: MediaDeviceInfo[]; onPick: (id: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-3">
        {icon} {label}
      </span>
      <select className="field h-10 truncate py-0 pr-8 text-sm" value={list.some((d) => d.deviceId === value) ? value : ''} onChange={(e) => onPick(e.target.value)} disabled={!list.length}>
        {!list.some((d) => d.deviceId === value) && <option value="">{list.length ? 'Default' : 'None found'}</option>}
        {list.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function JoinWith({ on, onText, offText, icon }: { on: boolean; onText: string; offText: string; icon: ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-ink-2">
      <span className={`grid h-7 w-7 flex-none place-items-center rounded-full ${on ? 'bg-mint-soft text-mint' : 'bg-paper-2 text-ink-3'}`}>{icon}</span>
      {on ? onText : offText}
    </p>
  );
}

function NetworkRows({ net }: { net: NetworkCheck | null }) {
  const row = (state: 'ok' | 'warn' | 'bad' | 'wait', text: string) => (
    <p className="flex items-center gap-2.5 text-ink-2">
      <span
        className={`grid h-7 w-7 flex-none place-items-center rounded-full ${state === 'ok' ? 'bg-mint-soft text-mint' : state === 'warn' ? 'bg-sand-soft text-sand' : state === 'bad' ? 'bg-rose-soft text-rose' : 'bg-paper-2 text-ink-3'}`}
      >
        {state === 'wait' ? <Loader2 size={14} className="animate-spin" /> : state === 'ok' ? <CheckCircle2 size={15} /> : state === 'warn' ? <Wifi size={15} /> : <AlertCircle size={15} />}
      </span>
      {text}
    </p>
  );
  return (
    <div className="mt-5 space-y-2.5 text-sm" aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">Your connection</p>
      {!net
        ? row('wait', 'Checking your connection…')
        : net.server === 'failed'
          ? row('bad', 'Couldn’t reach the room. Check you’re online.')
          : row(net.server === 'ok' ? 'ok' : 'warn', net.server === 'ok' ? `Good connection (${net.ms} ms)` : `A slow connection (${net.ms} ms): video may stutter`)}
      {net &&
        net.route !== 'skipped' &&
        row(net.route === 'ok' ? 'ok' : 'warn', net.route === 'ok' ? 'Video can get through this network' : 'This network blocks direct video: it will go through a relay')}
    </div>
  );
}

function Problem({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-peach-soft px-3.5 py-3 text-sm" role="alert">
      <AlertCircle size={17} className="mt-0.5 flex-none text-peach" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[#9a4a1b]">{title}</p>
        <p className="mt-0.5 leading-relaxed text-[#9a4a1b]/90">{body}</p>
      </div>
      {onRetry && (
        <button className="btn btn-ghost btn-sm h-8 flex-none" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
