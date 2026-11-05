import { create } from 'zustand';

/** How the code editor looks and behaves, kept on this device. */

export interface CodeSettings {
  theme: 'day' | 'night';
  fontSize: number;
  wrap: boolean;
  vim: boolean;
  guides: boolean;
  tabSize: 2 | 4;
  /** The output panel's share of the height, 0.15–0.8. */
  panel: number;
}

const KEY = 'chip-study-code-settings';
const defaults: CodeSettings = { theme: 'day', fontSize: 14, wrap: true, vim: false, guides: true, tabSize: 4, panel: 0.38 };

function read(): CodeSettings {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CodeSettings>) };
  } catch {
    return defaults;
  }
}

export const useCodeSettings = create<CodeSettings & { change: (patch: Partial<CodeSettings>) => void }>((set, get) => ({
  ...read(),
  change: (patch) => {
    set(patch);
    try {
      const { change: _, ...now } = get();
      localStorage.setItem(KEY, JSON.stringify(now));
    } catch {
      // Private browsing: the settings last until the tab closes.
    }
  },
}));
