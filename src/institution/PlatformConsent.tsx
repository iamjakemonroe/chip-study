import { useEffect, useState } from 'react';
import { Modal, Spinner } from '../components/ui.tsx';
import { consentAccept, consentPending, leaveInstitution } from '../lib/api.ts';
import { useAge } from '../store/age.ts';
import { useAuth } from '../store/auth.ts';
import { useInstitutions } from '../store/institutions.ts';
import { toast } from '../store/toast.ts';
import { ConsentBody } from './Consent.tsx';

let checkedFor: string | null = null;

/** Students who arrived from their course's learning platform joined before they could read what
 * the institution sees: it's shown on their first visit, with a way to leave instead. Asked once a
 * session, after the age question. */
export function PlatformConsent() {
  const user = useAuth((s) => s.session?.user.id ?? null);
  const age = useAge((s) => s.answer);
  const askingAge = useAge((s) => s.asking);
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState<'accept' | 'leave' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // After the age question: never while it's unanswered (or still being looked up), or on top of it.
    if (!user || age == null || askingAge || checkedFor === user) return;
    checkedFor = user;
    consentPending()
      .then(setPending)
      .catch(() => (checkedFor = null));
  }, [user, age, askingAge]);

  const first = pending[0];
  const next = () => {
    setPending((p) => p.slice(1));
    setError('');
  };

  return (
    <Modal
      open={!!first && age != null && !askingAge}
      onClose={next}
      title={first ? `What ${first.name} can see` : ''}
      width={560}
      footer={
        first && (
          <>
            <button
              className="btn btn-quiet btn-sm"
              disabled={!!busy}
              onClick={async () => {
                setBusy('leave');
                try {
                  await leaveInstitution(first.id);
                  await Promise.all([useInstitutions.getState().load(true), useAuth.getState().refresh()]);
                  toast(`You’ve left ${first.name}.`, 'info');
                  next();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === 'leave' ? <Spinner /> : `Leave ${first.name}`}
            </button>
            <button
              className="btn btn-iris btn-sm"
              disabled={!!busy}
              onClick={async () => {
                setBusy('accept');
                try {
                  await consentAccept(first.id);
                  next();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === 'accept' ? <Spinner /> : 'I understand'}
            </button>
          </>
        )
      }
    >
      {first && (
        <>
          <p className="mb-4 text-sm font-semibold text-iris">You came in from your course</p>
          <ConsentBody name={first.name} joined stack />
        </>
      )}
      {error && (
        <p className="mt-4 rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
