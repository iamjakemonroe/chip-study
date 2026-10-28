import type { Color } from './types.ts';

/** Each assignment's colour: its soft wash and its ink. */
export const COLORS: Record<Color, { soft: string; ink: string; name: string }> = {
  sky: { soft: 'var(--color-sky-soft)', ink: 'var(--color-sky)', name: 'Sky' },
  lilac: { soft: 'var(--color-lilac-soft)', ink: 'var(--color-lilac)', name: 'Lilac' },
  mint: { soft: 'var(--color-mint-soft)', ink: 'var(--color-mint)', name: 'Mint' },
  peach: { soft: 'var(--color-peach-soft)', ink: 'var(--color-peach)', name: 'Peach' },
  rose: { soft: 'var(--color-rose-soft)', ink: 'var(--color-rose)', name: 'Rose' },
  sand: { soft: 'var(--color-sand-soft)', ink: 'var(--color-sand)', name: 'Sand' },
};

export const COLOR_ORDER: Color[] = ['sky', 'lilac', 'mint', 'peach', 'rose', 'sand'];

export const TONE_STYLES = {
  calm: 'bg-paper-2 text-ink-2',
  soon: 'bg-sand-soft text-[#8a6a1f]',
  urgent: 'bg-peach-soft text-[#b25a22]',
  late: 'bg-rose-soft text-[#b8355a]',
  none: 'bg-paper-2 text-ink-3',
} as const;
