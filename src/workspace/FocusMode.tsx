import { AnimatePresence } from 'framer-motion';
import { CloudRain, Pause, Play, SkipForward, Volume2, VolumeX, Waves, Wind, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FocusTip, focusTipSeen } from '../components/FocusTip.tsx';
import { playAmbient, stopAmbient } from '../lib/sound.ts';
import { clock, remaining, useFocus } from '../store/focus.ts';
import { usePrefs, type SceneName } from '../store/prefs.ts';
import { useWorkspace } from './store.ts';

export const SCENES: { id: SceneName; name: string; swatch: string }[] = [
  { id: 'dawn', name: 'Dawn', swatch: 'linear-gradient(135deg,#ffe3d3,#e7ddff)' },
  { id: 'sea', name: 'Sea', swatch: 'linear-gradient(135deg,#d6f0ff,#d5f5ea)' },
  { id: 'forest', name: 'Forest', swatch: 'linear-gradient(135deg,#dff3df,#f3ecd2)' },
  { id: 'night', name: 'Night', swatch: 'linear-gradient(135deg,#1b1d3a,#2c2457)' },
];

/** The calm behind focus mode: a few soft fields of colour drifting very slowly. They move on the
 * compositor only (transform), so the page never has to redraw for them. */
export function FocusScene() {
  const scene = usePrefs((s) => s.scene);
  return (
    <div className={`focus-scene scene-${scene}`} aria-hidden="true">
      <span className="fs-blob fs-a" />
      <span className="fs-blob fs-b" />
      <span className="fs-blob fs-c" />
      {scene === 'night' && <span className="fs-stars" />}
    </div>
  );
}

/** The bar at the top of focus mode: the timer, the scene and the sound. */
export function FocusBar() {
  const running = useFocus((s) => s.running);
  const phase = useFocus((s) => s.phase);
  const left = useFocus((s) => s.left);
  const endsAt = useFocus((s) => s.endsAt);
  const prefs = usePrefs();
  const [, tick] = useState(0);
  const assignmentId = useWorkspace((s) => s.assignment?.id ?? null);
  const [tip, setTip] = useState(() => !focusTipSeen());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // The sound plays while focus mode is open.
  useEffect(() => {
    if (prefs.sound === 'off') stopAmbient();
    else playAmbient(prefs.sound, prefs.volume);
  }, [prefs.sound, prefs.volume]);
  useEffect(() => () => stopAmbient(), []);

  // Esc leaves focus mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) useWorkspace.setState({ focusMode: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ms = remaining({ running, endsAt, left });
  const sounds = [
    { id: 'off', icon: <VolumeX size={15} />, name: 'No sound' },
    { id: 'rain', icon: <CloudRain size={15} />, name: 'Rain' },
    { id: 'brown', icon: <Wind size={15} />, name: 'Soft noise' },
    { id: 'waves', icon: <Waves size={15} />, name: 'Waves' },
  ] as const;

  return (
    <div className="focus-bar">
      <div className="flex items-center gap-2">
        <button
          className="grid h-10 w-10 place-items-center rounded-full bg-ink text-white"
          onClick={() => (running ? useFocus.getState().pause() : useFocus.getState().start(assignmentId))}
          aria-label={running ? 'Pause' : 'Start'}
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="min-w-[4.5rem]">
          <p className="text-xl font-semibold leading-none tabular-nums tracking-[-0.02em]">{clock(ms)}</p>
          <p className="mt-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.08em] opacity-60">{phase === 'focus' ? 'Focus' : phase === 'long' ? 'Long break' : 'Break'}</p>
        </div>
        <button className="icon-btn" onClick={() => useFocus.getState().skip()} aria-label={phase === 'focus' ? 'Finish this focus' : 'Skip the break'} title={phase === 'focus' ? 'Finish this focus' : 'Skip the break'}>
          <SkipForward size={16} />
        </button>
      </div>
      <span className="focus-bar-divider" />
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Scene">
        {SCENES.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={prefs.scene === s.id}
            aria-label={s.name}
            title={s.name}
            onClick={() => prefs.set({ scene: s.id })}
            className={`h-6 w-6 rounded-full border-2 transition-transform ${prefs.scene === s.id ? 'scale-110 border-white shadow-[0_0_0_2px_var(--color-iris)]' : 'border-white/70 hover:scale-105'}`}
            style={{ background: s.swatch }}
          />
        ))}
      </div>
      <span className="focus-bar-divider" />
      <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Sound">
        {sounds.map((s) => (
          <button key={s.id} role="radio" aria-checked={prefs.sound === s.id} aria-label={s.name} title={s.name} className="icon-btn h-8 w-8" aria-pressed={prefs.sound === s.id} onClick={() => prefs.set({ sound: s.id })}>
            {s.icon}
          </button>
        ))}
        {prefs.sound !== 'off' && (
          <label className="ml-1 flex items-center gap-1.5">
            <Volume2 size={14} className="opacity-60" />
            <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={(e) => prefs.set({ volume: Number(e.target.value) })} aria-label="Volume" className="w-20 accent-[var(--color-iris)]" />
          </label>
        )}
      </div>
      <span className="focus-bar-divider" />
      <button className="btn btn-quiet btn-sm h-9" onClick={() => useWorkspace.setState({ focusMode: false })}>
        <X size={15} /> Leave
      </button>
      <AnimatePresence>{tip && <FocusTip underBar onClose={() => setTip(false)} />}</AnimatePresence>
    </div>
  );
}
