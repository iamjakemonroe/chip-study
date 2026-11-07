import { EyeOff, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Field, Modal, Segmented, Spinner } from '../components/ui.tsx';
import { classThemesGet, classTutorGet, classTutorSet } from '../lib/api.ts';
import { ChipRefused, makeClassThemes } from '../lib/chip.ts';
import { ago } from '../lib/dates.ts';
import type { ClassThemes, HelpLevel, StudyClass } from '../lib/types.ts';
import { toast } from '../store/toast.ts';

/** How much Chip may help in a class, said the same way to teachers and students. */
export const HELP_LEVELS: { value: HelpLevel; label: string; teacher: string }[] = [
  { value: 'guide', label: 'Guide', teacher: 'Chip’s usual way: it asks what students think, gives hints and the next step, and explains when they’re stuck.' },
  { value: 'explain', label: 'Explain', teacher: 'Chip explains and checks their work, but never drafts text or solutions for anything they hand in.' },
  { value: 'hints', label: 'Hints only', teacher: 'Questions, hints and the next small step only: never a worked solution or text for their work.' },
];

/** A class's course tutor: what the course is, how much Chip may help, and notes for Chip. Students
 * who link an assignment to the class get this version of Chip. */
export function ClassTutorModal({ target, onClose }: { target: StudyClass | null; onClose: () => void }) {
  const [brief, setBrief] = useState('');
  const [level, setLevel] = useState<HelpLevel>('guide');
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) return;
    setLoaded(false);
    setError('');
    classTutorGet(target.id)
      .then((t) => {
        setBrief(t.course_brief);
        setLevel(t.help_level);
        setNotes(t.tutor_notes);
        setLoaded(true);
      })
      .catch((e) => setError((e as Error).message));
  }, [target]);

  const save = async () => {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      await classTutorSet(target.id, { course_brief: brief.trim(), help_level: level, tutor_notes: notes.trim() });
      toast(`Saved. Chip follows it for ${target.name}.`, 'good');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={target ? `Chip for ${target.name}` : ''}
      width={600}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy || !loaded} onClick={() => void save()}>
            {busy ? <Spinner /> : 'Save'}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-3">
        Describe your course and how much Chip may help. Students who link an assignment to this class get this version of Chip, and see that it follows your guidance.
      </p>
      {!loaded && !error ? (
        <div className="h-40">
          <ChipLoader page={false} label="" size={40} />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div>
            <span className="label">How much Chip may help</span>
            <Segmented label="How much Chip may help" value={level} onChange={setLevel} options={HELP_LEVELS.map((h) => ({ value: h.value, label: h.label }))} />
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{HELP_LEVELS.find((h) => h.value === level)?.teacher}</p>
          </div>
          <Field id="tutor-brief" label="About the course" optional hint="What it covers, the level, and anything Chip should teach in your course’s own terms.">
            <textarea id="tutor-brief" className="field min-h-32 resize-y" maxLength={6000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. First-year cell biology. We use Campbell Biology, chapters 6 to 12." />
          </Field>
          <Field id="tutor-notes" label="Notes for Chip" optional hint="How you like things done. These can’t make Chip do students’ work for them.">
            <textarea id="tutor-notes" className="field min-h-24 resize-y" maxLength={3000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Use SI units. Ask students to show each step." />
          </Field>
        </div>
      )}
      {error && (
        <p className="mt-4 rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/** What a class is asking Chip about, as a few anonymous themes: made from the last 14 days of
 * questions in assignments linked to the class, once 5 or more of its students asked. Never
 * anyone's chats, words or names. */
export function ClassThemesModal({ target, onClose }: { target: StudyClass | null; onClose: () => void }) {
  const [themes, setThemes] = useState<ClassThemes | null | undefined>(undefined);
  const [notEnough, setNotEnough] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) return;
    setThemes(undefined);
    setNotEnough(null);
    setError('');
    classThemesGet(target.id)
      .then(setThemes)
      .catch((e) => setError((e as Error).message));
  }, [target]);

  const make = async () => {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      const r = await makeClassThemes(target.id);
      if (!r.enough) setNotEnough(r.students);
      else {
        setNotEnough(null);
        setThemes({ generated_at: r.generated_at, students: r.students, questions: r.questions, themes: r.themes });
      }
    } catch (e) {
      setError(e instanceof ChipRefused ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!target} onClose={onClose} title={target ? `What ${target.name} is asking` : ''} width={620}>
      <p className="flex gap-2.5 rounded-2xl bg-paper px-4 py-3 text-sm leading-relaxed text-ink-2">
        <EyeOff size={17} className="mt-0.5 flex-none text-ink-3" />
        <span>Themes from the questions students in this class asked Chip about its assignments in the last 14 days, with no names and no quotes. You never see anyone’s chats or questions, and themes only appear once 5 or more students have asked.</span>
      </p>
      {themes === undefined && !error ? (
        <div className="h-40">
          <ChipLoader page={false} label="" size={40} />
        </div>
      ) : (
        <>
          {notEnough !== null && (
            <p className="mt-5 rounded-2xl bg-sand-soft px-4 py-3 text-sm leading-relaxed text-[#7a5d18]">
              Not enough yet: {notEnough === 0 ? 'no students have' : notEnough === 1 ? '1 student has' : `${notEnough} students have`} asked Chip about this class’s assignments in the last 14 days. Themes appear once 5 or more have. Students link an assignment to the class from its Brief.
            </p>
          )}
          {themes ? (
            <>
              <p className="mt-5 text-sm text-ink-3">
                Made {ago(themes.generated_at)} from {themes.questions.toLocaleString()} question{themes.questions === 1 ? '' : 's'} by {themes.students.toLocaleString()} students
              </p>
              <ol className="mt-3 space-y-3">
                {themes.themes.map((t) => (
                  <li key={t.title} className="rounded-2xl border border-line p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 className="font-semibold leading-snug">{t.title}</h3>
                      <span className="text-xs font-medium text-ink-3">about {t.questions.toLocaleString()} question{t.questions === 1 ? '' : 's'}</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{t.detail}</p>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            notEnough === null && <p className="mt-5 text-sm leading-relaxed text-ink-3">No themes yet. Chip can look at what the class has been asking: it takes a moment, and uses a little of your Chip time.</p>
          )}
          {error && (
            <p className="mt-4 rounded-2xl bg-rose-soft px-4 py-3 text-sm text-[#b8355a]" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary btn-sm mt-5" disabled={busy} onClick={() => void make()}>
            {busy ? (
              <>
                <Spinner /> Looking at the class
              </>
            ) : themes ? (
              <>
                <RefreshCw size={15} /> Look again
              </>
            ) : (
              <>
                <Sparkles size={15} /> See what they’re asking
              </>
            )}
          </button>
        </>
      )}
    </Modal>
  );
}
