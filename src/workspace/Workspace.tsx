import '@fontsource-variable/source-serif-4';
import 'katex/dist/katex.min.css';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  BookMarked,
  Check,
  ChevronDown,
  Code2,
  Download,
  FileText,
  Focus,
  ListChecks,
  MoreHorizontal,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Plus,
  ScrollText,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Orb } from '../components/Orb.tsx';
import { FocusPill } from '../components/TopBar.tsx';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Confirm, Menu, MenuItem, Modal } from '../components/ui.tsx';
import { createDocument, deleteDocument, getAssignment, listDocuments, listLog, listMessages, listNotes, listSources, listTasks, listThreads, renameDocument } from '../lib/api.ts';
import { TONE_STYLES } from '../lib/colors.ts';
import { dueLabel } from '../lib/dates.ts';
import type { DocKind, Mode, StudyDocument } from '../lib/types.ts';
import { useFocus } from '../store/focus.ts';
import { usePrefs } from '../store/prefs.ts';
import { toast } from '../store/toast.ts';
import { ChipPanel, sendToChip } from './chip/ChipPanel.tsx';
import { DocEditor } from './DocEditor.tsx';
import { FocusBar, FocusScene } from './FocusMode.tsx';
import { BriefPanel } from './panels/BriefPanel.tsx';
import { NotesPanel } from './panels/NotesPanel.tsx';
import { RecordPanel } from './panels/RecordPanel.tsx';
import { SourcesPanel } from './panels/SourcesPanel.tsx';
import { TasksPanel } from './panels/TasksPanel.tsx';
import { editors, useWorkspace, type Panel } from './store.ts';

const CodeDoc = lazy(() => import('./CodeDoc.tsx'));
const SheetDoc = lazy(() => import('./SheetDoc.tsx'));

const ease = [0.2, 0.7, 0.1, 1] as const;

const PANELS: { id: Panel; name: string; icon: ReactNode }[] = [
  { id: 'chip', name: 'Chip', icon: <Orb size={16} /> },
  { id: 'brief', name: 'Brief', icon: <ScrollText size={16} /> },
  { id: 'tasks', name: 'Plan', icon: <ListChecks size={16} /> },
  { id: 'sources', name: 'Sources', icon: <BookMarked size={16} /> },
  { id: 'notes', name: 'Notes', icon: <NotebookPen size={16} /> },
  { id: 'record', name: 'Record', icon: <ShieldCheck size={16} /> },
];

function useWide(query = '(min-width: 1100px)') {
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}

/** One assignment's workspace: the document in the middle, Chip and the assignment's panels
 * beside it (or over it, on smaller screens), and focus mode. */
export function Workspace() {
  const { id = '' } = useParams();
  const wide = useWide();
  const assignment = useWorkspace((s) => s.assignment);
  const docs = useWorkspace((s) => s.docs);
  const activeDoc = useWorkspace((s) => s.activeDoc);
  const panel = useWorkspace((s) => s.panel);
  const focusMode = useWorkspace((s) => s.focusMode);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    useWorkspace.getState().reset();
    try {
      const a = await getAssignment(id);
      if (!a) return setStatus('missing');
      const [docsFound, tasks, sources, notes, log, threads] = await Promise.all([listDocuments(id), listTasks(id), listSources(id), listNotes(id), listLog(id), listThreads(id)]);
      let all = docsFound;
      if (!all.some((d) => d.kind === 'doc')) all = [await createDocument(id, 'doc', 'Draft', 0), ...all];
      const thread = threads[0]?.id ?? null;
      const messages = thread ? await listMessages(thread) : [];
      useWorkspace.setState({
        assignment: a,
        docs: all,
        activeDoc: all[0].id,
        tasks,
        sources,
        notes,
        log,
        threads,
        thread,
        messages,
        words: all.find((d) => d.kind === 'doc')?.words ?? 0,
        chipWords: all.find((d) => d.kind === 'doc')?.chip_words ?? 0,
        panel: matchMedia('(min-width: 1100px)').matches && usePrefs.getState().chipOpen ? 'chip' : null,
      });
      document.title = `${a.title} · Chip Study`;
      setStatus('ready');
    } catch {
      setStatus('failed');
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => useWorkspace.getState().reset();
  }, [load]);

  /** Opens Chip in [mode] and asks [text] (about the selection, if there is one). */
  const ask = useCallback(
    (mode: Mode, text: string, selection?: string) => {
      useWorkspace.setState({ panel: 'chip', mode, focusMode: false });
      void sendToChip(text, mode, { selection });
    },
    [],
  );

  const openPanel = (p: Panel | null) => {
    useWorkspace.setState({ panel: p });
    if (wide) usePrefs.getState().set({ chipOpen: p !== null });
  };

  if (status === 'loading' || (status === 'ready' && !assignment)) return <ChipLoader label="Opening your work" />;
  if (status !== 'ready' || !assignment) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <Orb size={56} className="mx-auto" />
          <p className="mt-5 text-lg font-semibold">{status === 'missing' ? 'This assignment isn’t here' : 'Couldn’t open this assignment'}</p>
          <p className="mt-1 text-ink-3">{status === 'missing' ? 'It may have been deleted.' : 'Check your connection and try again.'}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Link to="/app" className="btn btn-ghost">
              Back to my desk
            </Link>
            {status === 'failed' && (
              <button className="btn btn-primary" onClick={() => void load()}>
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const doc = docs.find((d) => d.id === activeDoc) ?? docs[0];
  const showSide = wide && panel !== null && !focusMode;

  return (
    <div className={`ws ${focusMode ? 'is-focus' : ''}`}>
      {focusMode && <FocusScene />}
      {!focusMode && <Header onPanel={openPanel} wide={wide} doc={doc} />}
      {focusMode && <FocusBar />}
      <div className="ws-body">
        <main className="ws-main" id="main">
          {!focusMode && <DocTabs />}
          <div className="ws-doc">
            {doc.kind === 'doc' ? (
              <DocEditor
                key={doc.id}
                doc={doc}
                onAskChip={(mode, selection) =>
                  ask(
                    mode,
                    mode === 'write'
                      ? 'Give me feedback on this, and show me how to make it clearer and stronger in my own voice.'
                      : mode === 'check'
                        ? 'Check this: what’s right, what’s wrong, and why?'
                        : 'Explain this, and check I’ve understood it right.',
                    selection,
                  )
                }
              />
            ) : (
              <Suspense
                fallback={<ChipLoader page={false} size={44} label="" />}
              >
                {doc.kind === 'code' ? <CodeDoc key={doc.id} doc={doc} onAskChip={(text) => ask('explain', text, useWorkspace.getState().selection || undefined)} /> : <SheetDoc key={doc.id} doc={doc} />}
              </Suspense>
            )}
          </div>
          {!focusMode && <StatusBar doc={doc} />}
        </main>
        <AnimatePresence initial={false}>
          {showSide && (
            <motion.aside
              key="side"
              className="ws-side"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'var(--side-w)', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.4, ease }}
              aria-label="Chip and your assignment"
            >
              <div className="ws-side-inner">
                <SidePanel onClose={() => openPanel(null)} ask={ask} />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
      {!wide && !focusMode && (
        <>
          <AnimatePresence>
            {panel && (
              <motion.div className="fixed inset-0 z-50 flex justify-end" initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
                <motion.div className="absolute inset-0 bg-[rgb(25_26_46/0.25)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => openPanel(null)} />
                <motion.div
                  className="relative flex h-full w-full max-w-[460px] flex-col bg-[var(--color-paper)] shadow-[var(--shadow-lift)] sm:rounded-l-[1.75rem]"
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ duration: 0.4, ease }}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Chip and your assignment"
                >
                  <SidePanel onClose={() => openPanel(null)} ask={ask} />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          <MobileBar onPanel={openPanel} />
        </>
      )}
    </div>
  );
}

function Header({ onPanel, wide, doc }: { onPanel: (p: Panel | null) => void; wide: boolean; doc: StudyDocument }) {
  const assignment = useWorkspace((s) => s.assignment)!;
  const panel = useWorkspace((s) => s.panel);
  const due = dueLabel(assignment.due_at);
  const topic = assignment.kind === 'topic';
  return (
    <header className="ws-header">
      <Link to="/app" className="icon-btn flex-none" aria-label="Back to your desk" title="Back to your desk">
        <ArrowLeft size={19} />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[0.98rem] font-semibold leading-tight tracking-[-0.01em]">{assignment.title}</h1>
        <div className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
          {assignment.course && <span className="hidden truncate sm:inline">{assignment.course}</span>}
          {topic ? (
            <span className="chip-tag h-5 bg-iris-soft text-iris-2">{assignment.due_at ? `Learning · by ${new Date(assignment.due_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Learning'}</span>
          ) : (
            assignment.due_at && <span className={`chip-tag h-5 ${TONE_STYLES[due.tone]}`}>{due.text}</span>
          )}
          <SaveDot />
        </div>
      </div>
      <FocusPill />
      <button
        className="btn btn-ghost btn-sm hidden min-[1100px]:inline-flex"
        onClick={() => {
          const f = useFocus.getState();
          if (!f.running && f.phase === 'focus') f.start(assignment.id);
          useWorkspace.setState({ focusMode: true });
        }}
      >
        <Focus size={15} /> Focus
      </button>
      <ExportMenu doc={doc} />
      {wide && (
        <button className="icon-btn" aria-label={panel ? 'Hide the side panel' : 'Show Chip'} title={panel ? 'Hide the side panel' : 'Show Chip'} onClick={() => onPanel(panel ? null : 'chip')}>
          {panel ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
        </button>
      )}
    </header>
  );
}

function SaveDot() {
  const state = useWorkspace((s) => s.saveState);
  const label = { saved: 'Saved', pending: 'Saving soon', saving: 'Saving…', retrying: 'Offline: will save when you’re back', conflict: 'Changed elsewhere' }[state];
  return (
    <span className="flex flex-none items-center gap-1.5" aria-live="polite" data-save={state}>
      <span className={`h-1.5 w-1.5 rounded-full ${state === 'saved' ? 'bg-mint' : state === 'retrying' || state === 'conflict' ? 'bg-peach' : 'animate-pulse bg-iris'}`} />
      <span className={state === 'retrying' || state === 'conflict' ? 'text-[#b25a22]' : ''}>{label}</span>
    </span>
  );
}

function ExportMenu({ doc }: { doc: StudyDocument }) {
  const run = async (what: 'docx' | 'md' | 'pdf' | 'file') => {
    const x = await import('../lib/exports.ts');
    const title = useWorkspace.getState().assignment?.title ?? doc.title;
    if (doc.kind === 'doc') {
      const json = (editors.doc?.getJSON() ?? doc.content) as Record<string, unknown>;
      if (what === 'docx') x.download(await x.documentDocx(json, title), x.fileName(title, 'docx'));
      else if (what === 'md') x.download(x.documentMarkdown(json), x.fileName(title, 'md'));
      else window.print();
    } else {
      const ext = doc.kind === 'sheet' ? 'csv' : { python: 'py', javascript: 'js', typescript: 'ts', java: 'java', cpp: 'cpp', sql: 'sql', html: 'html', css: 'css', markdown: 'md' }[String((doc.content as { lang?: string }).lang ?? 'python')] ?? 'txt';
      const text = editors.text().split('\n').slice(1).join('\n');
      x.download(text, x.fileName(doc.title.replace(/\.[a-z]+$/i, ''), ext), 'text/plain;charset=utf-8');
    }
  };
  return (
    <Menu label="Export" button={<Download size={18} />}>
      {(close) =>
        doc.kind === 'doc' ? (
          <>
            <MenuItem icon={<FileText size={15} />} onClick={() => (close(), void run('docx'))}>
              Word document (.docx)
            </MenuItem>
            <MenuItem icon={<Download size={15} />} onClick={() => (close(), void run('pdf'))}>
              PDF (print)
            </MenuItem>
            <MenuItem icon={<Code2 size={15} />} onClick={() => (close(), void run('md'))}>
              Markdown
            </MenuItem>
          </>
        ) : (
          <MenuItem icon={<Download size={15} />} onClick={() => (close(), void run('file'))}>
            Download {doc.kind === 'sheet' ? 'CSV' : 'file'}
          </MenuItem>
        )
      }
    </Menu>
  );
}

function DocTabs() {
  const docs = useWorkspace((s) => s.docs);
  const active = useWorkspace((s) => s.activeDoc);
  const assignment = useWorkspace((s) => s.assignment)!;
  const [renaming, setRenaming] = useState<StudyDocument | null>(null);
  const [removing, setRemoving] = useState<StudyDocument | null>(null);
  const [name, setName] = useState('');

  const add = async (kind: DocKind) => {
    const title = kind === 'code' ? 'main.py' : kind === 'sheet' ? 'Table' : `Document ${docs.filter((d) => d.kind === 'doc').length + 1}`;
    const content = kind === 'code' ? { lang: 'python', code: '' } : kind === 'sheet' ? { rows: Array.from({ length: 8 }, () => ['', '', '', '', '']), header: true } : {};
    try {
      const d = await createDocument(assignment.id, kind, title, docs.length, content);
      useWorkspace.setState({ docs: [...useWorkspace.getState().docs, d], activeDoc: d.id });
    } catch (e) {
      toast((e as Error).message, 'warn');
    }
  };

  const icon = (k: DocKind) => (k === 'code' ? <Code2 size={14} /> : k === 'sheet' ? <Table2 size={14} /> : <PenLine size={14} />);

  return (
    <div className="ws-tabs">
      <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
        {docs.map((d) => (
          <div key={d.id} className={`ws-tab ${d.id === active ? 'is-active' : ''}`}>
            <button className="flex min-w-0 items-center gap-1.5" onClick={() => useWorkspace.setState({ activeDoc: d.id, selection: '' })} aria-current={d.id === active ? 'page' : undefined}>
              {icon(d.kind)}
              <span className="max-w-[10rem] truncate">{d.title}</span>
            </button>
            {d.id === active && (
              <Menu label={`More for ${d.title}`} button={<ChevronDown size={14} />} align="left" className="-mr-1">
                {(close) => (
                  <>
                    <MenuItem onClick={() => (close(), setName(d.title), setRenaming(d))}>Rename</MenuItem>
                    {docs.filter((x) => x.kind === 'doc').length > 1 || d.kind !== 'doc' ? (
                      <MenuItem danger onClick={() => (close(), setRemoving(d))}>
                        Delete
                      </MenuItem>
                    ) : null}
                  </>
                )}
              </Menu>
            )}
          </div>
        ))}
      </div>
      <Menu label="Add a tab" button={<Plus size={17} />} align="left">
        {(close) => (
          <>
            <MenuItem icon={<PenLine size={15} />} onClick={() => (close(), void add('doc'))}>
              Document
            </MenuItem>
            <MenuItem icon={<Code2 size={15} />} onClick={() => (close(), void add('code'))}>
              Code
            </MenuItem>
            <MenuItem icon={<Table2 size={15} />} onClick={() => (close(), void add('sheet'))}>
              Table with formulas
            </MenuItem>
          </>
        )}
      </Menu>
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename" width={420}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!renaming || !name.trim()) return;
            try {
              await renameDocument(renaming.id, name.trim().slice(0, 200));
              useWorkspace.setState({ docs: useWorkspace.getState().docs.map((d) => (d.id === renaming.id ? { ...d, title: name.trim().slice(0, 200) } : d)) });
              setRenaming(null);
            } catch (err) {
              toast((err as Error).message, 'warn');
            }
          }}
        >
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div className="mt-4 flex justify-end">
            <button className="btn btn-primary btn-sm">
              <Check size={15} /> Save
            </button>
          </div>
        </form>
      </Modal>
      <Confirm
        open={!!removing}
        title={`Delete “${removing?.title}”?`}
        body="It goes for good. Your AI-use record keeps what happened."
        yes="Delete"
        danger
        onClose={() => setRemoving(null)}
        onYes={async () => {
          if (!removing) return;
          try {
            await deleteDocument(removing.id);
            const rest = useWorkspace.getState().docs.filter((d) => d.id !== removing.id);
            useWorkspace.setState({ docs: rest, activeDoc: rest[0]?.id ?? null });
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
    </div>
  );
}

function StatusBar({ doc }: { doc: StudyDocument }) {
  const words = useWorkspace((s) => s.words);
  const chipWords = useWorkspace((s) => s.chipWords);
  const target = useWorkspace((s) => s.assignment?.word_target ?? null);
  if (doc.kind !== 'doc') return null;
  const share = target ? Math.min(1, words / target) : null;
  return (
    <div className="ws-status">
      <span className="tabular-nums">
        <strong className="font-semibold text-ink-2">{words.toLocaleString()}</strong>
        {target ? ` / ${target.toLocaleString()}` : ''} words
      </span>
      {share !== null && (
        <span className="hidden h-1 w-24 overflow-hidden rounded-full bg-line sm:block" aria-hidden="true">
          <span className="block h-full rounded-full bg-iris transition-[width] duration-700" style={{ width: `${share * 100}%` }} />
        </span>
      )}
      {chipWords > 0 && (
        <span className="tabular-nums" title="Words still in Chip’s wording (they’re in your AI-use record)">
          · <span className="chip-words">Chip’s words</span>: {Math.min(chipWords, words).toLocaleString()}
        </span>
      )}
    </div>
  );
}

function SidePanel({ onClose, ask }: { onClose: () => void; ask: (mode: Mode, text: string, selection?: string) => void }) {
  const panel = useWorkspace((s) => s.panel) ?? 'chip';
  const topic = useWorkspace((s) => s.assignment?.kind === 'topic');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="grid flex-none grid-cols-6 border-b border-line px-1.5 pt-1.5" aria-label="Panels">
        {PANELS.map((p) => (
          <button key={p.id} className={`ws-ptab ${p.id === panel ? 'is-active' : ''}`} onClick={() => useWorkspace.setState({ panel: p.id })} aria-current={p.id === panel ? 'page' : undefined}>
            {p.icon}
            <span>{p.id === 'brief' && topic ? 'About' : p.name}</span>
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        {panel === 'chip' && <ChipPanel onClose={onClose} />}
        {panel === 'brief' && <BriefPanel onAsk={(mode, text) => ask(mode, text)} />}
        {panel === 'tasks' && (
          <TasksPanel onPlan={() => ask('plan', topic ? 'Make me a study plan: what to learn in what order, with practice and review, with dates.' : 'Make me a plan to the due date: an outline and the steps, with dates.')} />
        )}
        {panel === 'sources' && <SourcesPanel onFind={() => ask('cite', topic ? 'Find three good sources to learn this from.' : 'Find three reputable sources I could use for this assignment.')} />}
        {panel === 'notes' && <NotesPanel />}
        {panel === 'record' && <RecordPanel />}
      </div>
    </div>
  );
}

function MobileBar({ onPanel }: { onPanel: (p: Panel | null) => void }) {
  const panel = useWorkspace((s) => s.panel);
  const items: { id: Panel | null; name: string; icon: ReactNode }[] = [
    { id: null, name: 'Write', icon: <PenLine size={19} /> },
    { id: 'chip', name: 'Chip', icon: <Orb size={20} /> },
    { id: 'tasks', name: 'Plan', icon: <ListChecks size={19} /> },
    { id: 'sources', name: 'Sources', icon: <BookMarked size={19} /> },
    { id: 'brief', name: 'More', icon: <MoreHorizontal size={19} /> },
  ];
  return (
    <nav className="ws-mobilebar" aria-label="Workspace">
      {items.map((it) => {
        const on = it.id === null ? panel === null : it.id === 'brief' ? ['brief', 'notes', 'record'].includes(panel ?? '') : panel === it.id;
        return (
          <button key={it.name} className={`ws-mtab ${on ? 'is-active' : ''}`} onClick={() => onPanel(it.id)} aria-pressed={on}>
            {it.icon}
            <span>{it.name}</span>
          </button>
        );
      })}
      <button
        className="ws-mtab"
        onClick={() => {
          const a = useWorkspace.getState().assignment;
          const f = useFocus.getState();
          if (!f.running && f.phase === 'focus') f.start(a?.id ?? null);
          useWorkspace.setState({ focusMode: true, panel: null });
        }}
      >
        <Focus size={19} />
        <span>Focus</span>
      </button>
    </nav>
  );
}
