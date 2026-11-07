import { ArrowRight, Building2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Orb } from '../components/Orb.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { Field, Segmented, Spinner } from '../components/ui.tsx';
import { site } from '../content/site.ts';
import { registerInstitution } from '../lib/api.ts';
import { cleanDomain, cleanWebsite, countryOptions, guessCountry, isDomain, isPublicDomain, KIND_LABEL } from '../lib/institutions.ts';
import type { InstitutionKind } from '../lib/types.ts';
import { useAuth } from '../store/auth.ts';
import { useInstitutions } from '../store/institutions.ts';

interface Form {
  name: string;
  kind: InstitutionKind;
  country: string;
  website: string;
  domain: string;
  contactName: string;
  contactRole: string;
  students: string;
  minors: boolean;
}

/** Registering a school, college or university. It waits for Kaivon to check it; meanwhile its
 * first admin (whoever registered it) can set up classes and invite teachers. */
export function InstitutionNew() {
  const email = useAuth((s) => s.session?.user.email ?? '');
  const me = useAuth((s) => s.me);
  const mine = useInstitutions((s) => s.mine);
  const countries = useMemo(countryOptions, []);
  const [form, setForm] = useState<Form>(() => ({
    name: '',
    kind: 'university',
    country: guessCountry(),
    website: '',
    domain: '',
    contactName: me?.name ?? '',
    contactRole: '',
    students: '',
    minors: false,
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof Form | 'form', string>>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    document.title = 'Register your institution · Chip Study';
    void useInstitutions.getState().load();
  }, []);
  // The account's name arrives a moment after the form: it's the first guess at the contact's.
  useEffect(() => {
    if (me?.name) setForm((f) => (f.contactName ? f : { ...f, contactName: me.name! }));
  }, [me?.name]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };

  const waiting = (mine ?? []).filter((m) => m.role === 'admin' && m.status === 'pending');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const domain = cleanDomain(form.domain);
    const students = form.students ? Number(form.students.replace(/\D/g, '')) : null;
    const found: typeof errors = {};
    if (form.name.trim().length < 2) found.name = 'Add the institution’s name.';
    if (!form.country) found.country = 'Pick the country it’s in.';
    if (domain && !isDomain(domain)) found.domain = 'That doesn’t look like an email domain. It’s the part after the @, like unilag.edu.ng.';
    else if (domain && isPublicDomain(domain)) found.domain = 'That’s a public email domain. Use the institution’s own, or leave it empty.';
    if (students !== null && (!students || students > 2_000_000)) found.students = 'A number from 1 to 2,000,000, or leave it empty.';
    if (form.kind === 'school' && !form.minors) found.minors = 'Schools confirm this before students under 18 can join.';
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`inst-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const id = await registerInstitution({
        name: form.name.trim(),
        kind: form.kind,
        country: form.country,
        website: cleanWebsite(form.website),
        domain,
        contactName: form.contactName.trim(),
        contactRole: form.contactRole.trim(),
        students,
        minorsConsent: form.minors,
      });
      setSent({ id, name: form.name.trim() });
      window.scrollTo({ top: 0 });
      void useInstitutions.getState().load(true);
    } catch (err) {
      setErrors({ form: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        {sent ? (
          <section className="card relative overflow-hidden px-6 py-10 text-center sm:px-10" aria-live="polite">
            <span className="glow-spot pointer-events-none absolute -right-20 -top-20 h-64 w-64" style={{ ['--glow' as string]: 'var(--color-iris-soft)' }} aria-hidden="true" />
            <Orb size={56} className="relative mx-auto" />
            <h1 className="relative mt-5 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">Thanks. We’re checking {sent.name}.</h1>
            <p className="relative mx-auto mt-3 max-w-md leading-relaxed text-ink-2">
              Kaivon checks every institution before students can join. We’ll write to <strong className="break-all font-semibold text-ink">{email}</strong> once it’s done, to set up your free pilot.
            </p>
            <p className="relative mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-3">While you wait, you can open its dashboard, make classes and invite other teachers and admins.</p>
            <div className="relative mt-7 flex flex-wrap justify-center gap-2">
              <Link to={`/app/institution/${sent.id}`} className="btn btn-primary">
                Open the dashboard <ArrowRight size={16} />
              </Link>
              <Link to="/app" className="btn btn-ghost">
                Back to my desk
              </Link>
            </div>
          </section>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm font-semibold text-iris">
              <Building2 size={16} /> For schools, colleges and universities
            </p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-[-0.025em]">Register your institution</h1>
            <p className="mt-2 leading-relaxed text-ink-2">
              Kaivon checks each institution, then sets up a free pilot for your students. You’ll be its first admin.{' '}
              <Link to="/institutions" className="font-semibold text-iris hover:text-iris-2">
                What you get
              </Link>
            </p>

            {waiting.length > 0 && (
              <div className="mt-6 rounded-2xl bg-sand-soft px-4 py-3 text-sm leading-relaxed text-[#7a5d18]">
                {waiting.length === 1 ? (
                  <>
                    You’ve already registered <strong className="font-semibold">{waiting[0].name}</strong>, and it’s waiting for us to check it.{' '}
                    <Link to={`/app/institution/${waiting[0].id}`} className="font-semibold underline underline-offset-2">
                      Open it
                    </Link>
                  </>
                ) : (
                  <>You have {waiting.length} institutions waiting for us to check them. Find them in Settings.</>
                )}
              </div>
            )}

            <form className="card mt-6 space-y-5 p-5 sm:p-7" onSubmit={submit} noValidate>
              <Field id="inst-name" label="Name" error={errors.name}>
                <input id="inst-name" className="field" value={form.name} maxLength={160} onChange={(e) => set('name', e.target.value)} placeholder="e.g. University of Lagos" autoComplete="organization" />
              </Field>
              <div>
                <span className="label">It’s a</span>
                <Segmented label="Kind of institution" value={form.kind} onChange={(v) => set('kind', v)} options={(['university', 'college', 'school', 'other'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
              </div>
              <Field id="inst-country" label="Country" error={errors.country}>
                <select id="inst-country" className="field" value={form.country} onChange={(e) => set('country', e.target.value)}>
                  <option value="">Pick a country</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="inst-website" label="Website" optional>
                <input
                  id="inst-website"
                  className="field"
                  value={form.website}
                  maxLength={300}
                  inputMode="url"
                  autoComplete="url"
                  onChange={(e) => set('website', e.target.value)}
                  onBlur={() => {
                    if (!form.domain && form.website.trim()) {
                      const d = cleanDomain(form.website);
                      if (isDomain(d)) set('domain', d);
                    }
                  }}
                  placeholder="e.g. unilag.edu.ng"
                />
              </Field>
              <Field
                id="inst-domain"
                label="Students’ email domain"
                optional
                error={errors.domain}
                hint="The part after the @ in your students’ school emails. Once we’ve confirmed it, anyone with one can join as a student. Leave it empty if they don’t have school emails."
              >
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4">@</span>
                  <input id="inst-domain" className="field pl-8" value={form.domain} maxLength={120} onChange={(e) => set('domain', e.target.value)} placeholder="unilag.edu.ng" autoCapitalize="none" spellCheck={false} />
                </div>
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="inst-contactName" label="Your name">
                  <input id="inst-contactName" className="field" value={form.contactName} maxLength={120} onChange={(e) => set('contactName', e.target.value)} autoComplete="name" />
                </Field>
                <Field id="inst-contactRole" label="Your role there">
                  <input id="inst-contactRole" className="field" value={form.contactRole} maxLength={120} onChange={(e) => set('contactRole', e.target.value)} placeholder="e.g. Head of digital learning" autoComplete="organization-title" />
                </Field>
              </div>
              <Field id="inst-students" label="About how many students" optional error={errors.students}>
                <input id="inst-students" className="field sm:max-w-[14rem]" value={form.students} inputMode="numeric" onChange={(e) => set('students', e.target.value.replace(/[^\d,]/g, ''))} placeholder="e.g. 1,200" />
              </Field>
              <div>
                <label className="flex cursor-pointer gap-3 rounded-2xl border border-line bg-paper/60 px-4 py-3">
                  <input
                    id="inst-minors"
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-iris)]"
                    checked={form.minors}
                    onChange={(e) => set('minors', e.target.checked)}
                  />
                  <span className="text-sm leading-relaxed text-ink-2">
                    <span className="block font-semibold text-ink">Students under 18 will join{form.kind === 'school' ? '' : ' (optional)'}</span>
                    We have their parents’ or guardians’ consent for them to use Chip Study. It’s for students 13 and over.
                  </span>
                </label>
                {errors.minors && (
                  <p className="mt-1.5 text-sm text-rose" role="alert">
                    {errors.minors}
                  </p>
                )}
              </div>
              <p className="text-sm leading-relaxed text-ink-3">
                We’ll write to <strong className="break-all font-semibold text-ink-2">{email}</strong> about it. Questions first? {site.email}
              </p>
              {errors.form && (
                <p className="rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
                  {errors.form}
                </p>
              )}
              <button className="btn btn-primary w-full sm:w-auto" disabled={busy}>
                {busy ? <Spinner /> : 'Send for checking'}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
