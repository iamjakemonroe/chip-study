import { ArrowRight, BookOpen, FileText, FileUp, GraduationCap, PenLine, Sparkles, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { createAssignment } from '../lib/api.ts';
import { ChipRefused, readSheet, type Setup } from '../lib/chip.ts';
import { COLOR_ORDER, COLORS } from '../lib/colors.ts';
import { dueAtFrom } from '../lib/dates.ts';
import { ACCEPT_ANY, ACCEPT_DOCUMENTS } from '../lib/filetypes.ts';
import { addReadings } from '../lib/readings.ts';
import type { Color, Style } from '../lib/types.ts';
import { useAuth } from '../store/auth.ts';
import { toast } from '../store/toast.ts';
import { Orb } from './Orb.tsx';
import { Modal, Spinner } from './ui.tsx';

interface Form {
  title: string;
  course: string;
  dueDay: string;
  dueTime: string;
  wordTarget: string;
  style: Style;
  color: Color;
  brief: string;
  rubric: string;
  tasks: { title: string; due: string; keep: boolean }[];
}

const blank = (color: Color): Form => ({
  title: '',
  course: '',
  dueDay: '',
  dueTime: '23:59',
  wordTarget: '',
  style: 'apa',
  color,
  brief: '',
  rubric: '',
  tasks: [],
});

/** A new study space: something to learn (a topic, an exam, a course), or an assignment (drop in
 * the sheet and Chip sets it up, or fill it in). */
export function NewAssignment({ open, onClose, count, start = 'choose' }: { open: boolean; onClose: () => void; count: number; start?: 'choose' | 'topic' | 'start' }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.me);
  const [step, setStep] = useState<'choose' | 'topic' | 'start' | 'reading' | 'form'>(start);
  const [readings, setReadings] = useState<File[]>([]);
  const readingInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Form>(() => blank(COLOR_ORDER[count % COLOR_ORDER.length]));
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const close = () => {
    onClose();
    setTimeout(() => {
      setStep(start);
      setReadings([]);
      setForm(blank(COLOR_ORDER[(count + 1) % COLOR_ORDER.length]));
      setPasted('');
      setStatus('');
    }, 300);
  };

  const fill = (s: Setup, text: string) => {
    setForm((f) => ({
      ...f,
      title: s.title || f.title,
      course: s.course || f.course,
      dueDay: s.due || f.dueDay,
      wordTarget: s.word_target ? String(s.word_target) : f.wordTarget,
      brief: text || s.brief || f.brief,
      rubric: s.rubric || f.rubric,
      tasks: s.tasks.map((t) => ({ title: t.title, due: t.due, keep: true })),
    }));
    setStep('form');
  };

  /** Chip reads the sheet's text; if Chip can't (no Chip time), the text still fills the brief. */
  const fromText = async (text: string) => {
    setStep('reading');
    setStatus('Chip is reading your brief…');
    try {
      fill(await readSheet({ text: text.slice(0, 60000) }), text);
    } catch (e) {
      setForm((f) => ({ ...f, brief: text }));
      setStep('form');
      toast(e instanceof ChipRefused ? `${e.message} You can fill it in yourself.` : 'Chip couldn’t read it, so the text is in the brief for you to sort.', 'warn');
    }
  };

  /** The sheet from its files: the text taken out of documents (PDF, Word, Excel and the rest), and the scans and
   * photos Chip reads itself, all at once (up to 3 files, or 10 with Pro). */
  const fromFiles = async (picked: File[]) => {
    const most = me?.tier === 'pro' ? 10 : 3;
    const files = picked.slice(0, most);
    if (picked.length > most) toast(`Chip reads up to ${most} files at once${me?.tier === 'pro' ? '' : ' (10 with Pro)'}: the first ${most} it is.`, 'info');
    setStep('reading');
    try {
      const { extractText, base64Of, mediaType, kindOf, hasText, cantRead } = await import('../lib/extract.ts');
      const max = (me?.uploads.max_mb ?? 4) * 1024 * 1024;
      const texts: string[] = [];
      const scans: { media_type: string; data: string }[] = [];
      let bytes = 0;
      for (const file of files) {
        setStatus(`Opening ${file.name}…`);
        const kind = kindOf(file);
        if (kind !== 'image' && !hasText(kind)) throw new Error(cantRead(file));
        const { text } = kind === 'image' ? { text: '' } : await extractText(file);
        if (text.trim().length >= 40) {
          texts.push(files.length > 1 ? `[${file.name}]\n${text.trim()}` : text);
          continue;
        }
        if (kind !== 'image' && kind !== 'pdf') throw new Error(`No text in ${file.name}.`);
        // A scan or a photo: Chip reads the file itself.
        bytes += file.size;
        if (bytes > max) {
          throw new Error(
            files.length > 1
              ? `Those files are over ${me?.uploads.max_mb ?? 4} MB together. Try fewer or smaller ones, or paste the text.`
              : `That file is over ${me?.uploads.max_mb ?? 4} MB. Try a smaller one, or paste the text.`,
          );
        }
        scans.push({ media_type: mediaType(file), data: await base64Of(file) });
      }
      const text = texts.join('\n\n');
      if (!scans.length) return await fromText(text);
      setStatus(files.length > 1 ? `Chip is reading your ${files.length} files…` : 'Chip is reading your sheet…');
      fill(await readSheet({ text: text ? text.slice(0, 60000) : undefined, files: scans }), '');
    } catch (e) {
      setStep('start');
      toast((e as Error).message || 'Couldn’t open that file.', 'warn');
    }
  };

  const create = async (kind: 'topic' | 'assignment' = 'assignment') => {
    if (!form.title.trim()) {
      toast(kind === 'topic' ? 'Say what you want to learn first.' : 'Give it a title first.', 'warn');
      return;
    }
    setBusy(true);
    try {
      const a = await createAssignment(
        {
          kind,
          title: form.title.trim().slice(0, 200),
          course: form.course.trim().slice(0, 120),
          brief: form.brief.slice(0, 60000),
          rubric: form.rubric.slice(0, 30000),
          due_at: dueAtFrom(form.dueDay, form.dueTime),
          word_target: Number(form.wordTarget) > 0 ? Math.min(200000, Math.round(Number(form.wordTarget))) : null,
          style: form.style,
          color: form.color,
        },
        kind === 'topic' ? [] : form.tasks.filter((t) => t.keep && t.title.trim()).map((t) => ({ title: t.title.trim(), due: t.due || null })),
      );
      // Readings or notes to learn from: their text, taken out here, for Chip to read with them.
      if (kind === 'topic' && readings.length) await addReadings(a.id, readings, me?.readings.max_chars ?? 60000);
      close();
      navigate(`/app/a/${a.id}`);
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === 'choose' ? 'What are you working on?' : step === 'topic' ? 'Something to learn' : step === 'form' ? 'Your assignment' : 'New assignment'}
      width={step === 'form' ? 640 : 560}
      footer={
        step === 'form' || step === 'topic' ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setStep(step === 'topic' ? 'choose' : 'start')}>
              Back
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => void create(step === 'topic' ? 'topic' : 'assignment')} disabled={busy}>
              {busy ? <Spinner /> : step === 'topic' ? 'Start learning' : 'Create assignment'}
            </button>
          </>
        ) : undefined
      }
    >
      {step === 'choose' && (
        <div className="grid gap-3">
          <button className="group flex items-start gap-4 rounded-3xl border border-line bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-iris/40 hover:shadow-[var(--shadow-soft)]" onClick={() => setStep('topic')}>
            <span className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-iris-soft text-iris">
              <GraduationCap size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Something to learn</span>
              <span className="mt-0.5 block text-sm leading-relaxed text-ink-3">A topic, a course or an exam. Chip tutors you through it, and turns it into practice that sticks.</span>
            </span>
            <ArrowRight size={18} className="mt-1 text-ink-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <button className="group flex items-start gap-4 rounded-3xl border border-line bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-iris/40 hover:shadow-[var(--shadow-soft)]" onClick={() => setStep('start')}>
            <span className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-mint-soft text-mint">
              <FileText size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">An assignment</span>
              <span className="mt-0.5 block text-sm leading-relaxed text-ink-3">Drop in the brief. Chip helps you understand it, plan it and write it in your own words, honestly.</span>
            </span>
            <ArrowRight size={18} className="mt-1 text-ink-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      )}

      {step === 'topic' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="t-title">
              What do you want to learn?
            </label>
            <input id="t-title" className="field" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Organic chemistry: reaction mechanisms" data-autofocus />
          </div>
          <div>
            <label className="label" htmlFor="t-course">
              Course <span className="font-normal text-ink-4">(optional)</span>
            </label>
            <input id="t-course" className="field" value={form.course} onChange={(e) => set('course', e.target.value)} placeholder="e.g. CHEM 210" />
          </div>
          <div>
            <label className="label" htmlFor="t-by">
              Learn it by <span className="font-normal text-ink-4">(an exam?)</span>
            </label>
            <input id="t-by" type="date" className="field" value={form.dueDay} onChange={(e) => set('dueDay', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="t-goal">
              What should you be able to do? <span className="font-normal text-ink-4">(optional)</span>
            </label>
            <textarea id="t-goal" className="field min-h-24 resize-y" value={form.brief} onChange={(e) => set('brief', e.target.value)} placeholder="e.g. Explain SN1 and SN2, predict products, and draw the mechanisms for my exam." />
          </div>
          <div className="sm:col-span-2">
            <span className="label">Notes or readings to learn from <span className="font-normal text-ink-4">(optional)</span></span>
            <button type="button" className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-line-2 bg-paper/60 px-4 py-3 text-left text-sm text-ink-2 hover:border-iris/50" onClick={() => readingInput.current?.click()}>
              <BookOpen size={18} className="text-iris" />
              <span className="min-w-0 flex-1 truncate">
                {readings.length === 0
                  ? 'Add PDFs, Word, Excel or PowerPoint files: Chip will read them with you'
                  : readings.length === 1
                    ? readings[0].name
                    : `${readings.length} files: ${readings.map((f) => f.name).join(', ')}`}
              </span>
            </button>
            <input
              ref={readingInput}
              type="file"
              className="hidden"
              accept={ACCEPT_DOCUMENTS}
              multiple
              onChange={(e) => {
                setReadings(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>
        </div>
      )}
      {step === 'start' && (
        <div>
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">Drop in the assignment sheet and Chip sets it up: the title, due date, brief, rubric and a first plan.</p>
          <button
            type="button"
            className={`mt-5 flex w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-9 text-center transition-colors ${dragging ? 'border-iris bg-iris-soft' : 'border-line-2 bg-paper/60 hover:border-iris/50 hover:bg-iris-soft/40'}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length) void fromFiles(files);
            }}
          >
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-iris shadow-[var(--shadow-soft)]">
              <Upload size={22} />
            </span>
            <span className="mt-3 font-semibold">Drop your assignment sheet</span>
            <span className="mt-1 text-sm text-ink-3">PDF, Word, PowerPoint, text, or photos of it: several at once if it comes in parts</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            accept={ACCEPT_ANY}
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void fromFiles(files);
            }}
          />
          <label className="label mt-6" htmlFor="paste">
            Or paste it
          </label>
          <textarea
            id="paste"
            className="field min-h-28 resize-y"
            placeholder="Paste the brief, the question, the marking criteria…"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-iris btn-sm" disabled={pasted.trim().length < 10} onClick={() => void fromText(pasted.trim())}>
              <Sparkles size={15} /> Let Chip set it up
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (pasted.trim()) set('brief', pasted.trim());
                setStep('form');
              }}
            >
              <PenLine size={15} /> Fill it in myself
            </button>
          </div>
        </div>
      )}

      {step === 'reading' && (
        <div className="flex flex-col items-center py-12 text-center">
          <Orb size={56} state="thinking" />
          <p className="mt-5 font-semibold">{status}</p>
          <p className="mt-1 text-sm text-ink-3">This takes a few seconds.</p>
        </div>
      )}

      {step === 'form' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="title">
              Title
            </label>
            <input id="title" className="field" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Essay: Coastal erosion and policy" data-autofocus />
          </div>
          <div>
            <label className="label" htmlFor="course">
              Course
            </label>
            <input id="course" className="field" value={form.course} onChange={(e) => set('course', e.target.value)} placeholder="e.g. GEO 201" />
          </div>
          <div>
            <label className="label" htmlFor="words">
              Word target
            </label>
            <input id="words" className="field" inputMode="numeric" value={form.wordTarget} onChange={(e) => set('wordTarget', e.target.value.replace(/\D/g, ''))} placeholder="e.g. 1500" />
          </div>
          <div>
            <label className="label" htmlFor="due">
              Due date
            </label>
            <input id="due" type="date" className="field" value={form.dueDay} onChange={(e) => set('dueDay', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="time">
              Time
            </label>
            <input id="time" type="time" className="field" value={form.dueTime} onChange={(e) => set('dueTime', e.target.value)} />
          </div>
          <div>
            <span className="label">Referencing</span>
            <div className="flex gap-2">
              {(['apa', 'harvard'] as Style[]).map((s) => (
                <button key={s} type="button" onClick={() => set('style', s)} aria-pressed={form.style === s} className={`btn btn-sm flex-1 ${form.style === s ? 'btn-primary' : 'btn-ghost'}`}>
                  {s === 'apa' ? 'APA 7th' : 'Harvard'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="label">Colour</span>
            <div className="flex h-9 items-center gap-2">
              {COLOR_ORDER.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={COLORS[c].name}
                  aria-pressed={form.color === c}
                  onClick={() => set('color', c)}
                  className={`h-7 w-7 rounded-full transition-transform ${form.color === c ? 'scale-110 ring-2 ring-offset-2' : 'hover:scale-105'}`}
                  style={{ background: COLORS[c].ink, ['--tw-ring-color' as string]: COLORS[c].ink }}
                />
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="brief">
              Brief
            </label>
            <textarea id="brief" className="field min-h-28 resize-y" value={form.brief} onChange={(e) => set('brief', e.target.value)} placeholder="The question or task, as you were given it." />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="rubric">
              Rubric or marking criteria
            </label>
            <textarea id="rubric" className="field min-h-20 resize-y" value={form.rubric} onChange={(e) => set('rubric', e.target.value)} placeholder="How it's marked (Chip checks your work against this)." />
          </div>
          {form.tasks.length > 0 && (
            <div className="sm:col-span-2">
              <span className="label flex items-center gap-1.5">
                <Sparkles size={13} className="text-iris" /> A first plan from Chip
              </span>
              <ul className="space-y-1.5 rounded-2xl border border-line bg-paper/50 p-2">
                {form.tasks.map((t, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-iris)]"
                      checked={t.keep}
                      aria-label={`Keep: ${t.title}`}
                      onChange={(e) => set('tasks', form.tasks.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))}
                    />
                    <span className="min-w-0 flex-1 text-sm">{t.title}</span>
                    {t.due && <span className="text-xs font-medium text-ink-3">{new Date(`${t.due}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="flex items-center gap-2 text-xs text-ink-3 sm:col-span-2">
            <FileUp size={13} /> You can change all of this later.
          </p>
        </div>
      )}
    </Modal>
  );
}
