import { Brain, ClipboardCheck, GraduationCap, Lightbulb } from 'lucide-react';
import { useEffect, useState } from 'react';
import { myClasses, setAssignmentClass, updateAssignment } from '../../lib/api.ts';
import { COLOR_ORDER, COLORS } from '../../lib/colors.ts';
import { dueAtFrom, toDay } from '../../lib/dates.ts';
import type { Assignment, MyClass } from '../../lib/types.ts';
import { toast } from '../../store/toast.ts';
import { loadTutor, useWorkspace } from '../store.ts';

const time = (iso: string | null) => {
  if (!iso) return '23:59';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The brief and rubric, and the assignment's details, kept as you edit them. */
export function BriefPanel({ onAsk }: { onAsk: (mode: 'explain' | 'check' | 'quiz', text: string) => void }) {
  const a = useWorkspace((s) => s.assignment)!;
  const topic = a.kind === 'topic';
  const [draft, setDraft] = useState({
    title: a.title,
    course: a.course,
    brief: a.brief,
    rubric: a.rubric,
    day: a.due_at ? toDay(new Date(a.due_at)) : '',
    time: time(a.due_at),
    target: a.word_target ? String(a.word_target) : '',
  });
  useEffect(() => {
    setDraft({ title: a.title, course: a.course, brief: a.brief, rubric: a.rubric, day: a.due_at ? toDay(new Date(a.due_at)) : '', time: time(a.due_at), target: a.word_target ? String(a.word_target) : '' });
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Partial<Pick<Assignment, 'title' | 'course' | 'brief' | 'rubric' | 'due_at' | 'word_target' | 'color'>>) => {
    const before = useWorkspace.getState().assignment!;
    if (Object.entries(patch).every(([k, v]) => before[k as keyof Assignment] === v)) return;
    useWorkspace.setState({ assignment: { ...before, ...patch } });
    try {
      const next = await updateAssignment(a.id, patch);
      useWorkspace.setState({ assignment: next });
    } catch (e) {
      useWorkspace.setState({ assignment: before });
      toast((e as Error).message, 'warn');
    }
  };

  return (
    <div className="scroll-soft h-full overflow-y-auto px-4 py-4">
      <div className="flex flex-wrap gap-2">
        {topic ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => onAsk('explain', 'Give me the big picture of this: the key ideas and how they connect, step by step.')}>
              <Lightbulb size={15} className="text-sand" /> The big picture
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onAsk('quiz', 'Quiz me to see what I already know about this.')}>
              <Brain size={15} className="text-lilac" /> What do I know already?
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => onAsk('explain', 'Explain this brief in plain words: what it’s really asking, what a great answer does, and the traps to avoid.')}>
              <Lightbulb size={15} className="text-sand" /> Explain the brief
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onAsk('check', 'Check my document against the rubric.')} disabled={!a.rubric.trim()}>
              <ClipboardCheck size={15} className="text-mint" /> Check against the rubric
            </button>
          </>
        )}
      </div>

      <label className="label mt-5" htmlFor="b-title">
        {topic ? 'What you’re learning' : 'Title'}
      </label>
      <input id="b-title" className="field" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onBlur={() => draft.title.trim() && void save({ title: draft.title.trim() })} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="b-course">
            Course
          </label>
          <input id="b-course" className="field" value={draft.course} onChange={(e) => setDraft({ ...draft, course: e.target.value })} onBlur={() => void save({ course: draft.course.trim() })} />
        </div>
        <div className={topic ? 'hidden' : ''}>
          <label className="label" htmlFor="b-target">
            Word target
          </label>
          <input
            id="b-target"
            className="field"
            inputMode="numeric"
            value={draft.target}
            onChange={(e) => setDraft({ ...draft, target: e.target.value.replace(/\D/g, '') })}
            onBlur={() => void save({ word_target: Number(draft.target) > 0 ? Math.min(200000, Number(draft.target)) : null })}
          />
        </div>
        <div>
          <label className="label" htmlFor="b-day">
            {topic ? 'Learn it by' : 'Due'}
          </label>
          <input id="b-day" type="date" className="field" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} onBlur={() => void save({ due_at: dueAtFrom(draft.day, draft.time) })} />
        </div>
        <div className={topic ? 'hidden' : ''}>
          <label className="label" htmlFor="b-time">
            Time
          </label>
          <input id="b-time" type="time" className="field" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} onBlur={() => void save({ due_at: dueAtFrom(draft.day, draft.time) })} />
        </div>
      </div>
      <ClassLink />
      <div className="mt-3 flex items-center gap-2">
        <span className="label mb-0 mr-1">Colour</span>
        {COLOR_ORDER.map((c) => (
          <button
            key={c}
            aria-label={COLORS[c].name}
            aria-pressed={a.color === c}
            onClick={() => void save({ color: c })}
            className={`h-5 w-5 rounded-full ${a.color === c ? 'ring-2 ring-offset-2' : ''}`}
            style={{ background: COLORS[c].ink, ['--tw-ring-color' as string]: COLORS[c].ink }}
          />
        ))}
      </div>

      <label className="label mt-5" htmlFor="b-brief">
        {topic ? 'What you want to be able to do' : 'Brief'}
      </label>
      <textarea
        id="b-brief"
        className="field min-h-48 resize-y text-[0.9375rem] leading-relaxed"
        value={draft.brief}
        placeholder={topic ? 'e.g. Explain it clearly, solve exam questions on it, remember the key terms.' : 'Paste the question or task here.'}
        onChange={(e) => setDraft({ ...draft, brief: e.target.value })}
        onBlur={() => void save({ brief: draft.brief })}
      />
      {!topic && (
        <>
          <label className="label mt-4" htmlFor="b-rubric">
            Rubric or marking criteria
          </label>
          <textarea id="b-rubric" className="field min-h-36 resize-y text-[0.9375rem] leading-relaxed" value={draft.rubric} placeholder="How it’s marked. Chip checks your work against it." onChange={(e) => setDraft({ ...draft, rubric: e.target.value })} onBlur={() => void save({ rubric: draft.rubric })} />
        </>
      )}
    </div>
  );
}

/** Links the assignment to one of your classes, so Chip follows that course's lecturer. Only shows
 * for someone in a class (or an assignment already linked to one). */
function ClassLink() {
  const a = useWorkspace((s) => s.assignment)!;
  const tutor = useWorkspace((s) => s.tutor);
  const [classes, setClasses] = useState<MyClass[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    myClasses()
      .then(setClasses)
      .catch(() => setClasses([]));
  }, []);
  useEffect(() => {
    if (a.class_id && !useWorkspace.getState().tutor) void loadTutor(a.class_id);
  }, [a.class_id]);

  if (!classes || (classes.length === 0 && !a.class_id)) return null;

  const link = async (classId: string | null) => {
    const before = a.class_id ?? null;
    setBusy(true);
    useWorkspace.setState({ assignment: { ...a, class_id: classId } });
    try {
      await setAssignmentClass(a.id, classId);
      await loadTutor(classId);
      const name = classes.find((c) => c.id === classId)?.name;
      toast(classId ? `Linked to ${name ?? 'your class'}. Chip follows your lecturer’s guidance for it.` : 'Unlinked.', 'good');
    } catch (e) {
      useWorkspace.setState({ assignment: { ...useWorkspace.getState().assignment!, class_id: before } });
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <label className="label" htmlFor="b-class">
        Class
      </label>
      <select id="b-class" className="field" value={a.class_id ?? ''} disabled={busy} onChange={(e) => void link(e.target.value || null)}>
        <option value="">Not linked to a class</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {c.institution}
          </option>
        ))}
        {a.class_id && !classes.some((c) => c.id === a.class_id) && <option value={a.class_id}>A class you’ve left</option>}
      </select>
      <p className="mt-1.5 flex gap-1.5 text-xs leading-relaxed text-ink-3">
        <GraduationCap size={14} className="mt-px flex-none" />
        {tutor ? `Chip follows your lecturer’s guidance for ${tutor.name}.` : 'Link it to a class and Chip follows that course’s lecturer: how much to help, and in the course’s own terms.'}
      </p>
    </div>
  );
}
