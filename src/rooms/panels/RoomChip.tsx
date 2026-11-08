import { ArrowUp, BookMarked, Check, ClipboardCopy, GraduationCap, ListPlus, Replace, ShieldAlert, ShieldCheck, Square, TextCursorInput, X } from 'lucide-react';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Orb } from '../../components/Orb.tsx';
import { AutoTextarea, Spinner } from '../../components/ui.tsx';
import { plainAnswer, segments, type PlanTask, type SuggestedSource } from '../../lib/blocks.ts';
import { html, reference } from '../../lib/citations.ts';
import { markdownToEditorHtml, renderMarkdown } from '../../lib/markdown.ts';
import { toast } from '../../store/toast.ts';
import { CardsCard, PendingCard, QuizCard, RubricCard } from '../../workspace/chip/cards.tsx';
import { MODES, ModelSwitch } from '../../workspace/chip/ChipPanel.tsx';
import { insertFromChip } from '../../workspace/extensions.ts';
import { useRoomBinding } from '../../workspace/roomBinding.ts';
import { editors, useWorkspace } from '../../workspace/store.ts';
import { roomLogUse } from '../api.ts';
import { colorFor, initials } from '../people.ts';
import { roomSession } from '../session.ts';
import { useRoom, type ShownChip } from '../store.ts';

/** The room's one Chip: everyone sees the same conversation. Whoever asks uses their own Chip time,
 * and their question is noted on the host's assignment with their name. Only people who can edit
 * can put Chip's words into the shared work, and that's noted in the record too. */
export function RoomChip() {
  const chip = useRoom((s) => s.chip);
  const tutor = useRoom((s) => s.tutor);
  const connection = useRoom((s) => s.connection);
  const you = useRoom((s) => s.you);
  const mode = useWorkspace((s) => s.mode);
  const selection = useWorkspace((s) => s.selection);
  const attach = useWorkspace((s) => s.attachSelection);
  const kind = useWorkspace((s) => s.assignment?.kind ?? 'assignment');
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const mine = chip.find((c) => c.local);
  const current = MODES.find((m) => m.mode === mode)!;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chip]);

  const send = (value = text) => {
    const v = value.trim();
    if (!v || mine) return;
    setText('');
    stick.current = true;
    const sel = attach ? selection : '';
    useWorkspace.setState({ attachSelection: false });
    void roomSession()?.askChip(mode, v, sel || undefined);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <Orb size={28} state={mine ? 'thinking' : 'idle'} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] font-semibold leading-tight">Chip, together</p>
          <p className="truncate text-xs text-ink-3">Everyone here sees this conversation</p>
        </div>
        <ModelSwitch />
      </div>
      {tutor && (
        <p
          className="mx-4 mb-2.5 flex items-center gap-2 rounded-xl bg-mint-soft/70 px-3 py-1.5 text-xs font-medium text-[#16795f]"
          title={
            tutor.help_level === 'hints'
              ? 'Hints and next steps only in this course.'
              : tutor.help_level === 'explain'
                ? 'Explanations and feedback, but no drafting, in this course.'
                : 'Chip helps in its usual way in this course.'
          }
        >
          <GraduationCap size={14} className="flex-none" />
          <span className="min-w-0 truncate">Chip follows {tutor.class}’s guidance</span>
        </p>
      )}
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
        {chip.length === 0 ? (
          <div className="flex flex-col items-center px-2 pb-6 pt-6 text-center">
            <Orb size={52} />
            <p className="mt-4 text-lg font-semibold tracking-[-0.01em]">{current.name}, together</p>
            <p className="mt-1 max-w-xs text-sm leading-relaxed text-ink-3">{current.line}</p>
            <div className="mt-5 flex w-full flex-col gap-2">
              {current.tries[kind].map((t) => (
                <button
                  key={t}
                  className="rounded-2xl border border-line bg-white/80 px-4 py-2.5 text-left text-sm font-medium text-ink-2 transition-all hover:-translate-y-px hover:border-iris/30 hover:text-ink hover:shadow-[var(--shadow-soft)]"
                  onClick={() => send(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5 pt-1">
            {chip.map((e) => (
              <Entry key={e.id} entry={e} mine={e.from.userId === you?.userId} />
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
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-white px-3 py-2 shadow-[var(--shadow-soft)] focus-within:border-iris/40">
          <AutoTextarea
            value={text}
            onChange={setText}
            maxRows={6}
            placeholder={connection === 'live' ? 'Ask Chip, for everyone…' : 'Reconnecting…'}
            className="max-h-44 min-h-6 flex-1 resize-none bg-transparent py-1 text-[0.9375rem] leading-6 outline-none placeholder:text-ink-4"
            aria-label="Message to Chip, for everyone"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          {mine ? (
            <button className="grid h-9 w-9 flex-none place-items-center rounded-full bg-ink text-white" onClick={() => roomSession()?.stopChip()} aria-label="Stop">
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gradient-to-br from-[#7a6eff] to-[#5246e0] text-white shadow-[var(--shadow-glow)] transition-opacity disabled:opacity-30 disabled:shadow-none"
              onClick={() => send()}
              disabled={!text.trim() || connection !== 'live'}
              aria-label="Send"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-center text-[0.7rem] leading-snug text-ink-4">Each question uses the asker’s own Chip time and goes in the host’s AI-use record, with their name.</p>
      </div>
    </div>
  );
}

const Entry = memo(function Entry({ entry: e, mine }: { entry: ShownChip; mine: boolean }) {
  const streaming = !e.done;
  const parts = useMemo(() => segments(e.answer, streaming), [e.answer, streaming]);
  const color = colorFor(e.from.userId);
  return (
    <article className="space-y-2.5" aria-label={`${mine ? 'You' : e.from.name} asked Chip`}>
      <div className="flex flex-col items-end">
        <p className="mb-1 flex items-center gap-1.5 px-1 text-xs text-ink-3">
          <span className="room-avatar h-4 w-4 text-[0.5rem]" style={{ background: color }}>
            {initials(e.from.name)}
          </span>
          <span className="font-semibold text-ink-2">{mine ? 'You' : e.from.name}</span>
          <time dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>
        </p>
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-iris-soft px-3.5 py-2 text-[0.9375rem] leading-relaxed text-ink">{e.question}</div>
      </div>
      <div className="chip-answer">
        {streaming && !e.answer && (
          <div className="flex items-center gap-2.5 py-1 text-sm text-ink-3">
            <span className="thinking-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {mine ? 'Thinking…' : `Chip is answering ${e.from.name}…`}
          </div>
        )}
        <div className="space-y-3">
          {parts.map((p, i) => {
            switch (p.kind) {
              case 'md':
                return <Markdown key={i} text={p.text} caret={streaming && i === parts.length - 1} />;
              case 'draft':
                return <SharedDraft key={i} text={p.text} done={p.done && !streaming} entry={e} />;
              case 'tasks':
                return <SharedTasks key={i} tasks={p.tasks} entry={e} />;
              case 'quiz':
                return <QuizCard key={i} questions={p.questions} onAgain={() => void roomSession()?.askChip('quiz', 'Another quiz, please: a little harder this time.')} />;
              case 'cards':
                return <CardsCard key={i} cards={p.cards} />;
              case 'rubric':
                return <RubricCard key={i} criteria={p.criteria} overall={p.overall} />;
              case 'sources':
                return <SharedSources key={i} sources={p.sources} />;
              case 'pending':
                return <PendingCard key={i} block={p.block} />;
            }
          })}
        </div>
        {e.problem && mine && <p className="mt-2 rounded-2xl bg-peach-soft px-3.5 py-2.5 text-sm text-[#9a4a1b]">{e.problem}</p>}
        {e.stopped && <p className="mt-1 text-xs text-ink-4">{mine ? 'Stopped.' : `Stopped: ${e.from.name} left before Chip finished.`}</p>}
        {e.done && e.answer && (
          <div className="mt-1.5 flex items-center gap-0.5 text-ink-4">
            <button
              className="icon-btn h-7 w-7"
              aria-label="Copy"
              title="Copy"
              onClick={() => {
                void navigator.clipboard?.writeText(plainAnswer(e.answer));
                toast('Copied.', 'info');
              }}
            >
              <ClipboardCopy size={14} />
            </button>
          </div>
        )}
      </div>
    </article>
  );
});

const Markdown = memo(function Markdown({ text, caret }: { text: string; caret: boolean }) {
  const shown = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`chip-md ${caret ? 'is-streaming' : ''}`} dangerouslySetInnerHTML={{ __html: shown }} />;
});

/** The database's id for Chip's message, known on the asker's screen (for the AI-use record). */
const messageOf = (e: ShownChip) => e.messageId ?? null;

/** Text Chip wrote for the document: someone who can edit puts it in the shared work. */
function SharedDraft({ text, done, entry }: { text: string; done: boolean; entry: ShownChip }) {
  const room = useRoomBinding();
  const roomId = useRoom((s) => s.roomId);
  const selection = useWorkspace((s) => s.selection);
  const [put, setPut] = useState<null | 'inserted' | 'replaced'>(null);
  const shown = useMemo(() => renderMarkdown(text), [text]);
  const canEdit = !!room?.canEdit;

  const insert = async () => {
    const editor = editors.doc;
    if (!editor || !roomId || !canEdit) return toast('Open a document in the room to put this in.', 'info');
    const replacing = !editor.state.selection.empty;
    const words = insertFromChip(editor, markdownToEditorHtml(text), messageOf(entry));
    setPut(replacing ? 'replaced' : 'inserted');
    try {
      await roomLogUse(roomId, replacing ? 'replaced' : 'inserted', messageOf(entry), words, text);
    } catch {
      toast('Put in, but it couldn’t be noted in the record. Check your connection.', 'warn');
    }
    toast(`${words} words put in, marked as Chip’s until someone rewrites them.`, 'good');
  };

  return (
    <div className="chip-card border-iris/20 bg-gradient-to-b from-white to-iris-soft/30">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-iris-2">Draft</span>
        {!done && <Spinner size={12} />}
      </div>
      <div className="chip-md px-4 pb-3 pt-1 font-serif text-[1.02rem]" dangerouslySetInnerHTML={{ __html: shown }} />
      {done && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-iris/10 px-3 py-2.5">
          {put ? (
            <span className="flex h-8 items-center gap-1.5 px-2 text-sm font-semibold text-mint">
              <Check size={15} /> {put === 'replaced' ? 'Replaced the selection' : 'In the document'}
            </span>
          ) : canEdit ? (
            <button className="btn btn-iris btn-sm h-8" onClick={() => void insert()}>
              {selection ? <Replace size={14} /> : <TextCursorInput size={14} />} {selection ? 'Replace selection' : 'Put in the document'}
            </button>
          ) : (
            <span className="px-1 text-xs text-ink-3">Only people who can edit can put this in.</span>
          )}
          <button
            className="btn btn-quiet btn-sm h-8"
            onClick={() => {
              void navigator.clipboard?.writeText(text);
              toast('Copied.', 'info');
            }}
          >
            <ClipboardCopy size={14} /> Copy
          </button>
        </div>
      )}
    </div>
  );
}

/** A plan's tasks, for the room's shared plan. */
function SharedTasks({ tasks, entry }: { tasks: PlanTask[]; entry: ShownChip }) {
  const room = useRoomBinding();
  const roomId = useRoom((s) => s.roomId);
  const [added, setAdded] = useState(false);
  const add = () => {
    if (!room?.canEdit || !roomId) return;
    room.lists.addTasks(tasks);
    setAdded(true);
    void roomLogUse(roomId, 'added_tasks', messageOf(entry), 0, tasks.map((t) => t.title).join('\n')).catch(() => undefined);
    toast(`${tasks.length} tasks added to the shared plan.`, 'good');
  };
  return (
    <div className="chip-card">
      <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-mint">A plan</div>
      <ol className="space-y-1.5 px-4 py-3">
        {tasks.map((t, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-mint-soft text-[0.7rem] font-bold text-mint">{i + 1}</span>
            <span className="flex-1 leading-snug">{t.title}</span>
            {t.due && <span className="chip-tag flex-none bg-paper-2 text-ink-3">{new Date(`${t.due}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
          </li>
        ))}
      </ol>
      <div className="border-t border-line px-3 py-2.5">
        {added ? (
          <span className="flex h-8 items-center gap-1.5 px-2 text-sm font-semibold text-mint">
            <Check size={15} /> In the shared plan
          </span>
        ) : room?.canEdit ? (
          <button className="btn btn-primary btn-sm h-8" onClick={add}>
            <ListPlus size={14} /> Add {tasks.length} tasks to the shared plan
          </button>
        ) : (
          <span className="px-1 text-xs text-ink-3">Only people who can edit can add these.</span>
        )}
      </div>
    </div>
  );
}

/** Sources Chip suggests: to read and check (the room's sources are the host's to add). */
function SharedSources({ sources }: { sources: SuggestedSource[] }) {
  const style = useWorkspace((s) => s.assignment?.style ?? 'apa');
  return (
    <div className="chip-card">
      <div className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-sky">
        <BookMarked size={13} /> Sources
      </div>
      <ul className="divide-y divide-line">
        {sources.map((s, i) => (
          <li key={i} className="px-4 py-3">
            <p className="reference text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: html(reference(s.kind, s.data, style)) }} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {s.verified ? (
                <span className="chip-tag bg-mint-soft text-mint">
                  <ShieldCheck size={12} /> Found on the web
                </span>
              ) : (
                <span className="chip-tag bg-sand-soft text-[#8a6a1f]">
                  <ShieldAlert size={12} /> Check this one
                </span>
              )}
              {s.data.url && /^https?:\/\//i.test(s.data.url) && (
                <a className="text-xs font-semibold text-iris hover:underline" href={s.data.url} target="_blank" rel="noopener noreferrer nofollow">
                  Open
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
