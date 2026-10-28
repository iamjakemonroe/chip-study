import { Orb } from './Orb.tsx';

/** Chip coming to life while something loads: he breathes and looks about, a comet of light
 * circles him, and a calm line says what's happening. index.html shows the same before the app
 * has started, so nothing jumps when it takes over. [page]: fills the screen; otherwise its box. */
export function ChipLoader({ label = 'Opening Chip Study', size = 72, page = true }: { label?: string; size?: number; page?: boolean }) {
  return (
    <div className={page ? 'grid min-h-dvh place-items-center px-6' : 'grid h-full min-h-40 place-items-center'} role="status">
      {page && <div className="daylight" />}
      <div className="chip-loader" style={{ ['--s' as string]: `${size}px` }}>
        <span className="chip-loader-glow" aria-hidden="true" />
        <span className="chip-loader-orbit" aria-hidden="true" />
        <Orb size={size} state="alive" />
        {label && (
          <p className="chip-loader-label">
            {label}
            <span className="chip-loader-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
