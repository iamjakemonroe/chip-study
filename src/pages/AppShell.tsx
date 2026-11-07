import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { AgeGate } from '../components/AgeGate.tsx';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { PlatformConsent } from '../institution/PlatformConsent.tsx';
import { ApiError, payStatus, redeemReferral } from '../lib/api.ts';
import { dropReferral, pendingReferral, quietReferralError } from '../lib/referral.ts';
import { useAuth } from '../store/auth.ts';
import { useFocus } from '../store/focus.ts';
import { toast } from '../store/toast.ts';

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
      <Referral />
      <Outlet />
      <AgeGate />
      <PlatformConsent />
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

let redeeming = false;

/** A new account that came from a friend's invite link says so, once: both get a week of Pro once
 * it's really used. A code that can't be used is dropped without a word. */
function Referral() {
  const me = useAuth((s) => s.me);
  useEffect(() => {
    if (!me || me.tier === 'guest' || redeeming) return;
    const code = pendingReferral();
    if (!code) return;
    redeeming = true;
    redeemReferral(code)
      .then((r) => {
        dropReferral();
        toast(`Welcome. You came through ${r.referrer}: you’ll both get a week of Pro once you’ve asked Chip 3 questions.`, 'good');
      })
      .catch((e) => {
        if (e instanceof ApiError && quietReferralError(e.raw)) dropReferral();
      })
      .finally(() => (redeeming = false));
  }, [me]);
  return null;
}
