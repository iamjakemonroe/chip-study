import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { joinByEmail } from '../lib/api.ts';
import type { SuggestedInstitution } from '../lib/types.ts';
import { useAge } from '../store/age.ts';
import { useAuth } from '../store/auth.ts';
import { useInstitutions } from '../store/institutions.ts';
import { toast } from '../store/toast.ts';
import { ConsentModal } from './Consent.tsx';

const HIDDEN = 'chip-study-school-hidden';

function hiddenIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** On the desk, when your email's domain is an active institution's: it's there to join, after
 * reading what joining means. "Not now" hides it on this device. */
export function SchoolCard() {
  const suggested = useInstitutions((s) => s.suggested);
  const [hidden, setHidden] = useState(hiddenIds);
  const [asking, setAsking] = useState<SuggestedInstitution | null>(null);
  const school = suggested.find((s) => !hidden.includes(s.id));
  if (!school) return null;

  const hide = () => {
    const next = [...hidden, school.id];
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN, JSON.stringify(next));
    } catch {
      // Shown again next time.
    }
  };

  return (
    <section className="card relative mt-4 flex flex-col gap-4 overflow-hidden p-5 sm:flex-row sm:items-center" aria-label="Your school is on Chip Study">
      <span className="glow-spot pointer-events-none absolute -left-16 -top-20 h-52 w-52" style={{ ['--glow' as string]: 'var(--color-mint-soft)' }} aria-hidden="true" />
      <span className="relative grid h-11 w-11 flex-none place-items-center rounded-full bg-mint-soft text-mint">
        <GraduationCap size={21} />
      </span>
      <div className="relative min-w-0 flex-1">
        <h2 className="font-semibold">Your school is on Chip Study</h2>
        <p className="mt-0.5 text-sm leading-relaxed text-ink-3">
          {school.name} uses Chip Study. Join with your school email and Chip Study Pro is yours while you study there.
        </p>
      </div>
      <div className="relative flex flex-none flex-wrap gap-2">
        <button className="btn btn-quiet btn-sm" onClick={hide}>
          Not now
        </button>
        <button className="btn btn-iris btn-sm" onClick={() => setAsking(school)}>
          See what joining means
        </button>
      </div>
      <ConsentModal
        open={!!asking}
        onClose={() => setAsking(null)}
        title={`Join ${asking?.name ?? ''}?`}
        name={asking?.name}
        yes={`Join ${asking?.name ?? ''}`}
        onYes={async () => {
          if (!asking || !(await useAge.getState().ensure())) return;
          const r = await joinByEmail(asking.id);
          await Promise.all([useAuth.getState().refresh(), useInstitutions.getState().load(true)]);
          setAsking(null);
          toast(`You’ve joined ${r.name}. Chip Study Pro is yours while you’re there.`, 'good');
        }}
      />
    </section>
  );
}
