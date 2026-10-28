import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useToasts } from '../store/toast.ts';

const ease = [0.2, 0.7, 0.1, 1] as const;

/** A dialog: centred on wider screens, a sheet from the bottom on phones. Escape or the backdrop
 * closes it; focus moves in and comes back. */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 520,
  footer,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
  labelledBy?: string;
}) {
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const titleId = labelledBy ?? `${id}-title`;

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button:not([data-close])');
      first?.focus();
    }, 60);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
      before?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
          <motion.div
            className="absolute inset-0 bg-[rgb(25_26_46/0.28)] backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] bg-white shadow-[var(--shadow-lift)] sm:rounded-[1.75rem]"
            style={{ maxWidth: width }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35, ease }}
          >
            {title && (
              <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
                <h2 id={titleId} className="text-lg font-semibold tracking-[-0.01em]">
                  {title}
                </h2>
                <button className="icon-btn -mr-2 -mt-1" data-close onClick={onClose} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
            )}
            <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-paper/60 px-6 py-4 safe-bottom">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Asks before something that can't be undone. */
export function Confirm({
  open,
  title,
  body,
  yes,
  danger,
  onYes,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  yes: string;
  danger?: boolean;
  onYes: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn btn-sm ${danger ? 'bg-rose text-white hover:brightness-95' : 'btn-primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onYes();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {yes}
          </button>
        </>
      }
    >
      <div className="text-[0.9375rem] leading-relaxed text-ink-2">{body}</div>
    </Modal>
  );
}

/** A small menu that opens under its button. It floats above everything (so a scrolling
 * toolbar can't clip it) and stays inside the screen. */
export function Menu({
  label,
  button,
  children,
  align = 'right',
  className = '',
}: {
  label: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top?: number; bottom?: number; left?: number; right?: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom > window.innerHeight - 260 && r.top > 260;
    const y = up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 };
    if (align === 'right') setAt({ ...y, right: Math.max(8, window.innerWidth - r.right) });
    else setAt({ ...y, left: Math.min(Math.max(8, r.left), window.innerWidth - 220) });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: PointerEvent) => {
      if (!trigger.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onMove = () => setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`relative flex-none ${className}`}>
      <button ref={trigger} type="button" className="icon-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && at && (
            <motion.div
              ref={list}
              role="menu"
              className="fixed z-[95] min-w-[13rem] max-w-[calc(100vw-16px)] rounded-2xl border border-line bg-white p-1.5 shadow-[var(--shadow-lift)]"
              style={{ top: at.top, bottom: at.bottom, left: at.left, right: at.right }}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.16, ease }}
            >
              {children(() => setOpen(false))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-paper ${danger ? 'text-rose' : 'text-ink-2 hover:text-ink'}`}
      onClick={onClick}
    >
      {icon && <span className="grid w-4 place-items-center">{icon}</span>}
      {children}
    </button>
  );
}

/** A ring that fills as [value] goes from 0 to 1. */
export function Ring({ value, size = 40, stroke = 4, color = 'var(--color-iris)', track = 'var(--color-line)', children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 0.8s var(--ease-calm)' }}
        />
      </svg>
      {children && <span className="absolute inset-0 grid place-items-center">{children}</span>}
    </span>
  );
}

/** Choosing one of a few. */
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line bg-paper p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full font-semibold transition-all ${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'} ${value === o.value ? 'bg-white text-ink shadow-[var(--shadow-soft)]' : 'text-ink-3 hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-r-transparent opacity-70"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.3, ease }}
            className="pointer-events-auto flex max-w-[min(32rem,100%)] items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-[var(--shadow-lift)]"
          >
            <span className={`h-2 w-2 flex-none rounded-full ${t.tone === 'good' ? 'bg-[#5fd8b6]' : t.tone === 'warn' ? 'bg-[#ffb36b]' : 'bg-[#a79fff]'}`} />
            <span className="min-w-0 flex-1">{t.text}</span>
            {t.action && (
              <button
                className="font-semibold text-[#c9c3ff] hover:text-white"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Text that grows with what's typed in it, up to a point. */
export function AutoTextarea({ value, onChange, maxRows = 8, className = '', ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void; maxRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + 24)}px`;
  }, [value, maxRows]);
  return <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)} className={className} {...rest} />;
}
