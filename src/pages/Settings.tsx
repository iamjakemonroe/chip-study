import { LogOut, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { SignOutConfirm } from '../components/SignOut.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { Confirm, Segmented } from '../components/ui.tsx';
import { forgetMe } from '../lib/api.ts';
import { useAuth } from '../store/auth.ts';
import { PLANS, useFocus } from '../store/focus.ts';
import { usePrefs } from '../store/prefs.ts';
import { toast } from '../store/toast.ts';

export function Settings() {
  const email = useAuth((s) => s.session?.user.email ?? '');
  const me = useAuth((s) => s.me);
  const prefs = usePrefs();
  const plan = useFocus((s) => s.plan);
  const navigate = useNavigate();
  const [forgetting, setForgetting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    document.title = 'Settings · Chip Study';
  }, []);

  // Sent here to change the focus time (Chip's tip): straight to it, glowing for a moment.
  const where = useLocation();
  const glowFocus = where.hash === '#focus';
  useEffect(() => {
    if (glowFocus) document.getElementById('focus')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [glowFocus]);

  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <h1 className="text-[2rem] font-semibold tracking-[-0.025em]">Settings</h1>

        <Section title="Account">
          <Row label="Signed in as" value={<span className="break-all">{email}</span>} />
          <p className="mt-1 text-sm leading-relaxed text-ink-3">
            This is your Kaivon account: the same one works in Utopia. {me?.tier === 'pro' ? 'You’re on Pro.' : 'You’re on the free plan.'}{' '}
            <Link className="font-semibold text-iris" to="/app/plan">
              Plan
            </Link>
          </p>
          <button className="btn btn-ghost btn-sm mt-4" onClick={() => setSigningOut(true)}>
            <LogOut size={15} /> Sign out
          </button>
          <SignOutConfirm open={signingOut} onClose={() => setSigningOut(false)} />
        </Section>

        <Section title="Writing">
          <Row
            label="Document font"
            value={
              <Segmented
                label="Document font"
                value={prefs.docFont}
                onChange={(docFont) => prefs.set({ docFont })}
                options={[
                  { value: 'serif', label: <span className="font-serif">Serif</span> },
                  { value: 'sans', label: 'Sans' },
                ]}
              />
            }
          />
          <Row
            label="Chip’s model"
            value={
              <Segmented
                label="Chip’s model"
                value={prefs.model}
                onChange={(model) => prefs.set({ model })}
                options={[
                  { value: 'best', label: 'Best' },
                  { value: 'fast', label: 'Fast' },
                ]}
              />
            }
          />
          <p className="text-sm text-ink-3">Best is Chip’s deepest thinker (with Pro). Fast answers quickly and goes further.</p>
        </Section>

        <Section title="Focus" id="focus" glow={glowFocus}>
          <Row
            label="Focus time"
            value={
              <Segmented
                label="Focus time"
                value={String(plan.focus)}
                onChange={(v) => useFocus.getState().setPlan(PLANS.find((p) => String(p.plan.focus) === v)!.plan)}
                options={PLANS.map((p) => ({ value: String(p.plan.focus), label: `${p.plan.focus} min` }))}
              />
            }
          />
          <p className="text-sm text-ink-3">
            {plan.focus} minutes of focus, then a {plan.short}-minute break, and a longer {plan.long}-minute one after every {plan.every}.
          </p>
        </Section>

        <Section title="Your data">
          <p className="text-sm leading-relaxed text-ink-3">
            Everything here is yours. You can delete an assignment at any time, or everything you have in Chip Study at once (your Kaivon account stays).
          </p>
          <button className="btn btn-sm mt-4 border border-rose/30 bg-rose-soft text-[#b8355a] hover:bg-[#fbdbe5]" onClick={() => setForgetting(true)}>
            <Trash2 size={15} /> Delete all my study data
          </button>
          <p className="mt-6 text-sm text-ink-3">
            <Link to="/terms" className="underline underline-offset-2">
              Terms
            </Link>{' '}
            ·{' '}
            <Link to="/privacy" className="underline underline-offset-2">
              Privacy
            </Link>{' '}
            · support@kaivon.app
          </p>
        </Section>
      </main>
      <Confirm
        open={forgetting}
        title="Delete all your study data?"
        body="Every assignment, document, note, source, task, chat with Chip, AI-use record and focus session goes for good. Export anything you want to keep first."
        yes="Delete everything"
        danger
        onClose={() => setForgetting(false)}
        onYes={async () => {
          try {
            await forgetMe();
            toast('Your study data is gone.', 'info');
            navigate('/app');
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
    </div>
  );
}

function Section({ title, children, id, glow = false }: { title: string; children: React.ReactNode; id?: string; glow?: boolean }) {
  return (
    <section id={id} className={`card mt-6 scroll-mt-24 p-5 sm:p-6 ${glow ? 'settings-glow' : ''}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="font-medium">{label}</span>
      <span className="min-w-0 text-ink-2">{value}</span>
    </div>
  );
}
