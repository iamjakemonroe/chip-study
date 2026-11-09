import { Copy, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Confirm, Field, Modal, Segmented, Spinner } from '../components/ui.tsx';
import { copyText } from '../institution/copy.ts';
import { institutionInvoices, staffInvoiceCreate, staffInvoiceVoid, staffReps, staffSetRep } from '../lib/api.ts';
import { currencyForCountry, formatMoney, type Currency } from '../lib/currency.ts';
import { dayText } from '../lib/institutions.ts';
import { formatPrice, INVOICE_CURRENCIES, invoiceAmount } from '../lib/institutionPrice.ts';
import { useInstitutionPrices } from '../institution/usePrices.ts';
import { referralLink } from '../lib/referral.ts';
import type { Invoice, StaffInstitution, StaffRep } from '../lib/types.ts';
import { toast } from '../store/toast.ts';

const CURRENCY_LABEL: Record<Currency, string> = { GBP: '£', USD: 'US$', NGN: '₦' };

/** An institution's invoices, for Kaivon staff: issue one (seats, months, currency and amount, as
 * agreed with the institution) or cancel an open one. Its admins pay it in Chip Study. */
export function InvoicesModal({ inst, onClose }: { inst: StaffInstitution | null; onClose: () => void }) {
  const [list, setList] = useState<Invoice[] | null>(null);
  const [form, setForm] = useState({ label: '', seats: '', months: '12', currency: 'USD' as Currency, amount: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  // The amount follows the price (seats × the yearly price × months ÷ 12) until staff change it.
  const prices = useInstitutionPrices();
  const [typed, setTyped] = useState(false);
  const price = prices?.[form.currency];
  const suggested = invoiceAmount(Number(form.seats), Number(form.months), price, form.currency);
  useEffect(() => {
    if (!typed && suggested !== null) setForm((f) => ({ ...f, amount: String(suggested) }));
  }, [suggested, typed]);

  const load = useCallback(async (id: string) => {
    try {
      setList(await institutionInvoices(id));
    } catch (e) {
      setError((e as Error).message);
      setList([]);
    }
  }, []);

  useEffect(() => {
    if (!inst) return;
    setList(null);
    setError('');
    // In the institution's own currency (its country's, by the same rule as every price), which staff can change.
    setForm({ label: `${inst.name}: Chip Study seats`, seats: String(inst.seats || 50), months: '12', currency: currencyForCountry(inst.country) ?? 'USD', amount: '' });
    setTyped(false);
    void load(inst.id);
  }, [inst, load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inst) return;
    const seats = Number(form.seats);
    const months = Number(form.months);
    const amount = Number(form.amount.replace(/,/g, ''));
    if (!form.label.trim()) return setError('Add a label for the invoice.');
    if (!Number.isInteger(seats) || seats < 1) return setError('Seats is a whole number, 1 or more.');
    if (!Number.isInteger(months) || months < 1 || months > 36) return setError('Months is from 1 to 36.');
    if (!(amount >= 1)) return setError('The amount is at least 1.');
    setBusy(true);
    setError('');
    try {
      await staffInvoiceCreate(inst.id, { label: form.label.trim(), seats, months, currency: form.currency, amount });
      toast(`Invoice made for ${formatMoney(amount, form.currency)}. Its admins can pay it in Chip Study.`, 'good');
      setTyped(false);
      await load(inst.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!inst} onClose={onClose} title={inst ? `Invoices for ${inst.name}` : ''} width={600}>
      {list === null ? (
        <div className="h-28">
          <ChipLoader page={false} label="" size={40} />
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-3">No invoices yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {list.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block font-semibold">{v.label}</span>
                <span className="block text-xs text-ink-3">
                  {v.seats.toLocaleString()} seats · {v.months} months · {formatMoney(v.amount, v.currency)} · made {dayText(v.created_at)}
                </span>
              </span>
              {v.status === 'open' ? (
                <button className="btn btn-quiet btn-sm" onClick={() => setVoiding(v)}>
                  Cancel invoice
                </button>
              ) : (
                <span className={`chip-tag ${v.status === 'paid' ? 'bg-mint-soft text-[#16795f]' : 'bg-paper-2 text-ink-3'}`}>{v.status === 'paid' ? `Paid ${v.paid_at ? dayText(v.paid_at) : ''}` : 'Cancelled'}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="mt-6 space-y-4 border-t border-line pt-5" onSubmit={create} noValidate>
        <h3 className="font-semibold">New invoice</h3>
        <Field id="inv-label" label="Label">
          <input id="inv-label" className="field" maxLength={160} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="inv-seats" label="Seats">
            <input id="inv-seats" className="field" inputMode="numeric" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field id="inv-months" label="Months">
            <input id="inv-months" className="field" inputMode="numeric" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </div>
        <div className="grid grid-cols-[auto_1fr] items-start gap-4">
          <div>
            <span className="label">Currency</span>
            <div className="flex h-[2.875rem] items-center">
              <Segmented label="Currency" size="sm" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} options={INVOICE_CURRENCIES.map((c) => ({ value: c, label: CURRENCY_LABEL[c] }))} />
            </div>
          </div>
          <Field id="inv-amount" label="Amount">
            <input
              id="inv-amount"
              className="field"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => (setTyped(true), setForm({ ...form, amount: e.target.value.replace(/[^\d.,]/g, '') }))}
              placeholder="As agreed"
            />
          </Field>
        </div>
        {price && (
          <p className="text-xs leading-relaxed text-ink-3">
            At {formatPrice(price.per_student_year, form.currency)} per student per year, from {price.min_students} students: {Math.max(Number(form.seats) || 0, price.min_students).toLocaleString()} × {formatPrice(price.per_student_year, form.currency)} × {form.months || 0}/12.{' '}
            {typed && suggested !== null && (
              <button type="button" className="font-semibold text-iris hover:text-iris-2" onClick={() => setTyped(false)}>
                Use {formatPrice(suggested, form.currency)}
              </button>
            )}
          </p>
        )}
        <p className="text-xs leading-relaxed text-ink-3">Once it’s paid in full, the institution moves to paid seats: at least this many, for this many months from today or from its current paid date.</p>
        {error && (
          <p className="rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? <Spinner /> : 'Make the invoice'}
        </button>
      </form>
      <Confirm
        open={!!voiding}
        title="Cancel this invoice?"
        body={`${voiding?.label ?? ''} for ${voiding ? formatMoney(voiding.amount, voiding.currency) : ''} can’t be paid after this.`}
        yes="Cancel invoice"
        danger
        onClose={() => setVoiding(null)}
        onYes={async () => {
          if (!voiding || !inst) return;
          try {
            await staffInvoiceVoid(voiding.id);
            toast('Cancelled.', 'info');
            await load(inst.id);
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
    </Modal>
  );
}

/** Campus reps: people with a named invite link, and how their sign-ups are going. */
export function RepsPanel() {
  const [reps, setReps] = useState<StaffRep[] | null>(null);
  const [who, setWho] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState<StaffRep | null>(null);

  const load = useCallback(async () => {
    try {
      setReps(await staffReps());
    } catch (e) {
      setError((e as Error).message);
      setReps([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!who.trim() || !name.trim()) return setError('Add who it is and the name to show.');
    setBusy(true);
    setError('');
    try {
      const r = await staffSetRep(who.trim(), name.trim());
      toast(`${name.trim()} is a campus rep. Their link: ${referralLink(r.code)}`, 'good');
      setWho('');
      setName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-5">
      <form className="card grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:p-6" onSubmit={add} noValidate>
        <Field id="rep-who" label="Who" hint="Their email, username or account ID.">
          <input id="rep-who" className="field" value={who} onChange={(e) => setWho(e.target.value)} autoCapitalize="none" spellCheck={false} />
        </Field>
        <Field id="rep-name" label="Name to show" hint="Like “Ada, UNILAG”.">
          <input id="rep-name" className="field" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button className="btn btn-primary sm:mb-[1.6rem]" disabled={busy}>
          {busy ? (
            <Spinner />
          ) : (
            <>
              <UserPlus size={16} /> Make a rep
            </>
          )}
        </button>
        {error && (
          <p className="rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a] sm:col-span-3" role="alert">
            {error}
          </p>
        )}
      </form>

      {reps === null ? (
        <div className="h-40">
          <ChipLoader page={false} label="Loading reps" />
        </div>
      ) : reps.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-line-2 bg-white/50 px-6 py-12 text-center">
          <p className="font-semibold">No campus reps yet</p>
          <p className="mt-1 text-sm text-ink-3">A rep gets a named invite link; their sign-ups are counted here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reps.map((r) => (
            <li key={r.user_id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold">{r.name}</h2>
                  <p className="break-all text-sm text-ink-3">
                    {r.email ?? 'No email'} · rep since {r.since ? dayText(r.since) : '–'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => void copyText(referralLink(r.code), 'Copied their link.')}>
                    <Copy size={14} /> Copy link
                  </button>
                  <button className="btn btn-quiet btn-sm" onClick={() => setStopping(r)}>
                    Stop
                  </button>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ['Sign-ups', r.signups],
                  ['Last 7 days', r.signups_7d],
                  ['Last 30 days', r.signups_30d],
                  ['Really used it', r.active],
                ].map(([label, n]) => (
                  <div key={label as string} className="rounded-xl bg-paper px-3 py-2">
                    <dt className="text-xs text-ink-3">{label}</dt>
                    <dd className="text-lg font-semibold">{(n as number).toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 font-mono text-xs text-ink-3">Code {r.code}</p>
            </li>
          ))}
        </ul>
      )}
      <Confirm
        open={!!stopping}
        title={`Stop ${stopping?.name ?? ''} being a rep?`}
        body="Their link keeps working as an ordinary invite link, and the people who joined through it stay counted for them."
        yes="Stop"
        onClose={() => setStopping(null)}
        onYes={async () => {
          if (!stopping) return;
          try {
            await staffSetRep(stopping.user_id, '');
            toast('Stopped.', 'info');
            await load();
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
    </div>
  );
}
