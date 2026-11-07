import { Building2, GraduationCap, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { SignOutConfirm } from '../components/SignOut.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { Confirm, Segmented } from '../components/ui.tsx';
import { JoinClassModal } from '../institution/JoinClass.tsx';
import { forgetMe, leaveInstitution, myClasses } from '../lib/api.ts';
import { institutionStatus, proThrough, ROLE_LABEL, TONE_CLASS } from '../lib/institutions.ts';
import type { MyClass, MyInstitution } from '../lib/types.ts';
import { useAuth } from '../store/auth.ts';
import { PLANS, useFocus } from '../store/focus.ts';
import { useInstitutions } from '../store/institutions.ts';
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
  const mine = useInstitutions((s) => s.mine);
  const staff = useInstitutions((s) => s.staff);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState<MyInstitution | null>(null);
  const through = proThrough(me, mine);
  const [classes, setClasses] = useState<MyClass[]>([]);
  const studying = !!mine?.some((m) => m.role === 'student');
  useEffect(() => {
    if (!studying) return setClasses([]);
    myClasses()
      .then(setClasses)
      .catch(() => setClasses([]));
  }, [studying, mine]);

  useEffect(() => {
    document.title = 'Settings · Chip Study';
    void useInstitutions.getState().load();
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
            This is your Kaivon account: the same one works in Utopia. {through ? `You have Pro through ${through.name}.` : me?.tier === 'pro' ? 'You’re on Pro.' : 'You’re on the free plan.'}{' '}
            <Link className="font-semibold text-iris" to="/app/plan">
              Plan
            </Link>
          </p>
          <button className="btn btn-ghost btn-sm mt-4" onClick={() => setSigningOut(true)}>
            <LogOut size={15} /> Sign out
          </button>
          <SignOutConfirm open={signingOut} onClose={() => setSigningOut(false)} />
        </Section>

        <Section title="Your institution" id="institution">
          {mine === null ? (
            <div className="skeleton h-14" />
          ) : mine.length === 0 ? (
            <p className="text-sm leading-relaxed text-ink-3">You’re not part of a school, college or university on Chip Study. If your teacher gave you a class code, join their class here.</p>
          ) : (
            <ul className="divide-y divide-line">
              {mine.map((m) => {
                const status = institutionStatus(m);
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold">
                        <Building2 size={16} className="flex-none text-ink-4" />
                        <span className="min-w-0 break-words">{m.name}</span>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-3">
                        <span className="chip-tag bg-iris-soft text-iris-2">{ROLE_LABEL[m.role]}</span>
                        <span className={`chip-tag ${TONE_CLASS[status.tone]}`}>{status.label}</span>
                      </p>
                      {m.role === 'student' && <p className="mt-1.5 text-sm text-ink-3">{m.active ? 'You have Chip Study Pro through it.' : 'Pro from it is off for now.'}</p>}
                    </div>
                    <div className="flex flex-none gap-2">
                      {m.role !== 'student' && (
                        <Link to={`/app/institution/${m.id}`} className="btn btn-ghost btn-sm">
                          Open dashboard
                        </Link>
                      )}
                      <button className="btn btn-quiet btn-sm" onClick={() => setLeaving(m)}>
                        Leave
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {classes.length > 0 && (
            <div className="mt-3 rounded-2xl bg-paper px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">Your classes</p>
              <ul className="mt-2 space-y-2">
                {classes.map((c) => (
                  <li key={c.id} className="text-sm">
                    <span className="font-semibold text-ink">{c.name}</span> <span className="text-ink-3">· {c.institution}</span>
                    <span className="block text-xs text-ink-3">{HELP[c.help_level] ?? HELP.guide}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {studying && (
            <p className="mt-3 text-sm leading-relaxed text-ink-3">
              Its admins and your teachers see your activity and each assignment’s AI-use record, never your chats, notes or documents.{' '}
              <Link to="/privacy" className="underline underline-offset-2">
                More in Privacy
              </Link>
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setJoining(true)}>
              <GraduationCap size={15} /> Join a class
            </button>
            {staff && (
              <Link to="/app/kaivon" className="btn btn-ghost btn-sm">
                <ShieldCheck size={15} /> Kaivon review
              </Link>
            )}
          </div>
          <p className="mt-4 text-sm text-ink-3">
            Run a school, college or university?{' '}
            <Link to="/institutions" className="font-semibold text-iris hover:text-iris-2">
              Bring Chip Study to your students
            </Link>
          </p>
          <JoinClassModal open={joining} onClose={() => setJoining(false)} />
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
        open={!!leaving}
        title={`Leave ${leaving?.name ?? ''}?`}
        body={
          leaving?.role === 'student'
            ? `Its admins and teachers stop seeing your activity, and the Chip Study Pro that comes from ${leaving.name} stops. Your work stays yours. To come back, you’d need a new invite or class code.`
            : 'You’ll leave its classes and can’t open its dashboard any more. To come back, you’d need a new invite.'
        }
        yes="Leave"
        danger
        onClose={() => setLeaving(null)}
        onYes={async () => {
          if (!leaving) return;
          try {
            await leaveInstitution(leaving.id);
            await Promise.all([useInstitutions.getState().load(true), useAuth.getState().refresh()]);
            toast(`You’ve left ${leaving.name}.`, 'info');
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
      <Confirm
        open={forgetting}
        title="Delete all your study data?"
        body="Every assignment, document, note, source, task, chat with Chip, AI-use record and focus session goes for good, and you leave any school, college or university you joined as a student (with the Pro that came from it). Export anything you want to keep first."
        yes="Delete everything"
        danger
        onClose={() => setForgetting(false)}
        onYes={async () => {
          try {
            await forgetMe();
            void Promise.all([useInstitutions.getState().load(true), useAuth.getState().refresh()]);
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

/** How Chip helps in a class, as its teacher set it. */
const HELP: Record<MyClass['help_level'], string> = {
  guide: 'Chip helps in its usual way, guiding you step by step.',
  explain: 'Chip explains and checks your work here, but won’t write for you.',
  hints: 'Chip gives hints and the next small step here, not answers.',
};

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
