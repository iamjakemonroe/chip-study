import { motion } from 'framer-motion';
import {
  ArrowUp,
  BookMarked,
  Brain,
  Compass,
  FileText,
  ClipboardCheck,
  ClipboardCopy,
  Globe,
  History,
  Image as ImageIcon,
  Lightbulb,
  ListChecks,
  Lock,
  Paperclip,
  PenLine,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Orb } from '../../components/Orb.tsx';
import { AutoTextarea, Menu, MenuItem, Spinner } from '../../components/ui.tsx';
import { chipTime, describe, modelFor, when } from '../../lib/allowance.ts';
import { deleteThread, listLog, listMessages } from '../../lib/api.ts';
import { plainAnswer, segments } from '../../lib/blocks.ts';
import { askChip, ChipRefused, type ChipEvent } from '../../lib/chip.ts';
import { ago } from '../../lib/dates.ts';
import { renderMarkdown } from '../../lib/markdown.ts';
import { prepareAttachments, type ChatFile } from '../../lib/readings.ts';
import type { Mode } from '../../lib/types.ts';
import { useAuth } from '../../store/auth.ts';
import { usePrefs } from '../../store/prefs.ts';
import { toast } from '../../store/toast.ts';
import { editors, useWorkspace, type ChatMessage } from '../store.ts';
import { CardsCard, DraftCard, PendingCard, QuizCard, RubricCard, SourcesCard, TasksCard } from './cards.tsx';

type Tries = { topic: string[]; assignment: string[] };

export const MODES: { mode: Mode; name: string; short: string; icon: React.ReactNode; line: string; tries: Tries }[] = [
  {
    mode: 'guide',
    name: 'Guide me',
    short: 'Guide me',
    icon: <Compass size={15} />,
    line: 'Chip asks what you think, gives hints, and guides you to the answer, so it sticks. Want it straight? Tap Explain.',
    tries: {
      topic: ['Help me understand the main idea, step by step', 'I’m stuck on a problem. Guide me through it', 'Ask me questions to see what I already know'],
      assignment: ['Help me understand what the brief is really asking', 'Guide me to a strong argument for this', 'I’m stuck on where to start. Help me think it through'],
    },
  },
  {
    mode: 'explain',
    name: 'Just explain it',
    short: 'Explain',
    icon: <Lightbulb size={15} />,
    line: 'A clear explanation, step by step with an example, then one quick question to check.',
    tries: {
      topic: ['Explain the key idea simply, with an example', 'Explain the difference between the two easiest-to-confuse ideas', 'Check my understanding with three quick questions'],
      assignment: ['Explain the brief in plain words', 'What does the rubric reward most?', 'Explain the key concept I need for this'],
    },
  },
  {
    mode: 'check',
    name: 'Check my work',
    short: 'Check',
    icon: <ClipboardCheck size={15} />,
    line: 'What’s right, what’s wrong and why, with a hint to fix it. Select your work, or Chip reads your document.',
    tries: {
      topic: ['Check my notes for anything wrong or missing', 'Check my answer to this problem: …', 'Is my explanation of this correct?'],
      assignment: ['Check my draft against the rubric', 'What would raise my mark the most?', 'Is my argument clear and well supported?'],
    },
  },
  {
    mode: 'quiz',
    name: 'Practice',
    short: 'Practice',
    icon: <Brain size={15} />,
    line: 'Quizzes and flashcards from your notes and readings. Save cards to your review deck.',
    tries: {
      topic: ['Quiz me on my notes', 'Make flashcards of the key terms', 'Give me harder questions on what I got wrong'],
      assignment: ['Quiz me on the readings', 'Make flashcards of the key terms', 'Test me on the topic before I write'],
    },
  },
  {
    mode: 'plan',
    name: 'Plan',
    short: 'Plan',
    icon: <ListChecks size={15} />,
    line: 'A study plan, or an outline and a schedule to your due date.',
    tries: {
      topic: ['Make me a study plan to my exam', 'What should I learn first, and in what order?', 'I have an hour tonight. What should I do?'],
      assignment: ['Make me a plan to the due date', 'Outline the sections with word counts', 'I have two hours tonight. What should I do first?'],
    },
  },
  {
    mode: 'write',
    name: 'Write in my words',
    short: 'Write',
    icon: <PenLine size={15} />,
    line: 'Feedback and ideas while you write; drafts only when you ask, marked as Chip’s.',
    tries: {
      topic: ['Help me write a summary of this in my own words', 'Give me feedback on the paragraph I selected', 'Help me turn my notes into a clear explanation'],
      assignment: ['Help me start my introduction', 'Give me feedback on the paragraph I selected', 'Make my conclusion answer the question'],
    },
  },
  {
    mode: 'cite',
    name: 'Cite',
    short: 'Cite',
    icon: <BookMarked size={15} />,
    line: 'Sources and referencing. Web research with Pro.',
    tries: {
      topic: ['Find three good sources to learn this from', 'What should I read first on this?', 'How do I cite a website with no author?'],
      assignment: ['Find three reputable sources for my topic', 'Where in my draft do I need a citation?', 'How do I cite a website with no author?'],
    },
  },
];

let abort: AbortController | null = null;
let seq = 0;

/** Sends [text] to Chip in [mode] and streams the answer into the conversation. */
export async function sendToChip(text: string, mode: Mode, opts: { again?: boolean; selection?: string; files?: ChatFile[]; attached?: string[] } = {}) {
  const ws = useWorkspace.getState();
  if (ws.streaming || !ws.assignment) return;
  const me = useAuth.getState().me;
  const model = modelFor(me, usePrefs.getState().model);
  const selection = opts.selection ?? (ws.attachSelection ? ws.selection : '');
  const n = ++seq;
  const names = [...(opts.attached ?? []), ...(opts.files ?? []).map((f) => f.name)];
  const user: ChatMessage = {
    id: `local-u-${n}`,
    role: 'user',
    mode,
    content: text,
    meta: { ...(selection ? { selection: selection.slice(0, 600) } : {}), ...(names.length ? { files: names } : {}) },
  };
  const chip: ChatMessage = { id: `local-c-${n}`, role: 'chip', mode, content: '', meta: { kind: model }, streaming: true };
  let messages = ws.messages;
  if (opts.again) {
    const last = messages.length - 1;
    if (last >= 0 && messages[last].role === 'chip') messages = messages.slice(0, last);
    messages = [...messages, chip];
  } else messages = [...messages, user, chip];
  useWorkspace.setState({ messages, streaming: true, attachSelection: false, mode, panel: useWorkspace.getState().panel ?? 'chip' });

  const update = (patch: Partial<ChatMessage>) =>
    useWorkspace.setState((s) => ({ messages: s.messages.map((m) => (m.id === chip.id ? { ...m, ...patch } : m)) }));

  // Text arrives token by token; the screen takes it at most once a frame.
  let pending = '';
  let shown = '';
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (!pending) return;
    shown += pending;
    pending = '';
    update({ content: shown, searching: false });
  };

  abort = new AbortController();
  let thread = ws.thread;
  const onEvent = (e: ChipEvent) => {
    switch (e.t) {
      case 'start':
        thread = e.thread;
        if (useWorkspace.getState().thread !== e.thread) {
          const s = useWorkspace.getState();
          useWorkspace.setState({
            thread: e.thread,
            threads: s.threads.some((t) => t.id === e.thread) ? s.threads : [{ id: e.thread, assignment_id: s.assignment!.id, title: text.slice(0, 80), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...s.threads],
          });
        }
        useWorkspace.setState((s) => ({ messages: s.messages.map((m) => (m.id === user.id ? { ...m, id: e.message } : m)) }));
        update({ meta: { kind: e.model }, note: e.note === 'best_used' ? 'Chip’s best model is used up for now, so Chip Fast answered this one.' : null });
        break;
      case 'think':
        useWorkspace.setState((s) => ({ messages: s.messages.map((m) => (m.id === chip.id ? { ...m, think: ((m.think ?? '') + e.text).slice(-240) } : m)) }));
        break;
      case 'search':
        update({ searching: true });
        break;
      case 'text':
        pending += e.text;
        if (!frame) frame = requestAnimationFrame(flush);
        break;
      case 'done':
        if (frame) cancelAnimationFrame(frame);
        flush();
        useWorkspace.setState((s) => ({
          messages: s.messages.map((m) => (m.id === chip.id ? { ...m, id: e.message ?? m.id, streaming: false, searching: false, meta: { ...m.meta, kind: e.model, cut: e.cut } } : m)),
        }));
        break;
      case 'refusal':
        update({ streaming: false, content: '', error: 'Chip can’t help with that one. Try asking another way.' });
        break;
      case 'error':
        if (frame) cancelAnimationFrame(frame);
        flush();
        update({ streaming: false, error: e.error });
        break;
    }
  };

  try {
    await askChip(
      {
        assignment: ws.assignment.id,
        thread,
        mode,
        text,
        selection: selection || undefined,
        doc: editors.text().slice(-120000),
        model,
        again: opts.again,
        files: opts.files?.length ? opts.files : undefined,
        attached: opts.attached?.length ? opts.attached : undefined,
      },
      onEvent,
      abort.signal,
    );
  } catch (err) {
    if (frame) cancelAnimationFrame(frame);
    flush();
    if (abort?.signal.aborted) update({ streaming: false, meta: { kind: model, stopped: true } });
    else if (err instanceof ChipRefused) update({ streaming: false, refused: { why: err.why, resetsAt: err.resetsAt }, error: err.message });
    else update({ streaming: false, error: (err as Error).message || 'Chip couldn’t think just now.' });
  } finally {
    const stopped = abort?.signal.aborted;
    abort = null;
    useWorkspace.setState((s) => ({ streaming: false, messages: s.messages.map((m) => (m.id === chip.id || m.id.startsWith('local-c') ? { ...m, streaming: false, searching: false } : m)) }));
    const a = useWorkspace.getState().assignment;
    if (a) void listLog(a.id).then((log) => useWorkspace.setState({ log })).catch(() => undefined);
    void useAuth.getState().refresh();
    // A stopped answer was saved by the server as far as it got: take its id.
    if (stopped && thread) {
      void listMessages(thread).then((all) => {
        const last = all.filter((m) => m.role === 'chip').pop();
        if (last) useWorkspace.setState((s) => ({ messages: s.messages.map((m) => (m.id === chip.id ? { ...m, id: last.id } : m)) }));
      }).catch(() => undefined);
    }
  }
}

export function stopChip() {
  abort?.abort();
}

/** Chip, beside the document: modes, the conversation and the composer. */
export function ChipPanel({ onClose }: { onClose?: () => void }) {
  const messages = useWorkspace((s) => s.messages);
  const streaming = useWorkspace((s) => s.streaming);
  const mode = useWorkspace((s) => s.mode);
  const threads = useWorkspace((s) => s.threads);
  const thread = useWorkspace((s) => s.thread);
  const selection = useWorkspace((s) => s.selection);
  const attach = useWorkspace((s) => s.attachSelection);
  const me = useAuth((s) => s.me);
  const wanted = usePrefs((s) => s.model);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const current = MODES.find((m) => m.mode === mode)!;
  const kind = useWorkspace((s) => s.assignment?.kind ?? 'assignment');
  const model = modelFor(me, wanted);
  const time = me ? chipTime(me, model) : null;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (value = text) => {
    const v = value.trim();
    const assignment = useWorkspace.getState().assignment;
    if ((!v && !attachments.length) || streaming || preparing || !assignment) return;
    let files: ChatFile[] = [];
    let attached: string[] = [];
    if (attachments.length) {
      setPreparing(true);
      try {
        const ready = await prepareAttachments(assignment.id, attachments, useAuth.getState().me);
        files = ready.files;
        attached = ready.attached;
        if (ready.saved.length) useWorkspace.setState({ sources: [...useWorkspace.getState().sources, ...ready.saved] });
      } catch (e) {
        toast((e as Error).message, 'warn');
        return;
      } finally {
        setPreparing(false);
      }
    }
    const names = [...attached, ...files.map((f) => f.name)];
    const message = v || (names.length === 1 ? `Read ${names[0]} with me.` : `Read these with me: ${names.join(', ')}.`);
    setText('');
    setAttachments([]);
    stick.current = true;
    void sendToChip(message, mode, { files, attached });
  };

  const addFiles = (picked: File[]) => {
    const most = me?.tier === 'pro' ? 10 : 3;
    const all = [...attachments, ...picked];
    if (all.length > most) toast(`Up to ${most} files at once${me?.tier === 'pro' ? '' : ' (10 with Pro)'}.`, 'info');
    setAttachments(all.slice(0, most));
  };

  const openThread = async (id: string | null) => {
    if (streaming) return;
    if (!id) return useWorkspace.setState({ thread: null, messages: [] });
    try {
      const all = await listMessages(id);
      useWorkspace.setState({ thread: id, messages: all.map((m) => ({ ...m })) });
    } catch (e) {
      toast((e as Error).message, 'warn');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <Orb size={28} state={streaming ? 'thinking' : 'idle'} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] font-semibold leading-tight">Chip</p>
          <p className="truncate text-xs text-ink-3">{time ? describe(time).replace(' messages', '') : 'Your tutor'}</p>
        </div>
        <ModelSwitch />
        <Menu label="Your chats with Chip" button={<History size={17} />}>
          {(close) => (
            <div className="max-h-80 w-64 overflow-y-auto">
              <MenuItem icon={<Plus size={15} />} onClick={() => (close(), void openThread(null))}>
                New chat
              </MenuItem>
              {threads.length > 0 && <div className="my-1 h-px bg-line" />}
              {threads.map((t) => (
                <MenuItem key={t.id} onClick={() => (close(), void openThread(t.id))}>
                  <span className={`block truncate ${t.id === thread ? 'text-iris-2' : ''}`}>{t.title || 'A chat'}</span>
                  <span className="block text-xs font-normal text-ink-4">{ago(t.updated_at)}</span>
                </MenuItem>
              ))}
              {thread && (
                <>
                  <div className="my-1 h-px bg-line" />
                  <MenuItem
                    icon={<Trash2 size={15} />}
                    danger
                    onClick={async () => {
                      close();
                      try {
                        await deleteThread(thread);
                        useWorkspace.setState((s) => ({ threads: s.threads.filter((t) => t.id !== thread), thread: null, messages: [] }));
                        toast('Chat cleared. Your AI-use record keeps what happened.', 'info');
                      } catch (e) {
                        toast((e as Error).message, 'warn');
                      }
                    }}
                  >
                    Clear this chat
                  </MenuItem>
                </>
              )}
            </div>
          )}
        </Menu>
        {onClose && (
          <button className="icon-btn" aria-label="Close Chip" onClick={onClose}>
            <X size={18} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 pb-3" role="tablist" aria-label="What Chip does">
        {MODES.map((m) => (
          <button
            key={m.mode}
            role="tab"
            aria-selected={m.mode === mode}
            onClick={() => useWorkspace.setState({ mode: m.mode })}
            className={`flex h-8 flex-none items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-semibold transition-all ${m.mode === mode ? 'bg-ink text-white shadow-sm' : 'bg-white/80 text-ink-2 ring-1 ring-line hover:text-ink'}`}
          >
            {m.icon}
            {m.short}
          </button>
        ))}
      </div>

      <div
        ref={scroller}
        className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 pb-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <Welcome mode={current} kind={kind} onTry={(t) => send(t)} />
        ) : (
          <div className="space-y-5 pt-1">
            {messages.map((m, i) => (
              <MessageView key={m.id} message={m} last={i === messages.length - 1} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-line/80 bg-white/70 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur">
        {selection && (
          <button
            className={`mb-2 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-xs transition-colors ${attach ? 'bg-iris-soft text-iris-2' : 'bg-paper text-ink-3 hover:text-ink'}`}
            onClick={() => useWorkspace.setState({ attachSelection: !attach })}
            aria-pressed={attach}
          >
            <span className="font-semibold">{attach ? 'Asking about:' : 'Ask about your selection?'}</span>
            <span className="min-w-0 flex-1 truncate italic">“{selection.slice(0, 120)}”</span>
            {attach && <X size={13} />}
          </button>
        )}
        {attachments.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached files">
            {attachments.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex max-w-full items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink-2">
                {f.type.startsWith('image/') ? <ImageIcon size={13} className="flex-none text-iris" /> : <FileText size={13} className="flex-none text-iris" />}
                <span className="min-w-0 truncate">{f.name}</span>
                <button className="-mr-1 grid h-5 w-5 flex-none place-items-center rounded-full text-ink-4 hover:bg-paper hover:text-ink" onClick={() => setAttachments((all) => all.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-white px-3 py-2 shadow-[var(--shadow-soft)] focus-within:border-iris/40">
          <button
            className="mb-0.5 grid h-8 w-8 flex-none place-items-center rounded-full text-ink-3 transition-colors hover:bg-iris-soft hover:text-iris disabled:opacity-40"
            onClick={() => picker.current?.click()}
            disabled={streaming || preparing}
            aria-label="Attach files"
            title="Attach files for Chip to read with you: PDFs, Word, text or photos"
          >
            {preparing ? <Spinner size={15} /> : <Plus size={19} />}
          </button>
          <input
            ref={picker}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (picked.length) addFiles(picked);
            }}
          />
          <AutoTextarea
            value={text}
            onChange={setText}
            maxRows={7}
            placeholder={{ guide: 'What are you working on? Chip will guide you…', explain: 'What should Chip explain?', check: 'Paste or select your work for Chip to check…', quiz: 'What should Chip quiz you on?', plan: 'What should Chip help you plan?', write: 'What are you writing? Select text for feedback.', cite: 'What do you need sources for?' }[mode]}
            className="max-h-48 min-h-6 flex-1 resize-none bg-transparent py-1 text-[0.9375rem] leading-6 outline-none placeholder:text-ink-4"
            aria-label="Message to Chip"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {streaming ? (
            <button className="grid h-9 w-9 flex-none place-items-center rounded-full bg-ink text-white" onClick={stopChip} aria-label="Stop">
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gradient-to-br from-[#7a6eff] to-[#5246e0] text-white shadow-[var(--shadow-glow)] transition-opacity disabled:opacity-30 disabled:shadow-none" onClick={() => void send()} disabled={(!text.trim() && !attachments.length) || preparing} aria-label="Send">
              <ArrowUp size={18} />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-center text-[0.7rem] text-ink-4">Chip can make mistakes. Everything it gives you goes in your AI-use record.</p>
      </div>
    </div>
  );
}

function Welcome({ mode, kind, onTry }: { mode: (typeof MODES)[number]; kind: 'topic' | 'assignment'; onTry: (t: string) => void }) {
  return (
    <motion.div key={mode.mode} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex flex-col items-center px-2 pb-6 pt-6 text-center">
      <Orb size={52} />
      <p className="mt-4 text-lg font-semibold tracking-[-0.01em]">{mode.name}</p>
      <p className="mt-1 max-w-xs text-sm leading-relaxed text-ink-3">{mode.line}</p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {mode.tries[kind].map((t) => (
          <button key={t} className="rounded-2xl border border-line bg-white/80 px-4 py-2.5 text-left text-sm font-medium text-ink-2 transition-all hover:-translate-y-px hover:border-iris/30 hover:text-ink hover:shadow-[var(--shadow-soft)]" onClick={() => onTry(t)}>
            {t}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function ModelSwitch() {
  const me = useAuth((s) => s.me);
  const model = usePrefs((s) => s.model);
  const pro = me?.tier === 'pro';
  const on = pro && model === 'best';
  if (!pro) {
    return (
      <Link to="/app/plan" className="flex h-7 items-center gap-1 rounded-full bg-paper-2 px-2.5 text-xs font-semibold text-ink-3 hover:text-ink" title="Chip’s best model comes with Pro">
        <Zap size={12} /> Fast <Lock size={11} className="ml-0.5 opacity-60" />
      </Link>
    );
  }
  return (
    <button
      className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors ${on ? 'bg-iris-soft text-iris-2' : 'bg-sky-soft text-sky'}`}
      onClick={() => usePrefs.getState().set({ model: on ? 'fast' : 'best' })}
      title={on ? 'Chip’s best model. Switch to Fast to go further.' : 'Chip Fast. Switch to Chip’s best model.'}
    >
      {on ? <Sparkles size={12} /> : <Zap size={12} />} {on ? 'Best' : 'Fast'}
    </button>
  );
}

const MessageView = memo(function MessageView({ message: m, last }: { message: ChatMessage; last: boolean }) {
  if (m.role === 'user') {
    return (
      <div className="flex flex-col items-end">
        {m.meta.files?.length ? (
          <div className="mb-1 flex max-w-[88%] flex-wrap justify-end gap-1">
            {m.meta.files.map((name, i) => (
              <span key={`${name}-${i}`} className="flex max-w-full items-center gap-1 rounded-lg bg-paper px-2 py-0.5 text-xs text-ink-3">
                <Paperclip size={11} className="flex-none" /> <span className="truncate">{name}</span>
              </span>
            ))}
          </div>
        ) : null}
        {m.meta.selection && <p className="mb-1 max-w-[85%] truncate rounded-lg bg-paper px-2.5 py-1 text-xs italic text-ink-3">“{m.meta.selection}”</p>}
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-iris-soft px-3.5 py-2 text-[0.9375rem] leading-relaxed text-ink">{m.content}</div>
      </div>
    );
  }
  return <ChipAnswer message={m} last={last} />;
});

function ChipAnswer({ message: m, last }: { message: ChatMessage; last: boolean }) {
  const parts = useMemo(() => segments(m.content, !!m.streaming), [m.content, m.streaming]);
  const streaming = useWorkspace((s) => s.streaming);
  const waiting = m.streaming && !m.content;
  const lastUser = () => {
    const all = useWorkspace.getState().messages;
    const i = all.findIndex((x) => x.id === m.id);
    for (let j = i - 1; j >= 0; j--) if (all[j].role === 'user') return all[j];
    return null;
  };

  return (
    <div className="chip-answer">
      {m.note && <p className="mb-2 rounded-xl bg-sky-soft px-3 py-1.5 text-xs text-[#1f6d9e]">{m.note}</p>}
      {waiting && (
        <div className="flex items-center gap-2.5 py-1 text-sm text-ink-3">
          <span className="thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="min-w-0 flex-1 truncate">{m.searching ? 'Searching the web…' : m.think ? m.think.split(/(?<=[.!?])\s/).pop() : 'Thinking…'}</span>
        </div>
      )}
      {m.searching && m.content && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-sky">
          <Globe size={12} /> Searching the web…
        </p>
      )}
      <div className="space-y-3">
        {parts.map((p, i) => {
          switch (p.kind) {
            case 'md':
              return <Markdown key={i} text={p.text} caret={!!m.streaming && i === parts.length - 1} />;
            case 'draft':
              return <DraftCard key={i} text={p.text} done={p.done && !m.streaming} messageId={m.id} />;
            case 'tasks':
              return <TasksCard key={i} tasks={p.tasks} messageId={m.id} />;
            case 'quiz':
              return <QuizCard key={i} questions={p.questions} onAgain={() => void sendToChip('Another quiz, please: a little harder this time.', 'quiz')} />;
            case 'cards':
              return <CardsCard key={i} cards={p.cards} />;
            case 'rubric':
              return <RubricCard key={i} criteria={p.criteria} overall={p.overall} />;
            case 'sources':
              return <SourcesCard key={i} sources={p.sources} messageId={m.id} />;
            case 'pending':
              return <PendingCard key={i} block={p.block} />;
          }
        })}
      </div>
      {m.error && (
        <div className="mt-2 rounded-2xl bg-peach-soft px-3.5 py-2.5 text-sm text-[#9a4a1b]">
          {m.error}
          {m.refused?.resetsAt && <span> Back {when(new Date(m.refused.resetsAt))}.</span>}
          {m.refused && m.refused.why !== 'account' && useAuth.getState().me?.tier !== 'pro' && (
            <Link to="/app/plan" className="ml-1 font-semibold underline">
              More with Pro
            </Link>
          )}
        </div>
      )}
      {m.meta.stopped && <p className="mt-1 text-xs text-ink-4">Stopped.</p>}
      {m.meta.cut && <p className="mt-1 text-xs text-ink-4">That ran long, so it stops there. Ask Chip to carry on.</p>}
      {!m.streaming && (m.content || m.error) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-0.5 text-ink-4">
          {m.content && (
            <button
              className="icon-btn h-7 w-7"
              aria-label="Copy"
              title="Copy"
              onClick={() => {
                void navigator.clipboard?.writeText(plainAnswer(m.content));
                toast('Copied.', 'info');
              }}
            >
              <ClipboardCopy size={14} />
            </button>
          )}
          {last && !streaming && (
            <button
              className="icon-btn h-7 w-7"
              aria-label="Try again"
              title="Try again"
              onClick={() => {
                const u = lastUser();
                if (u) void sendToChip(u.content, u.mode, { again: true, selection: u.meta.selection });
              }}
            >
              <RotateCcw size={14} />
            </button>
          )}
          {last && !streaming && (m.mode === 'explain' || m.mode === 'guide') && m.content && (
            <button className="ml-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold text-iris hover:bg-iris-soft" onClick={() => void sendToChip('Check my understanding of that with three quick questions.', 'explain')}>
              Check my understanding
            </button>
          )}
          {last && !streaming && m.mode === 'guide' && m.content && (
            <button className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold text-ink-3 hover:bg-paper-2 hover:text-ink" onClick={() => void sendToChip('Just explain it to me now, step by step.', 'explain')}>
              Just explain it
            </button>
          )}
          {m.meta.kind && <span className="ml-auto whitespace-nowrap text-[0.7rem]">{m.meta.kind === 'best' ? 'Chip’s best' : 'Chip Fast'}</span>}
        </div>
      )}
    </div>
  );
}

const Markdown = memo(function Markdown({ text, caret }: { text: string; caret: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`chip-md ${caret ? 'is-streaming' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
});
