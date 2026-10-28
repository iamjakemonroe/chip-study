import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useFocus } from '../store/focus.ts';
import { Orb } from './Orb.tsx';

const ease = [0.2, 0.7, 0.1, 1] as const;
const KEY = 'chip-study-focus-tip';
let seenThisVisit = false;

/** Whether Chip's focus tip has been seen: it's shown once. */
export function focusTipSeen(): boolean {
  if (seenThisVisit) return true;
  try {
    return localStorage.getItem(KEY) === 'seen';
  } catch {
    return false;
  }
}

export function markFocusTipSeen() {
  seenThisVisit = true;
  try {
    localStorage.setItem(KEY, 'seen');
  } catch {
    // Private browsing: seen for this visit only.
  }
}

/** Chip's word the first time someone starts focus, as a little conversation: a line at a time,
 * each typed in after the last, then the way to Settings to change the focus time. */
export function FocusTip({ onClose, underBar = false }: { onClose: () => void; underBar?: boolean }) {
  const plan = useFocus((s) => s.plan);
  const reduce = useReducedMotion();
  const lines = [
    'Let’s focus.',
    `Your sessions are ${plan.focus} minutes, with a ${plan.short}-minute break after each.`,
    'Want them longer or shorter? You can change your focus time in Settings.',
  ];
  const [shown, setShown] = useState(reduce ? lines.length : 0);
  const typing = shown < lines.length;

  // In focus mode: just under the focus bar, however tall it is (on a phone it wraps), never over it.
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const bar = underBar ? document.querySelector('.focus-bar') : null;
    if (!bar) return;
    const sees = new ResizeObserver(() => setTop(bar.getBoundingClientRect().bottom + 12));
    sees.observe(bar);
    return () => sees.disconnect();
  }, [underBar]);

  useEffect(() => {
    if (!typing) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 650 : 1150);
    return () => clearTimeout(t);
  }, [shown, typing]);

  const close = () => {
    markFocusTipSeen();
    onClose();
  };

  // At the page's level: a moving card around it would carry it off.
  return createPortal(
    <motion.div
      className={`focus-tip focus-tip-dock ${underBar ? 'under-bar' : ''}`}
      style={underBar && top !== null ? { top } : undefined}
      role="status"
      aria-live="polite"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.4, ease }}
    >
      <div className="flex items-start gap-2.5">
        <Orb size={30} state={typing ? 'thinking' : 'talking'} className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1.5">
          {lines.slice(0, shown).map((line, i) => (
            <motion.p
              key={i}
              className="focus-tip-bubble"
              initial={reduce ? false : { opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.35, ease }}
            >
              {line}
            </motion.p>
          ))}
          {typing && (
            <p className="focus-tip-bubble focus-tip-typing" aria-label="Chip is typing">
              <i />
              <i />
              <i />
            </p>
          )}
          {!typing && (
            <motion.div className="flex flex-wrap gap-2 pt-1" initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: 0.1 }}>
              <Link to="/app/settings#focus" className="btn btn-iris btn-sm" onClick={markFocusTipSeen}>
                Change focus time
              </Link>
              <button className="btn btn-ghost btn-sm" onClick={close}>
                Got it
              </button>
            </motion.div>
          )}
        </div>
        <button className="icon-btn -mr-1 -mt-1 h-7 w-7" aria-label="Close" onClick={close}>
          <X size={14} />
        </button>
      </div>
      <div className="focus-tip-steps" aria-hidden="true">
        {lines.map((_, i) => (
          <i key={i} className={i < shown ? 'on' : ''} />
        ))}
      </div>
    </motion.div>,
    document.body,
  );
}
