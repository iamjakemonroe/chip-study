/** The camera, microphone and speakers: asking for them, what went wrong if it didn't work, the
 * devices to pick from, and how loud the microphone is. */

export type DeviceProblem = 'denied' | 'none' | 'in_use' | 'insecure' | 'unsupported' | 'failed';

export interface DeviceChoice {
  camera: string | null;
  mic: string | null;
  speaker: string | null;
}

const CHOICE_KEY = 'chip-study-room-devices';

export function savedChoice(): DeviceChoice {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    if (raw) return { camera: null, mic: null, speaker: null, ...(JSON.parse(raw) as Partial<DeviceChoice>) };
  } catch {
    // Nothing kept.
  }
  return { camera: null, mic: null, speaker: null };
}

export function saveChoice(c: DeviceChoice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(c));
  } catch {
    // Private mode: asked again next time.
  }
}

/** What went wrong getting a device, from the browser's error. */
export function problemOf(e: unknown): DeviceProblem {
  const name = (e as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'none';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'in_use';
  if (name === 'TypeError' && typeof navigator !== 'undefined' && !navigator.mediaDevices) return 'unsupported';
  return 'failed';
}

/** What to tell someone about [problem] with their [what]. */
export function problemText(problem: DeviceProblem, what: 'camera' | 'microphone'): { title: string; body: string } {
  const browser = 'your browser’s settings (the icon by the address bar)';
  switch (problem) {
    case 'denied':
      return { title: `Your ${what} is blocked`, body: `Allow Chip Study to use your ${what} in ${browser}, then try again. You can still join without it.` };
    case 'none':
      return { title: `No ${what} found`, body: `Plug one in or pick another, then try again. You can still join without one.` };
    case 'in_use':
      return { title: `Your ${what} is busy`, body: `Another app or tab may be using it. Close it there, then try again.` };
    case 'insecure':
    case 'unsupported':
      return { title: `This browser can’t share your ${what}`, body: 'Try the latest Chrome, Safari, Edge or Firefox. You can still join, write and chat.' };
    default:
      return { title: `Your ${what} didn’t start`, body: 'Try again, or pick another one.' };
  }
}

export function mediaSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window !== 'undefined' && window.isSecureContext !== false;
}

export const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
export const VIDEO: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } };

/** A microphone track, with echo cancellation and noise suppression on. */
export async function getMic(deviceId: string | null): Promise<MediaStreamTrack> {
  if (!mediaSupported()) throw Object.assign(new Error('unsupported'), { name: 'TypeError' });
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } }).catch((e: unknown) => {
    // A device that's gone: the default one instead.
    if (deviceId && problemOf(e) === 'none') return navigator.mediaDevices.getUserMedia({ audio: AUDIO });
    throw e;
  });
  return stream.getAudioTracks()[0];
}

export async function getCamera(deviceId: string | null): Promise<MediaStreamTrack> {
  if (!mediaSupported()) throw Object.assign(new Error('unsupported'), { name: 'TypeError' });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } }).catch((e: unknown) => {
    if (deviceId && problemOf(e) === 'none') return navigator.mediaDevices.getUserMedia({ video: VIDEO });
    throw e;
  });
  const track = stream.getVideoTracks()[0];
  if ('contentHint' in track) track.contentHint = 'motion';
  return track;
}

/** The screen (or a window or tab), with its sound when the browser offers it. */
export async function getScreen(): Promise<{ video: MediaStreamTrack; audio: MediaStreamTrack | null }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: true });
  const video = stream.getVideoTracks()[0];
  if ('contentHint' in video) video.contentHint = 'detail';
  return { video, audio: stream.getAudioTracks()[0] ?? null };
}

export const canShareScreen = (): boolean => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

export interface Devices {
  cameras: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

export async function listDevices(): Promise<Devices> {
  if (!navigator.mediaDevices?.enumerateDevices) return { cameras: [], mics: [], speakers: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  // Before permission, devices have no labels and empty IDs: nothing to pick yet.
  const real = all.filter((d) => d.deviceId);
  return {
    cameras: real.filter((d) => d.kind === 'videoinput'),
    mics: real.filter((d) => d.kind === 'audioinput'),
    speakers: real.filter((d) => d.kind === 'audiooutput'),
  };
}

/** Whether audio can be sent to a chosen speaker here (not every browser can). */
export const canPickSpeaker = (): boolean => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export async function sendAudioTo(el: HTMLMediaElement, deviceId: string | null): Promise<void> {
  if (!deviceId || !canPickSpeaker()) return;
  try {
    await (el as HTMLMediaElement & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
  } catch {
    // The default speaker it is.
  }
}

let shared: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (shared) return shared;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  shared = new Ctx();
  return shared;
}

/** How loud [track] is, 0 to 1, read as often as asked (cheap). Answers a reader and a stop. */
export function levelMeter(track: MediaStreamTrack): { level: () => number; stop: () => void } {
  const ctx = audioContext();
  if (!ctx) return { level: () => 0, stop: () => {} };
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  return {
    level: () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 3.2);
    },
    stop: () => {
      source.disconnect();
      analyser.disconnect();
    },
  };
}

/** A rough check of the connection: whether the room server answers, how quickly, and whether a
 * video route (STUN or TURN) can be found from this network. */
export interface NetworkCheck {
  server: 'ok' | 'slow' | 'failed';
  ms: number | null;
  route: 'ok' | 'limited' | 'failed' | 'skipped';
}

/** Whether a video route can be found from this network: a STUN answer (or a relay) means media
 * can flow; only local addresses means it will need a relay. */
export async function checkRoute(iceServers: RTCIceServer[], wait = 3500): Promise<NetworkCheck['route']> {
  if (typeof RTCPeerConnection === 'undefined') return 'failed';
  if (!iceServers.length) return 'skipped';
  let pc: RTCPeerConnection;
  try {
    pc = new RTCPeerConnection({ iceServers });
  } catch {
    return 'failed';
  }
  let found: NetworkCheck['route'] = 'failed';
  try {
    pc.createDataChannel('check');
    const done = new Promise<void>((resolve) => {
      const t = setTimeout(resolve, wait);
      pc.onicecandidate = (e) => {
        const c = e.candidate?.candidate ?? '';
        if (/ typ (srflx|relay) /.test(c)) {
          found = 'ok';
          clearTimeout(t);
          resolve();
        } else if (/ typ host /.test(c) && found === 'failed') found = 'limited';
        if (!e.candidate) {
          clearTimeout(t);
          resolve();
        }
      };
    });
    await pc.setLocalDescription(await pc.createOffer());
    await done;
  } catch {
    found = 'failed';
  } finally {
    pc.close();
  }
  return found;
}

/** How quickly the site answers (the room server is the same Worker, at the same edge): a small
 * file, never from the cache. */
export async function checkServer(base: string): Promise<{ server: NetworkCheck['server']; ms: number | null }> {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    try {
      await fetch(`${base}/favicon.svg?check=${Date.now()}-${i}`, { method: 'HEAD', cache: 'no-store', mode: base ? 'no-cors' : 'same-origin' });
      times.push(performance.now() - start);
    } catch {
      // Counted as missing.
    }
  }
  if (!times.length) return { server: 'failed', ms: null };
  times.sort((a, b) => a - b);
  const ms = Math.round(times[Math.floor(times.length / 2)]);
  return { server: ms < 350 ? 'ok' : 'slow', ms };
}

/** The STUN server for the network check (Cloudflare's, unless a build says otherwise). */
export const CHECK_STUN = ((import.meta.env.VITE_ROOMS_STUN as string | undefined) ?? 'stun:stun.cloudflare.com:3478').trim();
