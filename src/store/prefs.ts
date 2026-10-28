import { create } from 'zustand';
import type { ModelKind } from '../lib/types.ts';

/** This device's preferences, kept between visits. */
interface Prefs {
  model: ModelKind;
  docFont: 'serif' | 'sans';
  chipOpen: boolean;
  scene: SceneName;
  sound: 'off' | 'rain' | 'brown' | 'waves';
  volume: number;
  set: (patch: Partial<Omit<Prefs, 'set'>>) => void;
}

export type SceneName = 'dawn' | 'sea' | 'forest' | 'night';

const KEY = 'chip-study-prefs';

function load(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
  } catch {
    return {};
  }
}

export const usePrefs = create<Prefs>((set, get) => ({
  model: 'best',
  docFont: 'serif',
  chipOpen: true,
  scene: 'dawn',
  sound: 'off',
  volume: 0.4,
  ...load(),
  set: (patch) => {
    set(patch);
    const { set: _omit, ...rest } = { ...get(), ...patch };
    void _omit;
    try {
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      // Private browsing: preferences last for this visit.
    }
  },
}));
