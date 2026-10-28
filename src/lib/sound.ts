/** Calm sounds made on the device (nothing to download): a soft bell for the timer, and ambient
 * sound for focus (brown noise, rain, waves), each a few seconds of noise shaped once and looped,
 * so they cost almost nothing to play. */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** A soft two-note bell. */
export function chime(volume = 0.35) {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  [
    [659.25, 0],
    [987.77, 0.18],
  ].forEach(([freq, delay]) => {
    for (const [mult, level] of [
      [1, 1],
      [2.01, 0.25],
      [3.02, 0.08],
    ]) {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      const t = now + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume * level * 0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      osc.connect(gain).connect(a.destination);
      osc.start(t);
      osc.stop(t + 2.5);
    }
  });
}

export type Ambient = 'rain' | 'brown' | 'waves';

function noiseBuffer(a: AudioContext, kind: Ambient): AudioBuffer {
  const seconds = kind === 'waves' ? 12 : 4;
  const length = a.sampleRate * seconds;
  const buffer = a.createBuffer(2, length, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      } else if (kind === 'rain') {
        // Pink-ish noise, with the odd soft drop.
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11 + (Math.random() < 0.0004 ? (Math.random() - 0.5) * 0.6 : 0);
      } else {
        // Waves: brown noise that swells and falls twice in the loop (so it loops seamlessly).
        last = (last + 0.02 * white) / 1.02;
        const swell = 0.35 + 0.65 * Math.pow(Math.sin((Math.PI * 2 * i) / length) * 0.5 + 0.5, 2);
        data[i] = last * 3.4 * swell;
      }
    }
    // Fade the joins so the loop has no click.
    const fade = Math.floor(a.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] *= k;
      data[length - 1 - i] *= k;
    }
  }
  return buffer;
}

let playing: { source: AudioBufferSourceNode; gain: GainNode; kind: Ambient } | null = null;
const cache = new Map<Ambient, AudioBuffer>();

export function playAmbient(kind: Ambient, volume: number) {
  const a = audio();
  if (!a) return;
  if (playing?.kind === kind) {
    playing.gain.gain.setTargetAtTime(volume * 0.5, a.currentTime, 0.3);
    return;
  }
  stopAmbient();
  let buffer = cache.get(kind);
  if (!buffer) {
    buffer = noiseBuffer(a, kind);
    cache.set(kind, buffer);
  }
  const source = a.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = kind === 'rain' ? 5200 : 900;
  const gain = a.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(volume * 0.5, a.currentTime, 0.8);
  source.connect(filter).connect(gain).connect(a.destination);
  source.start();
  playing = { source, gain, kind };
}

export function stopAmbient() {
  if (!playing || !ctx) return;
  const { source, gain } = playing;
  gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  setTimeout(() => {
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
  }, 1200);
  playing = null;
}
