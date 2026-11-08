import { Brain, ClipboardCheck, Lightbulb } from 'lucide-react';
import { renderMarkdown } from '../../lib/markdown.ts';
import { useWorkspace } from '../../workspace/store.ts';
import { roomSession } from '../session.ts';

/** The brief and rubric of the room's assignment, to read together (the host changes them on their
 * own assignment, outside the room). */
export function RoomBrief() {
  const a = useWorkspace((s) => s.assignment);
  if (!a) return null;
  const topic = a.kind === 'topic';
  const ask = (mode: 'explain' | 'check' | 'quiz', text: string) => void roomSession()?.askChip(mode, text);
  return (
    <div className="scroll-soft h-full overflow-y-auto px-4 py-4">
      <div className="flex flex-wrap gap-2">
        {topic ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => ask('explain', 'Give us the big picture of this: the key ideas and how they connect, step by step.')}>
              <Lightbulb size={15} className="text-sand" /> The big picture
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => ask('quiz', 'Quiz us to see what we already know about this.')}>
              <Brain size={15} className="text-lilac" /> What do we know already?
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => ask('explain', 'Explain this brief in plain words: what it’s really asking, what a great answer does, and the traps to avoid.')}>
              <Lightbulb size={15} className="text-sand" /> Explain the brief
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => ask('check', 'Check our document against the rubric.')} disabled={!a.rubric.trim()}>
              <ClipboardCheck size={15} className="text-mint" /> Check against the rubric
            </button>
          </>
        )}
      </div>
      <h3 className="mt-5 text-lg font-semibold leading-snug tracking-[-0.01em]">{a.title}</h3>
      <p className="mt-1 text-sm text-ink-3">
        {[
          a.course,
          a.due_at ? `${topic ? 'By' : 'Due'} ${new Date(a.due_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` : '',
          a.word_target && !topic ? `${a.word_target.toLocaleString()} words` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <section className="mt-5">
        <p className="label">{topic ? 'About it' : 'The brief'}</p>
        {a.brief.trim() ? (
          <div className="chip-md rounded-2xl border border-line bg-white px-4 py-3 text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.brief) }} />
        ) : (
          <p className="text-sm text-ink-3">No brief yet.</p>
        )}
      </section>
      {!topic && (
        <section className="mt-5">
          <p className="label">The rubric</p>
          {a.rubric.trim() ? (
            <div className="chip-md rounded-2xl border border-line bg-white px-4 py-3 text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.rubric) }} />
          ) : (
            <p className="text-sm text-ink-3">No rubric yet.</p>
          )}
        </section>
      )}
      <p className="mt-6 text-xs leading-relaxed text-ink-4">The host can change these on their assignment, outside the room.</p>
    </div>
  );
}
