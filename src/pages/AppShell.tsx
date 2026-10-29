import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { payStatus } from '../lib/api.ts';
import { useAuth } from '../store/auth.ts';
import { useFocus } from '../store/focus.ts';

/** The signed-in app: everything under /app. Someone signed out is sent to sign in, and back
 * here after. */
export function AppShell() {
  const ready = useAuth((s) => s.ready);
  const session = useAuth((s) => s.session);
  const where = useLocation();
  const signedIn = !!session;

  // Whether Pro can be bought is asked as the app opens, so the plan page has it ready.
  useEffect(() => {
    if (signedIn) void payStatus();
  }, [signedIn]);

  if (!ready) return <ChipLoader />;
  if (!session) return <Navigate to={`/signin?next=${encodeURIComponent(where.pathname + where.search)}`} replace />;
  return (
    <>
      <div className="daylight" />
      <FocusTicker />
      <Outlet />
    </>
  );
}

/** Moves the focus timer on while the app is open (and catches up after a sleep). */
function FocusTicker() {
  const running = useFocus((s) => s.running);
  useEffect(() => {
    if (!running) return;
    const tick = () => useFocus.getState().tick();
    tick();
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [running]);
  return null;
}
