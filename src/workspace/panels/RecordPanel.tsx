import { BookMarked, ClipboardCheck, Compass, Download, FileText, Lightbulb, ListChecks, MessageSquareQuote, PenLine, Replace, ShieldCheck, Sparkles, TextCursorInput } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Modal, Spinner } from '../../components/ui.tsx';
import { buildDeclaration, modelName } from '../../lib/declaration.ts';
import type { LogAction } from '../../lib/types.ts';
import { useAuth } from '../../store/auth.ts';
import { toast } from '../../store/toast.ts';
import { useWorkspace } from '../store.ts';

const ICONS: Record<LogAction, ReactNode> = {
  guide: <Compass size={14} />,
  explain: <Lightbulb size={14} />,
  plan: <ListChecks size={14} />,
  write: <PenLine size={14} />,
  check: <ClipboardCheck size={14} />,
  cite: <BookMarked size={14} />,
  quiz: <MessageSquareQuote size={14} />,
  setup: <FileText size={14} />,
  inserted: <TextCursorInput size={14} />,
  replaced: <Replace size={14} />,
  added_tasks: <ListChecks size={14} />,
  added_sources: <BookMarked size={14} />,
};

/** The AI-use record: every way Chip helped on this assignment, as the server kept it, and the
 * declaration it makes. */
export function RecordPanel() {
  const log = useWorkspace((s) => s.log);
  const words = useWorkspace((s) => s.words);
  const chipWords = useWorkspace((s) => s.chipWords);
  const [exporting, setExporting] = useState(false);
  const share = words ? Math.round((Math.min(chipWords, words) / words) * 1000) / 10 : 0;
  const entries = [...log].reverse();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-mint-soft text-mint">
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Your AI-use record</p>
            <p className="text-sm leading-relaxed text-ink-3">Every way Chip helped, kept as it happened. It can’t be edited, so your declaration is one you can stand behind.</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-paper px-4 py-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-ink-2">Chip’s words in your document</span>
            <span className="font-semibold tabular-nums">
              {Math.min(chipWords, words).toLocaleString()} of {words.toLocaleString()} ({share}%)
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-gradient-to-r from-[#a79fff] to-[#6457f0] transition-[width] duration-700" style={{ width: `${Math.min(100, share)}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-3">Text you put in from Chip is <span className="chip-words">marked like this</span> until you rewrite it.</p>
        </div>
        <button className="btn btn-primary btn-sm mt-4 w-full" onClick={() => setExporting(true)}>
          <Download size={15} /> Export declaration
        </button>
      </div>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {entries.length === 0 ? (
          <p className="rounded-3xl bg-paper/70 px-5 py-6 text-center text-sm leading-relaxed text-ink-3">Nothing yet. When you ask Chip for help, it shows up here.</p>
        ) : (
          <ol className="relative space-y-4 border-l-2 border-line pl-5">
            {entries.map((e) => (
              <li key={e.id} className="relative">
                <span className={`absolute -left-[1.95rem] top-0 grid h-7 w-7 place-items-center rounded-full border-2 border-white ${['inserted', 'replaced'].includes(e.action) ? 'bg-iris text-white' : 'bg-iris-soft text-iris-2'}`}>
                  {ICONS[e.action]}
                </span>
                <p className="text-sm font-semibold leading-snug">{e.summary}</p>
                <p className="text-xs text-ink-4">
                  {new Date(e.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  {e.model && ` · ${modelName(e.model)}`}
                  {e.words > 0 && ` · ${e.words} words`}
                </p>
                {e.prompt && <p className="mt-1 line-clamp-2 text-sm text-ink-2">“{e.prompt}”</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <DeclarationDialog open={exporting} onClose={() => setExporting(false)} />
    </div>
  );
}

function DeclarationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useAuth((s) => s.me);
  const assignment = useWorkspace((s) => s.assignment);
  const [student, setStudent] = useState('');
  const [ownWords, setOwnWords] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  if (!assignment) return null;

  const make = async (format: 'md' | 'docx' | 'pdf') => {
    const { log, words, chipWords } = useWorkspace.getState();
    const d = buildDeclaration({ student: student || me?.name || '', assignment, log, words, chipWords, ownWords });
    setBusy(format);
    try {
      const x = await import('../../lib/exports.ts');
      const name = `AI-use declaration - ${assignment.title}`;
      if (format === 'md') x.download(x.declarationMarkdown(d), x.fileName(name, 'md'));
      else if (format === 'docx') x.download(await x.declarationDocx(d), x.fileName(name, 'docx'));
      else x.download(await x.declarationPdf(d), x.fileName(name, 'pdf'));
      toast('Your declaration is downloading.', 'good');
    } catch {
      toast('Couldn’t make that file. Try another format.', 'warn');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Export your declaration" width={520}>
      <p className="text-[0.9375rem] leading-relaxed text-ink-2">A statement of how you used Chip on this assignment, with the full record, ready to hand in with your work.</p>
      <label className="label mt-5" htmlFor="d-name">
        Your name, as on your work
      </label>
      <input id="d-name" className="field" placeholder={me?.name ?? 'Your full name'} value={student} onChange={(e) => setStudent(e.target.value)} />
      <label className="label mt-4" htmlFor="d-own">
        In your own words <span className="font-normal text-ink-4">(optional)</span>
      </label>
      <textarea id="d-own" className="field min-h-24" placeholder="e.g. I used Chip to plan my essay and to check my draft against the rubric. The argument and the writing are my own." value={ownWords} onChange={(e) => setOwnWords(e.target.value)} />
      <div className="mt-5 grid grid-cols-3 gap-2">
        {(
          [
            ['docx', 'Word'],
            ['pdf', 'PDF'],
            ['md', 'Markdown'],
          ] as const
        ).map(([f, label]) => (
          <button key={f} className={`btn btn-sm ${f === 'docx' ? 'btn-primary' : 'btn-ghost'}`} disabled={!!busy} onClick={() => void make(f)}>
            {busy === f ? <Spinner /> : <Download size={15} />} {label}
          </button>
        ))}
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-3">
        <Sparkles size={12} className="text-iris" /> Check your course’s rules on how to declare AI use.
      </p>
    </Modal>
  );
}
