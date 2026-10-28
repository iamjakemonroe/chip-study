import { Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AutoTextarea } from '../../components/ui.tsx';
import { addNote, deleteNote, updateNote } from '../../lib/api.ts';
import { ago } from '../../lib/dates.ts';
import type { Note } from '../../lib/types.ts';
import { toast } from '../../store/toast.ts';
import { useWorkspace } from '../store.ts';

/** Quick notes for the assignment: ideas, quotes, things to ask. */
export function NotesPanel() {
  const assignment = useWorkspace((s) => s.assignment)!;
  const notes = useWorkspace((s) => s.notes);
  const [text, setText] = useState('');
  const sorted = [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
  const set = (n: Note) => useWorkspace.setState({ notes: useWorkspace.getState().notes.map((x) => (x.id === n.id ? n : x)) });

  return (
    <div className="scroll-soft h-full overflow-y-auto px-4 py-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          try {
            const n = await addNote(assignment.id, text.trim());
            useWorkspace.setState({ notes: [n, ...useWorkspace.getState().notes] });
            setText('');
          } catch (err) {
            toast((err as Error).message, 'warn');
          }
        }}
        className="rounded-2xl border border-line bg-white p-2 focus-within:border-iris/50 focus-within:shadow-[0_0_0_4px_rgb(100_87_240/0.1)]"
      >
        <AutoTextarea value={text} onChange={setText} placeholder="Jot something down…" className="w-full resize-none bg-transparent px-2 py-1.5 text-[0.9375rem] outline-none" aria-label="New note" />
        <div className="flex justify-end">
          <button className="btn btn-primary btn-sm h-8" disabled={!text.trim()}>
            <Plus size={15} /> Add note
          </button>
        </div>
      </form>
      {sorted.length === 0 && <p className="mt-6 text-center text-sm text-ink-3">Your notes for this assignment live here.</p>}
      <ul className="mt-4 space-y-3">
        {sorted.map((n) => (
          <NoteCard key={n.id} note={n} onChange={set} />
        ))}
      </ul>
    </div>
  );
}

function NoteCard({ note, onChange }: { note: Note; onChange: (n: Note) => void }) {
  const [body, setBody] = useState(note.body);
  return (
    <li className={`group rounded-2xl border p-3 ${note.pinned ? 'border-sand/40 bg-sand-soft/60' : 'border-line bg-white'}`}>
      <AutoTextarea
        value={body}
        onChange={setBody}
        maxRows={14}
        className="w-full resize-none bg-transparent text-[0.9375rem] leading-relaxed outline-none"
        aria-label="Note"
        onBlur={async () => {
          if (body === note.body) return;
          try {
            await updateNote(note.id, { body });
            onChange({ ...note, body });
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
      <div className="mt-1 flex items-center gap-1">
        <span className="flex-1 text-xs text-ink-4">{ago(note.created_at)}</span>
        <button
          className="icon-btn h-7 w-7"
          aria-label={note.pinned ? 'Unpin' : 'Pin'}
          onClick={async () => {
            try {
              await updateNote(note.id, { pinned: !note.pinned });
              onChange({ ...note, pinned: !note.pinned });
            } catch (e) {
              toast((e as Error).message, 'warn');
            }
          }}
        >
          {note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
        <button
          className="icon-btn h-7 w-7 hover:text-rose"
          aria-label="Delete note"
          onClick={async () => {
            try {
              await deleteNote(note.id);
              useWorkspace.setState({ notes: useWorkspace.getState().notes.filter((x) => x.id !== note.id) });
            } catch (e) {
              toast((e as Error).message, 'warn');
            }
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}
