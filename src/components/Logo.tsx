import { Orb } from './Orb.tsx';

export function Logo({ size = 28, word = true, className = '' }: { size?: number; word?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Orb size={size} />
      {word && (
        <span className="font-semibold tracking-[-0.02em] text-ink" style={{ fontSize: size * 0.62 }}>
          Chip <span className="text-ink-3 font-medium">Study</span>
        </span>
      )}
    </span>
  );
}
