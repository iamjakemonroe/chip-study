import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Orb } from '../components/Orb.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { Field, Modal, Spinner } from '../components/ui.tsx';
import { notAllowed, staffInstitutions, staffReview, type Review } from '../lib/api.ts';
import { toDay } from '../lib/dates.ts';
import { cleanDomain, countryName, dayText, institutionStatus, isDomain, isPublicDomain, KIND_LABEL, TONE_CLASS } from '../lib/institutions.ts';
import type { InstitutionStatus, StaffInstitution } from '../lib/types.ts';
import { toast } from '../store/toast.ts';

type Filter = InstitutionStatus | 'all';
type Mode = 'approve' | 'change' | 'reject' | 'suspend' | 'paid';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: 'Waiting' },
  { id: 'approved', label: 'Approved' },
  { id: 'suspended', label: 'Paused' },
  { id: 'rejected', label: 'Not approved' },
  { id: 'all', label: 'All' },
];

/** Kaivon's review of institutions: check each one that registers, then approve it (with seats,
 * a pilot and, once checked, its email domain), turn it down, pause it, or move it to paid seats.
 * Only Kaivon staff can open it: the server tells everyone else 'not allowed'. */
export function KaivonPage() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<StaffInstitution[] | null>(null);
  const [state, setState] = useState<'ok' | 'denied' | 'error'>('ok');
  const [acting, setActing] = useState<{ mode: Mode; inst: StaffInstitution } | null>(null);

  const load = useCallback(async (f: Filter) => {
    try {
      setRows(await staffInstitutions(f));
      setState('ok');
    } catch (e) {
      setState(notAllowed(e) ? 'denied' : 'error');
    }
  }, []);

  useEffect(() => {
    document.title = 'Kaivon review · Chip Study';
  }, []);
  useEffect(() => {
    setRows(null);
    void load(filter);
  }, [filter, load]);

  if (state === 'denied') {
    return (
      <div className="min-h-dvh">
        <TopBar />
        <main className="mx-auto flex max-w-md flex-col items-center px-6 pb-24 pt-20 text-center">
          <Orb size={56} />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">This page is for the Kaivon team</h1>
          <p className="mt-2 text-ink-3">It’s where we check the institutions that register.</p>
          <Link to="/app" className="btn btn-primary mt-6">
            Back to my desk
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <p className="flex items-center gap-2 text-sm font-semibold text-iris">
          <ShieldCheck size={16} /> Kaivon staff
        </p>
        <h1 className="mt-1 text-[2rem] font-semibold tracking-[-0.025em]">Institutions</h1>
        <p className="mt-1 max-w-2xl leading-relaxed text-ink-2">Check each one is real before its students can join. Confirm an email domain only when you’re sure it’s the institution’s: anyone with it can then take a seat.</p>

        <div className="no-scrollbar mt-6 flex max-w-full overflow-x-auto">
          <div className="flex w-full flex-none rounded-full border border-line bg-white/70 p-0.5 text-[0.8125rem] font-semibold sm:w-auto sm:text-sm" role="tablist" aria-label="Status">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`flex-1 whitespace-nowrap rounded-full px-2 py-1.5 transition-colors sm:flex-none sm:px-3.5 ${filter === f.id ? 'bg-ink text-white' : 'text-ink-3 hover:text-ink'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {state === 'error' && (
          <p className="mt-5 rounded-2xl bg-peach-soft px-4 py-3 text-sm text-[#9a4a1b]">
            Couldn’t load them just now.{' '}
            <button className="font-semibold underline" onClick={() => void load(filter)}>
              Try again
            </button>
          </p>
        )}

        {rows === null ? (
          state === 'ok' && (
            <div className="mt-6 h-56">
              <ChipLoader page={false} label="Loading institutions" />
            </div>
          )
        ) : rows.length === 0 ? (
          <div className="mt-6 rounded-[1.5rem] border border-dashed border-line-2 bg-white/50 px-6 py-14 text-center">
            <p className="font-semibold">{filter === 'pending' ? 'Nothing waiting' : 'None here'}</p>
            <p className="mt-1 text-sm text-ink-3">{filter === 'pending' ? 'New registrations show up here.' : 'Try another tab.'}</p>
          </div>
        ) : (
          <ul className="mt-6 space-y-4">
            {rows.map((i) => (
              <InstitutionCard key={i.id} i={i} onAct={(mode) => setActing({ mode, inst: i })} />
            ))}
          </ul>
        )}
      </main>
      <ReviewModal
        acting={acting}
        onClose={() => setActing(null)}
        onDone={async (said) => {
          setActing(null);
          toast(said, 'good');
          await load(filter);
        }}
      />
    </div>
  );
}

function InstitutionCard({ i, onAct }: { i: StaffInstitution; onAct: (mode: Mode) => void }) {
  const active = i.status === 'approved' && (i.plan === 'paid' ? !i.paid_until || i.paid_until >= toDay(new Date()) : !i.pilot_ends || i.pilot_ends >= toDay(new Date()));
  const status = institutionStatus({ ...i, active });
  return (
    <li className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold leading-snug">{i.name}</h2>
          <p className="text-sm text-ink-3">
            {KIND_LABEL[i.kind]} · {countryName(i.country)} · registered {dayText(i.created_at)}
          </p>
        </div>
        <span className={`chip-tag ${TONE_CLASS[status.tone]}`}>{status.label}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm lg:grid-cols-3">
        <Item label="Contact" wide>
          {[i.contact_name, i.contact_role].filter(Boolean).join(', ') || '–'}
          {i.contact_email && (
            <a className="block break-all font-medium text-iris hover:text-iris-2" href={`mailto:${i.contact_email}`}>
              {i.contact_email}
            </a>
          )}
        </Item>
        <Item label="Website" wide>
          {i.website ? (
            <a className="inline-flex max-w-full items-center gap-1 break-all font-medium text-iris hover:text-iris-2" href={/^https?:\/\//.test(i.website) ? i.website : `https://${i.website}`} target="_blank" rel="noopener noreferrer">
              {i.website.replace(/^https?:\/\//, '')} <ExternalLink size={13} className="flex-none" />
            </a>
          ) : (
            '–'
          )}
        </Item>
        <Item label="Students, about">{i.students_estimate ? i.students_estimate.toLocaleString() : '–'}</Item>
        <Item label="Email domain asked for">{i.domain_requested ? `@${i.domain_requested}` : '–'}</Item>
        <Item label="Email domain confirmed">{i.email_domain ? `@${i.email_domain}` : 'None'}</Item>
        <Item label="Seats">{i.seats ? `${i.students.toLocaleString()} of ${i.seats.toLocaleString()} used` : `${i.students.toLocaleString()} students, no seats yet`}</Item>
        {i.status === 'approved' && (
          <Item label={i.plan === 'paid' ? 'Paid until' : 'Pilot ends'}>{dayText(i.plan === 'paid' ? i.paid_until : i.pilot_ends) || 'No end date'}</Item>
        )}
        {i.reviewed_at && <Item label="Last reviewed">{dayText(i.reviewed_at)}</Item>}
        {i.review_note && <Item label="Note">{i.review_note}</Item>}
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        {i.status === 'approved' ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => onAct('change')}>
              Change seats or domain
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onAct('paid')}>
              Move to paid
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onAct('suspend')}>
              Suspend
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-iris btn-sm" onClick={() => onAct('approve')}>
              {i.status === 'pending' ? 'Approve' : 'Approve again'}
            </button>
            {i.status !== 'rejected' && (
              <button className="btn btn-ghost btn-sm" onClick={() => onAct('reject')}>
                Reject
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function Item({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <dt className="text-xs font-semibold text-ink-3">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{children}</dd>
    </div>
  );
}

const TITLES: Record<Mode, (name: string) => string> = {
  approve: (n) => `Approve ${n}`,
  change: (n) => `Change ${n}`,
  reject: (n) => `Reject ${n}`,
  suspend: (n) => `Suspend ${n}`,
  paid: (n) => `Move ${n} to paid`,
};

/** One decision on an institution, with what it needs: seats, a pilot length and an email domain
 * to approve; a note to reject or suspend; an end date and seats for paid. */
function ReviewModal({ acting, onClose, onDone }: { acting: { mode: Mode; inst: StaffInstitution } | null; onClose: () => void; onDone: (said: string) => Promise<void> }) {
  const [seats, setSeats] = useState('50');
  const [days, setDays] = useState('90');
  const [domain, setDomain] = useState('');
  const [note, setNote] = useState('');
  const [until, setUntil] = useState('');
  const [clear, setClear] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!acting) return;
    const i = acting.inst;
    setSeats(String(i.seats || 50));
    setDays(acting.mode === 'approve' && i.status === 'pending' ? '90' : acting.mode === 'approve' && !i.pilot_ends ? '90' : '');
    setDomain(i.email_domain ?? i.domain_requested ?? '');
    setNote(acting.mode === 'reject' || acting.mode === 'suspend' ? '' : i.review_note);
    const year = new Date();
    year.setFullYear(year.getFullYear() + 1);
    setUntil(i.paid_until ?? toDay(year));
    setClear(false);
    setError('');
  }, [acting]);

  if (!acting) return <Modal open={false} onClose={onClose}>{null}</Modal>;
  const { mode, inst } = acting;

  const submit = async () => {
    setError('');
    const n = Number(seats);
    const d = days.trim() === '' ? null : Number(days);
    const dom = cleanDomain(domain);
    let review: Review;
    if (mode === 'approve' || mode === 'change') {
      if (!Number.isInteger(n) || n < 0) return setError('Seats is a whole number.');
      if (d !== null && (!Number.isInteger(d) || d < 1 || d > 3650)) return setError('The pilot is a number of days, from 1 to 3650.');
      if (!clear && dom && !isDomain(dom)) return setError('That email domain doesn’t look right.');
      if (!clear && dom && isPublicDomain(dom)) return setError('That’s a public email domain. Only confirm the institution’s own.');
      review = { status: 'approved', seats: n, pilotDays: d, emailDomain: clear ? null : dom || null, clearDomain: clear, note: note.trim() };
    } else if (mode === 'paid') {
      if (!Number.isInteger(n) || n < 0) return setError('Seats is a whole number.');
      if (!until) return setError('Pick the day it’s paid until.');
      review = { status: 'approved', plan: 'paid', paidUntil: until, seats: n, note: note.trim() || null };
    } else {
      review = { status: mode === 'reject' ? 'rejected' : 'suspended', note: note.trim() };
    }
    setBusy(true);
    try {
      await staffReview(inst.id, review);
      await onDone(
        mode === 'approve'
          ? `${inst.name} is approved.`
          : mode === 'change'
            ? `${inst.name} is updated${clear ? ', without its email domain' : ''}.`
            : mode === 'paid'
              ? `${inst.name} is on paid seats until ${dayText(until)}.`
              : mode === 'reject'
                ? `${inst.name} is turned down.`
                : `${inst.name} is paused.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={TITLES[mode](inst.name)}
      width={520}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn btn-sm ${mode === 'reject' || mode === 'suspend' ? 'bg-rose text-white hover:brightness-95' : 'btn-primary'}`} disabled={busy} onClick={() => void submit()}>
            {busy ? <Spinner /> : { approve: 'Approve', change: 'Save', reject: 'Reject', suspend: 'Suspend', paid: 'Move to paid' }[mode]}
          </button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {(mode === 'approve' || mode === 'change' || mode === 'paid') && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="rv-seats" label="Seats" hint={inst.students_estimate ? `They said about ${inst.students_estimate.toLocaleString()} students.` : undefined}>
              <input id="rv-seats" className="field" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ''))} data-autofocus />
            </Field>
            {mode === 'paid' ? (
              <Field id="rv-until" label="Paid until">
                <input id="rv-until" type="date" className="field" value={until} onChange={(e) => setUntil(e.target.value)} />
              </Field>
            ) : (
              <Field id="rv-days" label="Pilot length, in days" optional={mode === 'change' || inst.status !== 'pending'} hint={mode === 'change' ? (inst.pilot_ends ? `Empty keeps ${dayText(inst.pilot_ends)}.` : 'Empty keeps it open-ended.') : 'Counted from today.'}>
                <input id="rv-days" className="field" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
              </Field>
            )}
          </div>
        )}
        {(mode === 'approve' || mode === 'change') && (
          <Field
            id="rv-domain"
            label="Email domain to confirm"
            optional
            hint={`${inst.domain_requested ? `They asked for @${inst.domain_requested}. ` : ''}Anyone with an email there can join as a student.`}
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4">@</span>
              <input id="rv-domain" className="field pl-8 disabled:opacity-50" value={domain} disabled={clear} autoCapitalize="none" spellCheck={false} onChange={(e) => setDomain(e.target.value)} />
            </div>
            {inst.email_domain && (
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-ink-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-rose)]" checked={clear} onChange={(e) => setClear(e.target.checked)} />
                <span>
                  Remove the confirmed domain (@{inst.email_domain}). Nobody new can join with it; students already in stay.
                </span>
              </label>
            )}
          </Field>
        )}
        <Field id="rv-note" label={mode === 'reject' || mode === 'suspend' ? 'Why' : 'Note'}
          hint="Its admins can see this." optional>
          <textarea id="rv-note" className="field min-h-20 resize-y" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {mode === 'suspend' && <p className="text-sm leading-relaxed text-ink-3">Its students lose Pro and nobody new can join until it’s approved again. Their work stays theirs.</p>}
        {error && (
          <p className="rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
