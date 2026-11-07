import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Modal, Spinner } from '../components/ui.tsx';
import { joinClass, peekClass } from '../lib/api.ts';
import { isClassCode, normalizeClassCode } from '../lib/institutions.ts';
import type { ClassPeek } from '../lib/types.ts';
import { useAge } from '../store/age.ts';
import { useAuth } from '../store/auth.ts';
import { useInstitutions } from '../store/institutions.ts';
import { toast } from '../store/toast.ts';
import { ConsentBody } from './Consent.tsx';

/** Joining a class with the code a teacher gave: the code, then (named, with its institution)
 * what joining means, then in. A code that isn't a class, or whose institution isn't open to
 * students, says so before anything else. */
export function JoinClassModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<'code' | 'consent'>('code');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState<ClassPeek | null>(null);
  const clean = normalizeClassCode(code);

  const close = () => {
    onClose();
    setTimeout(() => {
      setStep('code');
      setCode('');
      setError('');
      setPeek(null);
    }, 300);
  };

  const next = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isClassCode(clean)) {
      setError('Class codes are 6 letters and numbers, like K7Q2MD.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const p = await peekClass(clean);
      if (!p.found) setError('No class has that code. Check it with your teacher: it may have been archived.');
      else if (p.member === 'admin' || p.member === 'teacher') setError(`You’re ${p.member === 'admin' ? 'an admin' : 'a teacher'} at ${p.institution}, so you can’t join its classes as a student.`);
      else if (!p.active) setError(`${p.institution} isn’t open to students right now, so its classes can’t be joined. Your teacher can find out why.`);
      else {
        setPeek(p);
        setStep('consent');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setError('');
    if (!(await useAge.getState().ensure())) return;
    setBusy(true);
    try {
      const r = await joinClass(clean);
      await Promise.all([useAuth.getState().refresh(), useInstitutions.getState().load(true)]);
      toast(`You’re in ${r.class}, at ${r.name}. Chip Study Pro is yours while you’re there.`, 'good');
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === 'code' ? 'Join a class' : `Join ${peek?.class ?? 'the class'}?`}
      width={step === 'code' ? 460 : 560}
      footer={
        step === 'code' ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => void next()} disabled={!clean || busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  Next <ArrowRight size={15} />
                </>
              )}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => (setStep('code'), setError(''))}>
              <ArrowLeft size={15} /> Back
            </button>
            <button className="btn btn-iris btn-sm" disabled={busy} onClick={() => void join()}>
              {busy ? <Spinner /> : `Join ${peek?.class ?? 'the class'}`}
            </button>
          </>
        )
      }
    >
      {step === 'code' ? (
        <form onSubmit={(e) => void next(e)}>
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">Type the code your teacher gave you. You’ll see what joining means before you join.</p>
          <label className="label mt-5" htmlFor="class-code">
            Class code
          </label>
          <input
            id="class-code"
            className="field text-center font-mono text-2xl font-semibold uppercase tracking-[0.35em]"
            value={code}
            onChange={(e) => (setCode(e.target.value.toUpperCase().slice(0, 9)), setError(''))}
            placeholder="K7Q2MD"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            data-autofocus
          />
        </form>
      ) : (
        <>
          <p className="mb-4 text-sm font-semibold text-ink-3">
            {peek?.institution} · code <span className="font-mono tracking-[0.15em] text-ink">{clean}</span>
          </p>
          <ConsentBody name={peek?.institution} className={peek?.class} stack />
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
