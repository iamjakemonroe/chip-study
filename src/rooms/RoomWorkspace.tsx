import { Check, ChevronDown, Code2, Eye, Loader2, PenLine, Plus, Table2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Menu, MenuItem, Modal } from '../components/ui.tsx';
import type { DocKind, Mode, StudyDocument } from '../lib/types.ts';
import NewCodeFile from '../workspace/code/NewCodeFile.tsx';
import { DocEditor } from '../workspace/DocEditor.tsx';
import { useRoomBinding } from '../workspace/roomBinding.ts';
import { useWorkspace } from '../workspace/store.ts';
import { roomSession } from './session.ts';
import { useRoom } from './store.ts';

const CodeDoc = lazy(() => import('../workspace/CodeDoc.tsx'));
const SheetDoc = lazy(() => import('../workspace/SheetDoc.tsx'));

/** The shared work in the middle of the room: the assignment's documents as tabs, each bound live to
 * the room's shared document, edited together with everyone's cursors (read-only for anyone who
 * can't edit). */
export function RoomWorkspace() {
  const docs = useWorkspace((s) => s.docs);
  const activeDoc = useWorkspace((s) => s.activeDoc);
  const seeded = useRoom((s) => s.seeded);
  const people = useRoom((s) => s.people);
  const binding = useRoomBinding();
  const doc = docs.find((d) => d.id === activeDoc) ?? docs[0];

  if (!binding) return null;
  if (!seeded) {
    const editorHere = people.some((p) => p.connected && (p.canEdit || p.role !== 'member'));
    return (
      <div className="grid h-full place-items-center px-6 text-center" role="status">
        <div className="max-w-sm">
          {binding.canEdit || editorHere ? (
            <>
              <Loader2 size={28} className="mx-auto animate-spin text-iris" />
              <p className="mt-4 font-semibold">Setting up the shared work…</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-3">The assignment’s documents, notes and plan are on their way.</p>
            </>
          ) : (
            <>
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-iris-soft text-iris">
                <Eye size={22} />
              </span>
              <p className="mt-4 font-semibold">Waiting for someone who can edit</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-3">The shared work opens when the host or someone who can edit joins. You can talk and chat meanwhile.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const ask = (mode: Mode, text: string, selection?: string) => binding.askChip(mode, text, selection);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RoomTabs />
      <div className="ws-doc">
        {!doc ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="font-semibold">No documents in this room yet</p>
              <p className="mt-1 text-sm text-ink-3">{binding.canEdit ? 'Add one with the + above.' : 'Someone who can edit can add one.'}</p>
            </div>
          </div>
        ) : doc.kind === 'doc' ? (
          <DocEditor
            key={`${doc.id}:${binding.key}`}
            doc={doc}
            onAskChip={(mode, selection) =>
              ask(
                mode,
                mode === 'write'
                  ? 'Give us feedback on this, and show how to make it clearer and stronger in our own voice.'
                  : mode === 'check'
                    ? 'Check this: what’s right, what’s wrong, and why?'
                    : 'Explain this, and check we’ve understood it right.',
                selection,
              )
            }
          />
        ) : (
          <Suspense fallback={<ChipLoader page={false} size={44} label="" />}>
            {doc.kind === 'code' ? (
              <CodeDoc key={`${doc.id}:${binding.key}`} doc={doc} onAskChip={(text) => ask('explain', text, useWorkspace.getState().selection || undefined)} />
            ) : (
              <SheetDoc key={`${doc.id}:${binding.key}`} doc={doc} />
            )}
          </Suspense>
        )}
      </div>
      {doc?.kind === 'doc' && <Words />}
    </div>
  );
}

function Words() {
  const words = useWorkspace((s) => s.words);
  const target = useWorkspace((s) => s.assignment?.word_target ?? null);
  return (
    <div className="ws-status">
      <span className="tabular-nums">
        <strong className="font-semibold text-ink-2">{words.toLocaleString()}</strong>
        {target ? ` / ${target.toLocaleString()}` : ''} words
      </span>
      <span className="hidden text-ink-4 sm:inline">· Saved to the host’s assignment as you go</span>
    </div>
  );
}

function RoomTabs() {
  const docs = useWorkspace((s) => s.docs);
  const active = useWorkspace((s) => s.activeDoc);
  const binding = useRoomBinding();
  const [renaming, setRenaming] = useState<StudyDocument | null>(null);
  const [name, setName] = useState('');
  const [newCode, setNewCode] = useState(false);
  const canEdit = !!binding?.canEdit;

  const add = (kind: DocKind) => {
    const title = kind === 'sheet' ? 'Table' : `Document ${docs.filter((d) => d.kind === 'doc').length + 1}`;
    roomSession()?.addDocument(kind, title);
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
            {d.id === active && canEdit && (
              <Menu label={`More for ${d.title}`} button={<ChevronDown size={14} />} align="left" className="-mr-1">
                {(close) => <MenuItem onClick={() => (close(), setName(d.title), setRenaming(d))}>Rename</MenuItem>}
              </Menu>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <Menu label="Add a tab" button={<Plus size={17} />} align="left">
          {(close) => (
            <>
              <MenuItem icon={<PenLine size={15} />} onClick={() => (close(), add('doc'))}>
                Document
              </MenuItem>
              <MenuItem icon={<Code2 size={15} />} onClick={() => (close(), setNewCode(true))}>
                Code
              </MenuItem>
              <MenuItem icon={<Table2 size={15} />} onClick={() => (close(), add('sheet'))}>
                Table with formulas
              </MenuItem>
            </>
          )}
        </Menu>
      )}
      <NewCodeFile
        open={newCode}
        onClose={() => setNewCode(false)}
        taken={docs.map((d) => d.title)}
        onCreate={async (files) => {
          for (const f of files) roomSession()?.addDocument('code', f.name, f.lang, f.code);
        }}
      />
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename" width={420}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!renaming || !name.trim()) return;
            binding?.rename(renaming.id, name.trim());
            setRenaming(null);
          }}
        >
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Name" />
          <div className="mt-4 flex justify-end">
            <button className="btn btn-primary btn-sm">
              <Check size={15} /> Save
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
