import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Check, Flag, Plus, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Ring } from '../../components/ui.tsx';
import { addTasks, deleteTask, updateTask } from '../../lib/api.ts';
import { dayLabel, daysBetween, dueLabel, fromDay } from '../../lib/dates.ts';
import { TONE_STYLES } from '../../lib/colors.ts';
import type { Task } from '../../lib/types.ts';
import { toast } from '../../store/toast.ts';
import { useWorkspace } from '../store.ts';

const ease = [0.2, 0.7, 0.1, 1] as const;

/** The plan: tasks on a timeline to the due date, ticked off as you go. */
export function TasksPanel({ onPlan }: { onPlan: () => void }) {
  const assignment = useWorkspace((s) => s.assignment)!;
  const tasks = useWorkspace((s) => s.tasks);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [showDone, setShowDone] = useState(false);
  const now = new Date();
  const done = tasks.filter((t) => t.done);
  const open = tasks.filter((t) => !t.done).sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || a.sort - b.sort);

  const groups: { name: string; items: Task[] }[] = [];
  const put = (name: string, t: Task) => {
    const g = groups.find((x) => x.name === name);
    if (g) g.items.push(t);
    else groups.push({ name, items: [t] });
  };
  for (const t of open) {
    if (!t.due_on) put('Whenever', t);
    else {
      const days = daysBetween(now, fromDay(t.due_on));
      put(days < 0 ? 'Behind' : days === 0 ? 'Today' : days <= 7 ? 'This week' : 'Later', t);
    }
  }
  const order = ['Behind', 'Today', 'This week', 'Later', 'Whenever'];
  groups.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  const set = (patch: Partial<Task> & { id: string }) => useWorkspace.setState({ tasks: useWorkspace.getState().tasks.map((t) => (t.id === patch.id ? { ...t, ...patch } : t)) });

  const save = async (t: Task, patch: Partial<Pick<Task, 'title' | 'due_on' | 'done'>>) => {
    set({ id: t.id, ...patch });
    try {
      const next = await updateTask(t.id, patch);
      set(next);
    } catch (e) {
      set(t);
      toast((e as Error).message, 'warn');
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const [t] = await addTasks(assignment.id, [{ title: title.trim(), due: due || null }], 'me', tasks.length);
      useWorkspace.setState({ tasks: [...useWorkspace.getState().tasks, t] });
      setTitle('');
      setDue('');
    } catch (err) {
      toast((err as Error).message, 'warn');
    }
  };

  const handIn = dueLabel(assignment.due_at, now);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-line px-4 py-4">
        <Ring value={tasks.length ? done.length / tasks.length : 0} size={48} stroke={5} color="var(--color-mint)">
          <span className="text-xs font-bold text-ink-2">{tasks.length ? Math.round((done.length / tasks.length) * 100) : 0}%</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {done.length} of {tasks.length} done
          </p>
          <p className="text-sm text-ink-3">{handIn.text}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onPlan}>
          <Sparkles size={15} className="text-iris" /> Plan with Chip
        </button>
      </div>

      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <form onSubmit={add} className="flex gap-2">
          <input className="field h-10 flex-1 py-0" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New task" />
          <label className="relative grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-xl border border-line bg-white text-ink-3 hover:text-ink" title="Due date">
            <CalendarDays size={17} />
            <input type="date" className="absolute inset-0 cursor-pointer opacity-0" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Task due date" />
            {due && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-iris" />}
          </label>
          <button className="btn btn-primary btn-sm h-10 w-10 p-0" aria-label="Add task" disabled={!title.trim()}>
            <Plus size={18} />
          </button>
        </form>

        {tasks.length === 0 && (
          <p className="mt-6 rounded-3xl bg-paper/70 px-5 py-6 text-center text-sm leading-relaxed text-ink-3">
            Break the work into small steps with dates, or ask Chip to plan it with you to the due date.
          </p>
        )}

        <ol className="relative mt-5">
          {groups.map((g) => (
            <li key={g.name} className="mb-5">
              <p className={`mb-2 text-xs font-semibold uppercase tracking-[0.08em] ${g.name === 'Behind' ? 'text-rose' : 'text-ink-3'}`}>{g.name}</p>
              <ul className="relative space-y-1 border-l-2 border-line pl-4">
                <AnimatePresence initial={false}>
                  {g.items.map((t) => (
                    <TaskRow key={t.id} task={t} onSave={save} />
                  ))}
                </AnimatePresence>
              </ul>
            </li>
          ))}
          {assignment.due_at && (
            <li className="flex items-center gap-3 rounded-2xl bg-iris-soft/60 px-3 py-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-iris">
                <Flag size={14} />
              </span>
              <span className="flex-1 text-sm font-semibold">Hand it in</span>
              <span className={`chip-tag ${TONE_STYLES[handIn.tone]}`}>{new Date(assignment.due_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
            </li>
          )}
        </ol>

        {done.length > 0 && (
          <div className="mt-6">
            <button className="text-sm font-semibold text-ink-3 hover:text-ink" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Hide' : 'Show'} {done.length} done
            </button>
            {showDone && (
              <ul className="mt-2 space-y-1">
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} onSave={save} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, onSave }: { task: Task; onSave: (t: Task, patch: Partial<Pick<Task, 'title' | 'due_on' | 'done'>>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const d = dayLabel(task.due_on);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease }}
      className="group relative flex items-center gap-2.5 rounded-xl py-1.5 pr-1"
    >
      <span className="absolute -left-[1.3rem] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border-2 border-white bg-line-2" aria-hidden="true" />
      <button
        className={`grid h-5 w-5 flex-none place-items-center rounded-full border-2 transition-all ${task.done ? 'border-mint bg-mint text-white' : 'border-line-2 hover:border-mint'}`}
        onClick={() => void onSave(task, { done: !task.done })}
        aria-label={task.done ? `Not done: ${task.title}` : `Done: ${task.title}`}
        aria-pressed={task.done}
      >
        {task.done && <Check size={12} strokeWidth={3} />}
      </button>
      {editing ? (
        <input
          className="field h-8 flex-1 px-2 py-0 text-sm"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (title.trim() && title.trim() !== task.title) void onSave(task, { title: title.trim() });
            else setTitle(task.title);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setTitle(task.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button className={`min-w-0 flex-1 text-left text-sm ${task.done ? 'text-ink-4 line-through' : 'text-ink'}`} onClick={() => setEditing(true)}>
          {task.title}
          {task.created_by === 'chip' && <Sparkles size={11} className="ml-1.5 inline text-iris/60" aria-label="Suggested by Chip" />}
        </button>
      )}
      <label className={`relative cursor-pointer ${d.text ? `chip-tag ${TONE_STYLES[d.tone]}` : 'grid h-6 w-6 place-items-center rounded-lg text-ink-4 opacity-0 group-hover:opacity-100'}`}>
        {d.text || <CalendarDays size={13} />}
        <input type="date" className="absolute inset-0 cursor-pointer opacity-0" value={task.due_on ?? ''} onChange={(e) => void onSave(task, { due_on: e.target.value || null })} aria-label={`Date for ${task.title}`} />
      </label>
      <button
        className="grid h-6 w-6 place-items-center rounded-lg text-ink-4 opacity-0 hover:text-rose group-hover:opacity-100 focus:opacity-100"
        aria-label={`Delete ${task.title}`}
        onClick={async () => {
          try {
            await deleteTask(task.id);
            useWorkspace.setState({ tasks: useWorkspace.getState().tasks.filter((t) => t.id !== task.id) });
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      >
        <X size={14} />
      </button>
    </motion.li>
  );
}
