import { Copy, CreditCard, Link2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Confirm, Field, Segmented, Spinner } from '../components/ui.tsx';
import { BLACKBOARD_APP_ID, checkPlatform, ltiAddresses, PLATFORM_HELP, PLATFORM_LABEL, PRESETS, type PlatformFields, type PlatformKind } from '../content/platforms.ts';
import { site } from '../content/site.ts';
import { institutionInvoices, ltiPlatformRemove, ltiPlatforms, ltiPlatformSet, payInvoice, setInstitutionMinors } from '../lib/api.ts';
import { formatMoney } from '../lib/currency.ts';
import { dayText } from '../lib/institutions.ts';
import { SUPABASE_URL } from '../lib/supabase.ts';
import type { InstitutionDetails, Invoice, LtiPlatform } from '../lib/types.ts';
import { toast } from '../store/toast.ts';
import { copyText } from './copy.ts';

/** Whether students under 18 will join (with their parents' or guardians' consent). A school's is
 * always on. The server doesn't send the current setting to admins yet, so until it does, neither
 * choice shows as picked until one is saved here. */
export function MinorsSetting({ inst }: { inst: InstitutionDetails }) {
  const school = inst.kind === 'school';
  const [value, setValue] = useState<boolean | undefined>(school ? true : inst.minors_consent);
  const [busy, setBusy] = useState(false);

  const save = async (minors: boolean) => {
    if (minors === value) return;
    setBusy(true);
    try {
      await setInstitutionMinors(inst.id, minors);
      setValue(minors);
      toast(minors ? 'Saved: students under 18 can join.' : 'Saved: adults only.', 'good');
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="minors-title">
      <h2 id="minors-title" className="font-semibold">
        Students under 18
      </h2>
      {school ? (
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          On, as for every school: students under 18 can join, and you’ve confirmed you have their parents’ or guardians’ consent for them to use Chip Study.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">Students under 18 can join only if you say they will. Turning this on confirms you have their parents’ or guardians’ consent for them to use Chip Study.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Segmented
              label="Students under 18"
              size="sm"
              value={value === undefined ? ('' as 'on') : value ? 'on' : 'off'}
              onChange={(v) => void save(v === 'on')}
              options={[
                { value: 'off', label: 'Adults only' },
                { value: 'on', label: 'Under 18s too' },
              ]}
            />
            {busy && <Spinner size={14} />}
          </div>
          {value === undefined && <p className="mt-2 text-xs text-ink-3">Pick one to set it.</p>}
        </>
      )}
    </section>
  );
}

const blank = (kind: PlatformKind): PlatformFields => ({ name: '', issuer: '', client_id: '', deployment_id: '', auth_url: '', jwks_url: '', ...PRESETS[kind] });

/** Connecting Moodle, Canvas, Blackboard or Brightspace (LTI 1.3): the addresses to give the
 * platform, the platforms connected (with how many courses each has made), and adding one, with
 * short help for each and what's known filled in. */
export function PlatformsSetting({ inst }: { inst: InstitutionDetails }) {
  const [list, setList] = useState<LtiPlatform[] | null>(null);
  const [kind, setKind] = useState<PlatformKind>('moodle');
  const [form, setForm] = useState<PlatformFields>(() => blank('moodle'));
  const [errors, setErrors] = useState<Partial<Record<keyof PlatformFields | 'form', string>>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<LtiPlatform | null>(null);
  const addresses = ltiAddresses(SUPABASE_URL);

  const load = useCallback(async () => {
    try {
      setList(await ltiPlatforms(inst.id));
    } catch {
      setList((l) => l ?? []);
    }
  }, [inst.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const pick = (k: PlatformKind) => {
    setKind(k);
    setForm(blank(k));
    setErrors({});
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = checkPlatform(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await ltiPlatformSet(inst.id, { ...form, name: form.name.trim() || PLATFORM_LABEL[kind] });
      toast('Connected. Lecturers can add Chip Study to their courses now.', 'good');
      setForm(blank(kind));
      await load();
    } catch (err) {
      setErrors({ form: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof PlatformFields, label: string, hint?: string) => (
    <Field id={`lti-${key}`} label={label} error={errors[key]} hint={hint}>
      <input
        id={`lti-${key}`}
        className="field font-mono text-[0.8125rem]"
        value={form[key]}
        spellCheck={false}
        autoCapitalize="none"
        onChange={(e) => (setForm({ ...form, [key]: e.target.value }), setErrors({ ...errors, [key]: undefined }))}
      />
    </Field>
  );

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="lti-title">
      <h2 id="lti-title" className="flex items-center gap-2 font-semibold">
        <Link2 size={17} className="text-iris" /> Learning platform
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-3">
        Put Chip Study in Moodle, Canvas, Blackboard or Brightspace (LTI 1.3). Lecturers add it to a course, and students open it from there, signed in and in a class for that course. They see what you can see the first time they arrive.
      </p>

      {!inst.active ? (
        <p className="mt-4 rounded-2xl bg-sand-soft px-4 py-3 text-sm text-[#7a5d18]">You can connect a platform once {inst.name} is approved and active.</p>
      ) : (
        <>
          <h3 className="mt-5 text-sm font-semibold text-ink-2">1. Give your platform these addresses</h3>
          <ul className="mt-2 space-y-2">
            {addresses.map((a) => (
              <li key={a.key} className="flex items-center gap-2 rounded-2xl bg-paper px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink-3">{a.label}</span>
                  <code className="block truncate font-mono text-xs text-ink">{a.url}</code>
                </span>
                <button className="icon-btn flex-none" aria-label={`Copy the ${a.label.split(' (')[0].toLowerCase()} address`} title="Copy" onClick={() => void copyText(a.url, 'Copied.')}>
                  <Copy size={15} />
                </button>
              </li>
            ))}
          </ul>

          <h3 className="mt-6 text-sm font-semibold text-ink-2">2. Tell Chip Study about it</h3>
          <div className="no-scrollbar mt-2 max-w-full overflow-x-auto">
            <Segmented label="Platform" size="sm" value={kind} onChange={pick} options={(Object.keys(PLATFORM_LABEL) as PlatformKind[]).map((k) => ({ value: k, label: k === 'other' ? 'Other' : PLATFORM_LABEL[k] }))} />
          </div>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2 marker:text-ink-4">
            {PLATFORM_HELP[kind].map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {kind === 'blackboard' && (
            <div className="mt-3 flex items-center gap-2 rounded-2xl border border-iris/20 bg-iris-soft/50 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-iris-2">Chip Study’s Application ID</span>
                <code className="block truncate font-mono text-xs text-ink">{BLACKBOARD_APP_ID}</code>
              </span>
              <button className="btn btn-ghost btn-sm flex-none" onClick={() => void copyText(BLACKBOARD_APP_ID, 'Copied the Application ID.')}>
                <Copy size={14} /> Copy
              </button>
            </div>
          )}

          <form className="mt-5 space-y-4" onSubmit={add} noValidate>
            <Field id="lti-name" label="Name" optional>
              <input id="lti-name" className="field" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={PLATFORM_LABEL[kind]} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('issuer', 'Issuer (platform ID)')}
              {field('client_id', 'Client ID')}
              {field('deployment_id', 'Deployment ID')}
              {field('auth_url', 'Authentication request URL')}
            </div>
            {field('jwks_url', 'Keyset URL')}
            {errors.form && (
              <p className="rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
                {errors.form}
              </p>
            )}
            <button className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  <Plus size={15} /> Connect {PLATFORM_LABEL[kind] === 'Another platform' ? 'it' : PLATFORM_LABEL[kind]}
                </>
              )}
            </button>
          </form>
        </>
      )}

      <h3 className="mt-6 text-sm font-semibold text-ink-2">Connected</h3>
      {list === null ? (
        <div className="skeleton mt-2 h-14" />
      ) : list.length === 0 ? (
        <p className="mt-1 text-sm text-ink-3">None yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-2xl border border-line">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 basis-56">
                <span className="block font-semibold">{p.name || 'Learning platform'}</span>
                <span className="block truncate text-xs text-ink-3">
                  {p.issuer} · deployment {p.deployment_id}
                </span>
                <span className="block text-xs text-ink-3">
                  {p.courses === 1 ? '1 course' : `${p.courses.toLocaleString()} courses`} · added {dayText(p.created_at)}
                </span>
              </span>
              <button className="btn btn-quiet btn-sm flex-none" onClick={() => setRemoving(p)}>
                <Trash2 size={14} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <Confirm
        open={!!removing}
        title={`Remove ${removing?.name || 'this platform'}?`}
        body="Opening Chip Study from it stops working. The classes it made, and everyone in them, stay in Chip Study."
        yes="Remove"
        danger
        onClose={() => setRemoving(null)}
        onYes={async () => {
          if (!removing) return;
          try {
            await ltiPlatformRemove(removing.id);
            toast('Removed.', 'info');
            await load();
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
    </section>
  );
}

/** The institution's invoices from Kaivon, and paying an open one through Flutterwave's checkout
 * (it comes back to this page, which confirms the payment). */
export function InvoicesSetting({ inst, reloadKey }: { inst: InstitutionDetails; reloadKey: string }) {
  const [list, setList] = useState<Invoice[] | null>(null);
  const [paying, setPaying] = useState<string | null>(null);

  useEffect(() => {
    institutionInvoices(inst.id)
      .then(setList)
      .catch(() => setList([]));
  }, [inst.id, reloadKey]);

  if (list !== null && list.length === 0) return null;

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="invoices-title">
      <h2 id="invoices-title" className="flex items-center gap-2 font-semibold">
        <CreditCard size={17} className="text-iris" /> Invoices
      </h2>
      {list === null ? (
        <div className="skeleton mt-3 h-14" />
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
          {list.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block font-semibold">{v.label}</span>
                <span className="block text-xs text-ink-3">
                  {v.seats.toLocaleString()} seats for {v.months === 1 ? '1 month' : `${v.months} months`} · {formatMoney(v.amount, v.currency)}
                </span>
              </span>
              {v.status === 'open' ? (
                <button
                  className="btn btn-iris btn-sm flex-none"
                  disabled={!!paying}
                  onClick={async () => {
                    setPaying(v.id);
                    try {
                      location.href = await payInvoice(v.id);
                    } catch (e) {
                      toast((e as Error).message, 'warn');
                      setPaying(null);
                    }
                  }}
                >
                  {paying === v.id ? <Spinner /> : `Pay ${formatMoney(v.amount, v.currency)}`}
                </button>
              ) : (
                <span className={`chip-tag flex-none ${v.status === 'paid' ? 'bg-mint-soft text-[#16795f]' : 'bg-paper-2 text-ink-3'}`}>
                  {v.status === 'paid' ? `Paid ${v.paid_at ? dayText(v.paid_at) : ''}` : 'Cancelled'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs leading-relaxed text-ink-3">Payments by Flutterwave. Questions about an invoice? {site.email}</p>
    </section>
  );
}
