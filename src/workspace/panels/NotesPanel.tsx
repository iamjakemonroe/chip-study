import { Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { mapIndex } from '../../lib/textEdit.ts';
import { AutoTextarea } from '../../components/ui.tsx';
import { addNote, deleteNote, updateNote } from '../../lib/api.ts';
import { ago } from '../../lib/dates.ts';
import type { Note } from '../../lib/types.ts';
import { toast } from '../../store/toast.ts';
import { useRoomBinding } from '../roomBinding.ts';
import { useWorkspace } from '../store.ts';

/** Quick notes for the assignment: ideas, quotes, things to ask. In a study room they're the
 * room's shared notes. */
export function NotesPanel() {
  const assignment = useWorkspace((s) => s.assignment)!;
  const notes = useWorkspace((s) => s.notes);
  const room = useRoomBinding();
  const canEdit = room ? room.canEdit : true;
  const [text, setText] = useState('');
  const sorted = [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
  const set = (n: Note) => useWorkspace.setState({ notes: useWorkspace.getState().notes.map((x) => (x.id === n.id ? n : x)) });

  return (
    <div className="scroll-soft h-full overflow-y-auto px-4 py-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          if (room) {
            room.lists.addNote(text.trim());
            setText('');
            return;
          }
          try {
            const n = await addNote(assignment.id, text.trim());
            useWorkspace.setState({ notes: [n, ...useWorkspace.getState().notes] });
            setText('');
          } catch (err) {
            toast((err as Error).message, 'warn');
          }
        }}
        className={`rounded-2xl border border-line bg-white p-2 focus-within:border-iris/50 focus-within:shadow-[0_0_0_4px_rgb(100_87_240/0.1)] ${canEdit ? '' : 'hidden'}`}
      >
        <AutoTextarea value={text} onChange={setText} placeholder="Jot something down…" className="w-full resize-none bg-transparent px-2 py-1.5 text-[0.9375rem] outline-none" aria-label="New note" />
        <div className="flex justify-end">
          <button className="btn btn-primary btn-sm h-8" disabled={!text.trim()}>
            <Plus size={15} /> Add note
          </button>
        </div>
      </form>
      {sorted.length === 0 && <p className="mt-6 text-center text-sm text-ink-3">{room ? 'The room’s shared notes live here.' : 'Your notes for this assignment live here.'}</p>}
      <ul className="mt-4 space-y-3">
        {sorted.map((n) => (
          <NoteCard key={n.id} note={n} onChange={set} />
        ))}
      </ul>
    </div>
  );
}

function NoteCard({ note, onChange }: { note: Note; onChange: (n: Note) => void }) {
  const room = useRoomBinding();
  const canEdit = room ? room.canEdit : true;
  const [body, setBody] = useState(note.body);
  const field = useRef<HTMLTextAreaElement | null>(null);
  // In a room the note is shared: everyone's typing shows as it happens (your caret stays where it
  // was), and each change you make goes in as an edit, merged with theirs.
  useEffect(() => {
    if (!room) return;
    setBody((shown) => {
      if (shown === note.body) return shown;
      const el = field.current;
      if (el && document.activeElement === el) {
        const [a, b] = [el.selectionStart, el.selectionEnd];
        requestAnimationFrame(() => el.setSelectionRange(mapIndex(shown, note.body, a), mapIndex(shown, note.body, b)));
      }
      return note.body;
    });
  }, [note.body]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <li className={`group rounded-2xl border p-3 ${note.pinned ? 'border-sand/40 bg-sand-soft/60' : 'border-line bg-white'}`}>
      <AutoTextarea
        value={body}
        onChange={(next) => {
          if (room) room.lists.editNoteBody(note.id, body, next);
          setBody(next);
        }}
        maxRows={14}
        className="w-full resize-none bg-transparent text-[0.9375rem] leading-relaxed outline-none"
        aria-label="Note"
        readOnly={!canEdit}
        onFocus={(e) => (field.current = e.currentTarget)}
        onBlur={async () => {
          if (room || body === note.body) return;
          try {
            await updateNote(note.id, { body });
            onChange({ ...note, body });
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
      <div className="mt-1 flex items-center gap-1">
        <span className="flex-1 text-xs text-ink-4">{note.created_at ? ago(note.created_at) : ''}</span>
        {canEdit && <button
          className="icon-btn h-7 w-7"
          aria-label={note.pinned ? 'Unpin' : 'Pin'}
          onClick={async () => {
            if (room) return room.lists.updateNote(note.id, { pinned: !note.pinned });
            try {
              await updateNote(note.id, { pinned: !note.pinned });
              onChange({ ...note, pinned: !note.pinned });
            } catch (e) {
              toast((e as Error).message, 'warn');
            }
          }}
        >
          {note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>}
        {canEdit && <button
          className="icon-btn h-7 w-7 hover:text-rose"
          aria-label="Delete note"
          onClick={async () => {
            if (room) return room.lists.removeNote(note.id);
            try {
              await deleteNote(note.id);
              useWorkspace.setState({ notes: useWorkspace.getState().notes.filter((x) => x.id !== note.id) });
            } catch (e) {
              toast((e as Error).message, 'warn');
            }
          }}
        >
          <Trash2 size={14} />
        </button>}
      </div>
    </li>
  );
}
