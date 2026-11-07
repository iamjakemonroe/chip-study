import { ArrowRight, BookOpenCheck, Clock, Hourglass, MailPlus, MessageCircle, PauseCircle, ShieldCheck, Sparkles, Users, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Segmented } from '../components/ui.tsx';
import { site } from '../content/site.ts';
import { minutesLabel } from '../lib/dates.ts';
import { dayText, niceTop, weekLabel } from '../lib/institutions.ts';
import type { InstitutionOverview } from '../lib/types.ts';
import type { InstitutionView } from './InstitutionPage.tsx';

/** This week's numbers for the students this viewer can see, eight weeks of them as bars, where
 * the institution stands (waiting, paused, its pilot) and its seats. */
export function OverviewTab({ view }: { view: InstitutionView }) {
  const { ov, go } = view;
  const i = ov.institution;
  const w = ov.week;
  const admin = ov.role === 'admin';
  const [metric, setMetric] = useState<'minutes' | 'active'>('minutes');
  const nobody = ov.counts.visible_students === 0;

  return (
    <div className="space-y-5">
      <StatusBanner ov={ov} />

      {nobody && (
        <section className="card p-5 sm:p-6" aria-label="First steps">
          <h2 className="font-semibold">Bring your students in</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-3">
            {i.status === 'pending'
              ? 'While we check your institution, set up classes and invite teachers. Students can join once it’s approved.'
              : admin
                ? 'Three ways in: a class code, an invite link, or (once we’ve confirmed your email domain) their school email.'
                : 'Make a class, then share its code with your students or send them invite links.'}
          </p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            <Step n={1} title="Make a class" body="Each class gets a code students type in." onClick={() => go('classes')} />
            <Step n={2} title="Invite people" body="Paste emails, or upload a CSV, to get a link for each person." onClick={() => go('invite')} />
            <Step n={3} title="Watch it come alive" body="Study time, practice and AI-use records show up here." />
          </ol>
        </section>
      )}

      <section aria-labelledby="week-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="week-title" className="text-lg font-semibold tracking-[-0.01em]">
            This week
          </h2>
          <p className="text-sm text-ink-3">{admin ? 'All students' : 'Students in your classes'}, the last 7 days</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile icon={<Users size={16} />} label="Active students" value={w.active_students.toLocaleString()} note={`of ${ov.counts.visible_students.toLocaleString()}`} />
          <Tile icon={<Clock size={16} />} label="Study time" value={minutesLabel(w.focus_minutes)} note="in focus sessions" />
          <Tile
            icon={<BookOpenCheck size={16} />}
            label="Practice"
            value={w.practice_score === null ? '–' : `${w.practice_score}%`}
            note={`${w.practice_sessions.toLocaleString()} session${w.practice_sessions === 1 ? '' : 's'}${w.practice_score === null ? '' : ', answers right'}`}
          />
          <Tile icon={<MessageCircle size={16} />} label="Questions to Chip" value={w.chip_asks.toLocaleString()} />
          <Tile icon={<ShieldCheck size={16} />} label="AI-use records" value={w.ai_records.toLocaleString()} note="on assignments" className="col-span-2 lg:col-span-1" />
        </div>
      </section>

      <section className="card p-5 sm:p-6" aria-labelledby="weeks-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="weeks-title" className="font-semibold">
              {metric === 'minutes' ? 'Study time' : 'Active students'}, week by week
            </h2>
            <p className="text-sm text-ink-3">The last 8 weeks</p>
          </div>
          <Segmented
            label="Show"
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'minutes', label: 'Study time' },
              { value: 'active', label: 'Active students' },
            ]}
          />
        </div>
        <WeekChart weeks={ov.weeks} metric={metric} />
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <Seats ov={ov} />
        <section className="card p-5 sm:p-6" aria-label="People and classes">
          <h2 className="font-semibold">People and classes</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <Count label="Students" value={ov.counts.students} />
            <Count label="Teachers" value={ov.counts.teachers} />
            <Count label="Admins" value={ov.counts.admins} />
            <Count label="Classes" value={ov.counts.classes} />
            <Count label="Invites waiting" value={ov.counts.invites_open} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => go('students')}>
              <Users size={15} /> Students
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => go('invite')}>
              <MailPlus size={15} /> Invite
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Step({ n, title, body, onClick }: { n: number; title: string; body: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-iris-soft text-sm font-semibold text-iris-2">{n}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-semibold">
          {title} {onClick && <ArrowRight size={14} className="text-ink-4" />}
        </span>
        <span className="mt-0.5 block text-sm leading-snug text-ink-3">{body}</span>
      </span>
    </>
  );
  return (
    <li>
      {onClick ? (
        <button className="flex h-full w-full gap-3 rounded-2xl bg-paper p-4 text-left transition-colors hover:bg-paper-2" onClick={onClick}>
          {inner}
        </button>
      ) : (
        <div className="flex h-full gap-3 rounded-2xl bg-paper p-4">{inner}</div>
      )}
    </li>
  );
}

/** One number, with what it is and a word on it. */
function Tile({ icon, label, value, note, className = '' }: { icon: ReactNode; label: string; value: string; note?: string; className?: string }) {
  return (
    <div className={`card p-4 ${className}`}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-3">
        <span className="text-ink-4">{icon}</span>
        {label}
      </p>
      <p className="mt-1.5 text-[1.625rem] font-semibold leading-tight tracking-[-0.02em]">{value}</p>
      {note && <p className="text-xs text-ink-3">{note}</p>}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-lg font-semibold">{value.toLocaleString()}</dd>
    </div>
  );
}

/** Where the institution stands, when there's something to know: waiting for Kaivon, not
 * approved, paused, its pilot (and when it ends), or a pilot or plan that has ended. */
function StatusBanner({ ov }: { ov: InstitutionOverview }) {
  const i = ov.institution;
  const contact = (
    <a className="font-semibold underline underline-offset-2" href={`mailto:${site.email}`}>
      {site.email}
    </a>
  );
  let tone = 'bg-iris-soft text-iris-2';
  let icon = <Sparkles size={18} />;
  let body: ReactNode;
  if (i.status === 'pending') {
    tone = 'bg-sand-soft text-[#7a5d18]';
    icon = <Hourglass size={18} />;
    body = (
      <>
        <strong className="font-semibold">Kaivon is checking {i.name}.</strong> Until it’s approved you can make classes and invite teachers and admins. Students can join once it’s approved, and we’ll write to you then.
      </>
    );
  } else if (i.status === 'rejected') {
    tone = 'bg-rose-soft text-[#b8355a]';
    icon = <XCircle size={18} />;
    body = (
      <>
        <strong className="font-semibold">We couldn’t approve {i.name}.</strong> {i.review_note && <>{i.review_note} </>}Questions? Write to {contact}.
      </>
    );
  } else if (i.status === 'suspended') {
    tone = 'bg-peach-soft text-[#9a4a1b]';
    icon = <PauseCircle size={18} />;
    body = (
      <>
        <strong className="font-semibold">{i.name} is paused.</strong> Students can’t join and don’t get Pro for now. {i.review_note && <>{i.review_note} </>}Write to {contact}.
      </>
    );
  } else if (!i.active) {
    tone = 'bg-peach-soft text-[#9a4a1b]';
    icon = <Hourglass size={18} />;
    const ended = i.plan === 'paid' ? i.paid_until : i.pilot_ends;
    body = (
      <>
        <strong className="font-semibold">
          {i.plan === 'paid' ? 'Your plan' : 'The pilot'} ended{ended ? ` on ${dayText(ended)}` : ''}.
        </strong>{' '}
        Students keep their accounts and work, without Pro. To carry on, ask us about pricing: {contact}.
      </>
    );
  } else if (i.plan === 'pilot') {
    body = (
      <>
        <strong className="font-semibold">Free pilot{i.pilot_ends ? ` until ${dayText(i.pilot_ends)}` : ''}.</strong> Every student here has Chip Study Pro. After the pilot it’s a price per student: ask us about pricing at {contact}.
      </>
    );
  } else return null;
  return (
    <div className={`flex gap-3 rounded-2xl px-4 py-3.5 text-sm leading-relaxed ${tone}`} role="status">
      <span className="mt-0.5 flex-none">{icon}</span>
      <p>{body}</p>
    </div>
  );
}

function Seats({ ov }: { ov: InstitutionOverview }) {
  const i = ov.institution;
  const used = ov.counts.students;
  const share = i.seats ? Math.min(1, used / i.seats) : 0;
  const full = i.seats > 0 && used >= i.seats;
  return (
    <section className="card p-5 sm:p-6" aria-label="Seats">
      <h2 className="font-semibold">Seats</h2>
      {i.seats === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-ink-3">We set the number of seats when we approve {i.name}. Each student takes one; teachers and admins don’t.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-2">
            <span className="text-2xl font-semibold tracking-[-0.02em] text-ink">{used.toLocaleString()}</span> of {i.seats.toLocaleString()} used
          </p>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-iris-soft"
            role="meter"
            aria-label="Seats used"
            aria-valuemin={0}
            aria-valuemax={i.seats}
            aria-valuenow={used}
          >
            <div className={`h-full rounded-full transition-[width] duration-700 ${full ? 'bg-peach' : 'bg-iris'}`} style={{ width: `${share * 100}%` }} />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-3">
            {full ? `Every seat is taken, so nobody else can join as a student. Need more? Write to ${site.email}.` : 'Each student takes a seat; teachers and admins don’t.'}
            {i.plan === 'paid' && i.paid_until ? ` Paid until ${dayText(i.paid_until)}.` : ''}
          </p>
        </>
      )}
    </section>
  );
}

/** Eight weeks as columns, one series: the latest in iris, the rest a lighter step of it. The
 * latest is labelled on its cap and the others say theirs on hover; a table carries them all for
 * screen readers. Under each, the day its week starts. */
function WeekChart({ weeks, metric }: { weeks: InstitutionOverview['weeks']; metric: 'minutes' | 'active' }) {
  const values = weeks.map((w) => (metric === 'minutes' ? w.minutes : w.active));
  const say = (v: number) => (metric === 'minutes' ? minutesLabel(v) : `${v.toLocaleString()} student${v === 1 ? '' : 's'}`);
  const top = niceTop(Math.max(0, ...values), metric);
  if (!weeks.length) return <p className="mt-6 text-sm text-ink-3">Nothing to show yet.</p>;
  return (
    <div className="mt-5">
      <div className="relative h-44" aria-hidden="true">
        <div className="absolute inset-x-0 top-0 border-t border-line" />
        <span className="absolute right-0 top-1 text-[0.7rem] font-medium tabular-nums text-ink-4">{say(top)}</span>
        <div className="absolute inset-x-0 bottom-0 border-t border-line-2" />
        <div className="absolute inset-0 flex items-end gap-[2px] pr-14">
          {weeks.map((w, n) => {
            const v = values[n];
            const last = n === weeks.length - 1;
            const h = top ? (v / top) * 100 : 0;
            return (
              <div key={w.week} className="group relative flex h-full flex-1 items-end justify-center">
                <div
                  className="w-full max-w-6 rounded-t-[4px] transition-[height] duration-700"
                  style={{ height: v ? `max(3px, ${h}%)` : '0px', background: last ? 'var(--color-iris)' : '#c9c3ff' }}
                />
                {last && v > 0 && (
                  <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-semibold text-ink" style={{ bottom: `calc(${h}% + 4px)` }}>
                    {say(v)}
                  </span>
                )}
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs font-semibold text-white opacity-0 shadow-[var(--shadow-lift)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  {last ? 'This week' : `Week of ${weekLabel(w.week)}`}: {say(v)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex gap-[2px] pr-14" aria-hidden="true">
        {weeks.map((w, n) => (
          <span key={w.week} className={`flex-1 whitespace-nowrap text-center text-[0.65rem] font-medium sm:text-xs ${n === weeks.length - 1 ? 'font-semibold text-ink-2' : 'text-ink-4'} ${(weeks.length - 1 - n) % 2 === 1 ? 'max-sm:invisible' : ''}`}>
            {weekLabel(w.week)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{metric === 'minutes' ? 'Study time' : 'Active students'} each week, the last 8 weeks</caption>
        <thead>
          <tr>
            <th scope="col">Week starting</th>
            <th scope="col">{metric === 'minutes' ? 'Study time' : 'Active students'}</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, n) => (
            <tr key={w.week}>
              <td>{dayText(w.week)}</td>
              <td>{say(values[n])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
