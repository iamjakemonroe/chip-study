/** Chip: a small orb of daylight with two eyes. It breathes while idle, glows and turns while it
 * thinks, and blinks now and then. Pure CSS, so it costs nothing to keep on screen. */
export function Orb({ size = 32, state = 'idle', className = '' }: { size?: number; state?: 'idle' | 'thinking' | 'talking' | 'alive'; className?: string }) {
  return (
    <span className={`orb orb-${state} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="orb-sheen" />
      <span className="orb-face">
        <span className="orb-eye" />
        <span className="orb-eye" />
      </span>
    </span>
  );
}
