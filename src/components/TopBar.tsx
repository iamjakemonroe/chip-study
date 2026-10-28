import { CreditCard, FileText, LogOut, Pause, Play, Settings as SettingsIcon, Shield, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { chipTime, describe } from '../lib/allowance.ts';
import { useAuth } from '../store/auth.ts';
import { clock, remaining, useFocus } from '../store/focus.ts';
import { Logo } from './Logo.tsx';
import { Menu, MenuItem, Ring } from './ui.tsx';

/** The bar across the top of the desk, the plan and settings. */
export function TopBar() {
  const navigate = useNavigate();
  const signOut = useAuth((s) => s.signOut);
  const email = useAuth((s) => s.session?.user.email ?? '');
  const me = useAuth((s) => s.me);
  const initial = (me?.name || email || '?').trim()[0]?.toUpperCase() ?? '?';

  return (
    <header className="sticky top-0 z-40 border-b border-white/60 bg-[rgb(247_247_251/0.75)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link to="/app" aria-label="Your desk" className="mr-2">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
          {[
            ['/app', 'Desk'],
            ['/app/review', 'Review'],
            ['/app/plan', 'Pro'],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${isActive ? 'bg-white text-ink shadow-[var(--shadow-soft)]' : 'text-ink-3 hover:text-ink'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <FocusPill />
          <ChipMeter />
          <Menu
            label="Your account"
            button={
              <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#8b7dff] to-[#4fb4f0] text-sm font-semibold text-white">
                {initial}
              </span>
            }
          >
            {(close) => (
              <>
                <div className="px-3 pb-2 pt-1.5">
                  <p className="truncate text-sm font-semibold">{me?.name || 'Your account'}</p>
                  <p className="truncate text-xs text-ink-3">{email}</p>
                </div>
                <div className="my-1 h-px bg-line" />
                <MenuItem icon={<CreditCard size={15} />} onClick={() => (close(), navigate('/app/plan'))}>
                  {me?.tier === 'pro' ? 'Your Pro plan' : 'Plan & Chip time'}
                </MenuItem>
                <MenuItem icon={<SettingsIcon size={15} />} onClick={() => (close(), navigate('/app/settings'))}>
                  Settings
                </MenuItem>
                <MenuItem icon={<FileText size={15} />} onClick={() => (close(), navigate('/terms'))}>
                  Terms
                </MenuItem>
                <MenuItem icon={<Shield size={15} />} onClick={() => (close(), navigate('/privacy'))}>
                  Privacy
                </MenuItem>
                <div className="my-1 h-px bg-line" />
                <MenuItem
                  icon={<LogOut size={15} />}
                  onClick={async () => {
                    close();
                    await signOut();
                    navigate('/signin', { replace: true });
                  }}
                >
                  Sign out
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>
      <nav className="flex items-center gap-1 px-4 pb-2 sm:hidden" aria-label="Main">
        {[
          ['/app', 'Desk'],
          ['/app/review', 'Review'],
          ['/app/plan', 'Pro'],
          ['/app/settings', 'Settings'],
        ].map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `rounded-full px-3 py-1 text-sm font-semibold transition-colors ${isActive ? 'bg-white text-ink shadow-[var(--shadow-soft)]' : 'text-ink-3'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

/** What's left of today's Chip time, as a ring. */
export function ChipMeter({ compact = false }: { compact?: boolean }) {
  const me = useAuth((s) => s.me);
  if (!me) return null;
  const best = me.tier === 'pro' ? chipTime(me, 'best') : null;
  const t = best && best.messages > 0 ? best : chipTime(me, 'fast');
  if (!t) return null;
  const label = `${t.kind === 'best' ? 'Chip’s best' : 'Chip Fast'}: ${describe(t)}`;
  return (
    <Link to="/app/plan" className="flex items-center gap-2 rounded-full px-1.5 py-1 hover:bg-white/70" title={label} aria-label={label}>
      <Ring value={t.share} size={28} stroke={3.5} color={t.kind === 'best' ? 'var(--color-iris)' : 'var(--color-sky)'}>
        <span className="text-[0.6rem] font-bold text-ink-2">{t.kind === 'best' ? '✦' : '⚡'}</span>
      </Ring>
      {!compact && <span className="hidden text-xs font-semibold text-ink-3 lg:inline">{describe(t).replace('messages ', '').replace(' today', '')}</span>}
    </Link>
  );
}

/** The focus timer, when it's going. */
export function FocusPill() {
  const running = useFocus((s) => s.running);
  const phase = useFocus((s) => s.phase);
  const left = useFocus((s) => s.left);
  const plan = useFocus((s) => s.plan);
  const endsAt = useFocus((s) => s.endsAt);
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const paused = !running && left < plan.focus * 60000 && phase === 'focus';
  if (!running && !paused) return null;
  const ms = remaining({ running, endsAt, left });
  return (
    <button
      className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold tabular-nums ${phase === 'focus' ? 'bg-iris-soft text-iris-2' : 'bg-mint-soft text-mint'}`}
      onClick={() => (running ? useFocus.getState().pause() : useFocus.getState().start())}
      aria-label={running ? 'Pause the focus timer' : 'Carry on the focus timer'}
    >
      {running ? <Pause size={13} /> : <Play size={13} />}
      <Timer size={13} className="hidden sm:block" />
      {clock(ms)}
      <span className="hidden font-medium opacity-70 sm:inline">{phase === 'focus' ? 'focus' : 'break'}</span>
    </button>
  );
}
