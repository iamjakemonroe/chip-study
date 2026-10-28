import type { Editor } from '@tiptap/core';
import { create } from 'zustand';
import type { SaveState } from '../lib/autosave.ts';
import type { Assignment, LogEntry, Message, Mode, Note, Source, StudyDocument, Task, Thread } from '../lib/types.ts';

/** One open assignment: its documents, its plan, sources and notes, the record, and the
 * conversation with Chip. */

export type Panel = 'chip' | 'brief' | 'tasks' | 'sources' | 'notes' | 'record';

export interface ChatMessage extends Omit<Message, 'thread_id' | 'created_at'> {
  /** A message still arriving, what Chip is thinking, whether it's searching. */
  streaming?: boolean;
  think?: string;
  searching?: boolean;
  /** Something went wrong (and why), shown under the message. */
  error?: string;
  refused?: { why: string; resetsAt: string | null };
  /** Chip's note about the model (e.g. best model used up today). */
  note?: string | null;
}

interface WorkspaceState {
  assignment: Assignment | null;
  docs: StudyDocument[];
  activeDoc: string | null;
  tasks: Task[];
  sources: Source[];
  notes: Note[];
  log: LogEntry[];
  threads: Thread[];
  thread: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  mode: Mode;
  /** The text selected in the document (for "ask about this"), and whether it's attached to the
   * next message. */
  selection: string;
  attachSelection: boolean;
  saveState: SaveState;
  words: number;
  chipWords: number;
  panel: Panel | null;
  focusMode: boolean;
  set: (patch: Partial<WorkspaceState>) => void;
  reset: () => void;
}

const empty = {
  assignment: null,
  docs: [],
  activeDoc: null,
  tasks: [],
  sources: [],
  notes: [],
  log: [],
  threads: [],
  thread: null,
  messages: [],
  streaming: false,
  mode: 'guide' as Mode,
  selection: '',
  attachSelection: false,
  saveState: 'saved' as SaveState,
  words: 0,
  chipWords: 0,
  panel: null,
  focusMode: false,
};

export const useWorkspace = create<WorkspaceState>((set) => ({
  ...empty,
  set: (patch) => set(patch),
  reset: () => set(empty),
}));

let liveDoc: Editor | null = null;

/** The rich-text editor of the open document, for Chip to read from and write into. */
export const editors: { doc: Editor | null; text: () => string; pending: string | null } = {
  /** Never one that's been destroyed (a change of document, or React's StrictMode, makes and
   * destroys editors): reading one throws "Cannot read properties of null (reading 'nodes')". */
  get doc() {
    return liveDoc && !liveDoc.isDestroyed ? liveDoc : null;
  },
  set doc(editor: Editor | null) {
    liveDoc = editor;
  },
  /** The active document as plain text (a doc, code, or a table as CSV). */
  text: () => '',
  /** Something to put in the main document when it next opens (a table from the table tool). */
  pending: null,
};
