import { CheckCircle2, Hourglass, LogOut, MailQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Confirm, Field, Spinner } from '../components/ui.tsx';
import { site } from '../content/site.ts';
import { leaveInstitution, updateInstitution } from '../lib/api.ts';
import { cleanDomain, cleanWebsite, countryName, dayText, institutionStatus, isDomain, isPublicDomain, KIND_LABEL } from '../lib/institutions.ts';
import { useAuth } from '../store/auth.ts';
import { useInstitutions } from '../store/institutions.ts';
import { toast } from '../store/toast.ts';
import type { InstitutionView } from './InstitutionPage.tsx';

/** The institution's details (admins edit them), whether its email domain is confirmed, its plan,
 * and leaving it. */
export function SettingsTab({ view }: { view: InstitutionView }) {
  const { ov, reload } = view;
  const i = ov.institution;
  const admin = ov.role === 'admin';
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: i.name, website: i.website, contactName: i.contact_name, contactRole: i.contact_role, domain: i.domain_requested });
  const [error, setError] = useState<{ name?: string; domain?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setForm({ name: i.name, website: i.website, contactName: i.contact_name, contactRole: i.contact_role, domain: i.domain_requested });
  }, [i]);

  const changed =
    form.name.trim() !== i.name ||
    cleanWebsite(form.website) !== i.website ||
    form.contactName.trim() !== i.contact_name ||
    form.contactRole.trim() !== i.contact_role ||
    cleanDomain(form.domain) !== i.domain_requested;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const domain = cleanDomain(form.domain);
    const found: typeof error = {};
    if (form.name.trim().length < 2) found.name = 'Add the institution’s name.';
    if (domain && !isDomain(domain)) found.domain = 'That doesn’t look like an email domain. It’s the part after the @.';
    else if (domain && isPublicDomain(domain)) found.domain = 'That’s a public email domain. Use the institution’s own.';
    setError(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await updateInstitution(i.id, {
        name: form.name.trim(),
        website: cleanWebsite(form.website),
        contact_name: form.contactName.trim(),
        contact_role: form.contactRole.trim(),
        domain_requested: domain,
      });
      await reload();
      void useInstitutions.getState().load(true);
      toast('Saved.', 'good');
    } catch (err) {
      setError({ form: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const status = institutionStatus(i);
  const asked = cleanDomain(form.domain);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section className="card p-5 sm:p-6" aria-labelledby="details-title">
        <h2 id="details-title" className="font-semibold">
          Details
        </h2>
        {admin ? (
          <form className="mt-4 space-y-5" onSubmit={save} noValidate>
            <Field id="set-name" label="Name" error={error.name}>
              <input id="set-name" className="field" value={form.name} maxLength={160} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field id="set-website" label="Website" optional>
              <input id="set-website" className="field" value={form.website} maxLength={300} inputMode="url" onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="set-contact" label="Contact name">
                <input id="set-contact" className="field" value={form.contactName} maxLength={120} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              </Field>
              <Field id="set-role" label="Their role">
                <input id="set-role" className="field" value={form.contactRole} maxLength={120} onChange={(e) => setForm({ ...form, contactRole: e.target.value })} />
              </Field>
            </div>
            <Field id="set-domain" label="Students’ email domain" optional error={error.domain} hint="We confirm a new one before anyone can join with it.">
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4">@</span>
                <input id="set-domain" className="field pl-8" value={form.domain} maxLength={120} autoCapitalize="none" spellCheck={false} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
              </div>
            </Field>
            {error.form && (
              <p className="rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
                {error.form}
              </p>
            )}
            <button className="btn btn-primary btn-sm" disabled={busy || !changed}>
              {busy ? <Spinner /> : 'Save changes'}
            </button>
          </form>
        ) : (
          <dl className="mt-3 space-y-3 text-sm">
            <Row label="Name" value={i.name} />
            {i.website && <Row label="Website" value={i.website} />}
            {i.contact_name && <Row label="Contact" value={[i.contact_name, i.contact_role].filter(Boolean).join(', ')} />}
          </dl>
        )}
      </section>

      <div className="space-y-5">
        <section className="card p-5 sm:p-6" aria-labelledby="domain-title">
          <h2 id="domain-title" className="font-semibold">
            Joining with a school email
          </h2>
          {i.email_domain ? (
            <p className="mt-3 flex gap-2.5 text-sm leading-relaxed text-ink-2">
              <CheckCircle2 size={18} className="mt-0.5 flex-none text-mint" />
              <span>
                <strong className="font-semibold text-ink">@{i.email_domain}</strong> is confirmed. Anyone who signs in with one sees {i.name} on their desk, and can join as a student after reading what you’ll see.
                {i.domain_requested && i.domain_requested !== i.email_domain && <> We’ll confirm @{i.domain_requested} before it’s used.</>}
              </span>
            </p>
          ) : i.domain_requested ? (
            <p className="mt-3 flex gap-2.5 text-sm leading-relaxed text-ink-2">
              <Hourglass size={18} className="mt-0.5 flex-none text-sand" />
              <span>
                <strong className="font-semibold text-ink">@{i.domain_requested}</strong> is waiting for Kaivon to confirm it. Until then, students join with a class code or an invite link.
              </span>
            </p>
          ) : (
            <p className="mt-3 flex gap-2.5 text-sm leading-relaxed text-ink-2">
              <MailQuestion size={18} className="mt-0.5 flex-none text-ink-4" />
              <span>No email domain yet. {admin && !asked ? 'Add your students’ email domain and we’ll confirm it.' : 'Students join with a class code or an invite link.'}</span>
            </p>
          )}
        </section>

        <section className="card p-5 sm:p-6" aria-labelledby="plan-title">
          <h2 id="plan-title" className="font-semibold">
            Plan
          </h2>
          <dl className="mt-3 space-y-3 text-sm">
            <Row label="Status" value={status.label} />
            <Row label="Kind" value={`${KIND_LABEL[i.kind]}, ${countryName(i.country)}`} />
            <Row label="Seats" value={i.seats ? `${ov.counts.students.toLocaleString()} of ${i.seats.toLocaleString()} used` : 'Set when we approve it'} />
            {i.plan === 'paid' && i.paid_until && <Row label="Paid until" value={dayText(i.paid_until)} />}
            {i.plan === 'pilot' && i.pilot_ends && <Row label="Pilot ends" value={dayText(i.pilot_ends)} />}
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-ink-3">
            More seats, or ready to carry on after the pilot? Ask us about pricing:{' '}
            <a className="font-semibold text-iris hover:text-iris-2" href={`mailto:${site.email}`}>
              {site.email}
            </a>
          </p>
        </section>

        <section className="card p-5 sm:p-6" aria-labelledby="leave-title">
          <h2 id="leave-title" className="font-semibold">
            Leave {i.name}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-3">
            You’ll stop seeing its dashboard and leave its classes. {admin && ov.counts.admins <= 1 ? 'You’re its only admin, so make someone else an admin first.' : ''}
          </p>
          <button className="btn btn-sm mt-4 border border-rose/30 bg-rose-soft text-[#b8355a] hover:bg-[#fbdbe5]" onClick={() => setLeaving(true)}>
            <LogOut size={15} /> Leave {i.name}
          </button>
        </section>
      </div>

      <Confirm
        open={leaving}
        title={`Leave ${i.name}?`}
        body={`You’ll leave its classes and can’t open its dashboard any more. To come back, you’ll need a new invite.`}
        yes="Leave"
        danger
        onClose={() => setLeaving(false)}
        onYes={async () => {
          try {
            await leaveInstitution(i.id);
            await Promise.all([useInstitutions.getState().load(true), useAuth.getState().refresh()]);
            toast(`You’ve left ${i.name}.`, 'info');
            navigate('/app');
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
