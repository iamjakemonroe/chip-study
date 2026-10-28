import { BookOpen, FileUp, Globe, ListOrdered, Pencil, Plus, Quote, Search, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Modal, Segmented, Spinner } from '../../components/ui.tsx';
import { addSource, deleteSource, updateAssignment, updateSource } from '../../lib/api.ts';
import { html, inText, KIND_NAMES, reference, referenceList } from '../../lib/citations.ts';
import type { Source, SourceData, SourceKind, Style } from '../../lib/types.ts';
import { addReadings } from '../../lib/readings.ts';
import { useAuth } from '../../store/auth.ts';
import { toast } from '../../store/toast.ts';
import { citedSources } from '../extensions.ts';
import { editors, useWorkspace } from '../store.ts';

/** The assignment's sources: references in APA or Harvard, readings Chip can read with you,
 * citations into the document and the reference list at its end. */
export function SourcesPanel({ onFind }: { onFind: () => void }) {
  const assignment = useWorkspace((s) => s.assignment)!;
  const sources = useWorkspace((s) => s.sources);
  const me = useAuth((s) => s.me);
  const [editing, setEditing] = useState<Source | 'new' | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const style = assignment.style;

  const setStyle = async (next: Style) => {
    useWorkspace.setState({ assignment: { ...assignment, style: next } });
    try {
      await updateAssignment(assignment.id, { style: next });
    } catch (e) {
      useWorkspace.setState({ assignment: { ...assignment, style } });
      toast((e as Error).message, 'warn');
    }
  };

  const addFiles = async (files: File[]) => {
    setReading(true);
    try {
      const added = await addReadings(assignment.id, files, me?.readings.max_chars ?? 60000);
      if (added.length) useWorkspace.setState({ sources: [...useWorkspace.getState().sources, ...added] });
      if (added.length === 1) setEditing(added[0]);
    } finally {
      setReading(false);
    }
  };

  const referenceListIntoDoc = () => {
    const editor = editors.doc;
    if (!editor) return toast('Open your document first.', 'info');
    const cited = citedSources(editor);
    const list = cited.length ? sources.filter((s) => cited.includes(s.id)) : sources;
    if (!list.length) return toast('Add a source first.', 'info');
    const entries = referenceList(list, style).map((r) => `<p>${html(r)}</p>`).join('');
    editor.chain().focus('end').insertContent(`<h2>References</h2>${entries}`).run();
    toast(cited.length ? `Added ${list.length} cited source${list.length === 1 ? '' : 's'}.` : 'Added all your sources (cite them in the text to list only those).', 'good');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <Segmented label="Referencing style" size="sm" value={style} onChange={(v) => void setStyle(v)} options={[{ value: 'apa', label: 'APA 7th' }, { value: 'harvard', label: 'Harvard' }]} />
        <div className="flex gap-1">
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}>
            <Plus size={15} /> Source
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()} disabled={reading} title="Add readings (PDF or Word, several at once) for Chip to read with you">
            {reading ? <Spinner /> : <FileUp size={15} />} Reading
          </button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.txt,.md,application/pdf"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void addFiles(files);
            }}
          />
        </div>
      </div>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {sources.length === 0 ? (
          <div className="rounded-3xl bg-paper/70 px-5 py-8 text-center">
            <BookOpen size={26} className="mx-auto text-ink-4" />
            <p className="mt-3 font-semibold">No sources yet</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-3">Add the books, articles and pages you use, and Chip formats them for you. Add a reading and Chip can read it with you.</p>
            <button className="btn btn-iris btn-sm mt-5" onClick={onFind}>
              <Sparkles size={15} /> Find sources with Chip
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {sources.map((s) => (
              <li key={s.id} className="group rounded-2xl border border-line bg-white p-4">
                <p className="reference text-[0.9375rem] leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: html(reference(s.kind, s.data, style)) }} />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="chip-tag bg-paper-2 text-ink-3">{KIND_NAMES[s.kind]}</span>
                  {s.content && <span className="chip-tag bg-mint-soft text-mint">Reading · {Math.round(s.content.length / 1000)}k characters</span>}
                  {s.created_by === 'chip' && <span className="chip-tag bg-iris-soft text-iris-2">From Chip</span>}
                </div>
                {s.note && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-3">{s.note}</p>}
                <div className="mt-3 flex flex-wrap gap-1">
                  <button
                    className="btn btn-quiet btn-sm h-8"
                    onClick={() => {
                      const editor = editors.doc;
                      if (!editor) return toast('Open your document first.', 'info');
                      editor.chain().focus().insertContent({ type: 'citation', attrs: { source: s.id, label: inText(s.data, style) } }).insertContent(' ').run();
                    }}
                  >
                    <Quote size={14} /> Cite
                  </button>
                  <button className="btn btn-quiet btn-sm h-8" onClick={() => setEditing(s)}>
                    <Pencil size={14} /> Edit
                  </button>
                  {s.data.url && (
                    <a className="btn btn-quiet btn-sm h-8" href={s.data.url} target="_blank" rel="noopener noreferrer">
                      <Globe size={14} /> Open
                    </a>
                  )}
                  <button
                    className="btn btn-quiet btn-sm ml-auto h-8 text-ink-4 hover:text-rose"
                    aria-label="Delete source"
                    onClick={async () => {
                      try {
                        await deleteSource(s.id);
                        useWorkspace.setState({ sources: useWorkspace.getState().sources.filter((x) => x.id !== s.id) });
                      } catch (e) {
                        toast((e as Error).message, 'warn');
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          <button className="btn btn-ghost btn-sm" onClick={referenceListIntoDoc}>
            <ListOrdered size={15} /> Reference list into my document
          </button>
          <button className="btn btn-quiet btn-sm" onClick={onFind}>
            <Sparkles size={15} className="text-iris" /> Find more
          </button>
        </div>
      )}
      <SourceForm source={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

const FIELDS: Record<SourceKind, { key: keyof SourceData; label: string; hint?: string }[]> = {
  article: [
    { key: 'container', label: 'Journal' },
    { key: 'volume', label: 'Volume' },
    { key: 'issue', label: 'Issue' },
    { key: 'pages', label: 'Pages', hint: 'e.g. 45–67' },
    { key: 'doi', label: 'DOI', hint: '10.1000/xyz' },
    { key: 'url', label: 'Link' },
  ],
  book: [
    { key: 'edition', label: 'Edition', hint: 'e.g. 2' },
    { key: 'publisher', label: 'Publisher' },
    { key: 'place', label: 'Place (Harvard)' },
    { key: 'doi', label: 'DOI' },
    { key: 'url', label: 'Link' },
  ],
  chapter: [
    { key: 'container', label: 'Book title' },
    { key: 'editors', label: 'Editors', hint: 'One per line' },
    { key: 'pages', label: 'Pages' },
    { key: 'edition', label: 'Edition' },
    { key: 'publisher', label: 'Publisher' },
    { key: 'place', label: 'Place (Harvard)' },
  ],
  web: [
    { key: 'container', label: 'Website' },
    { key: 'url', label: 'Link' },
    { key: 'accessed', label: 'Accessed', hint: 'YYYY-MM-DD' },
  ],
  report: [
    { key: 'issue', label: 'Report number' },
    { key: 'publisher', label: 'Publisher' },
    { key: 'url', label: 'Link' },
    { key: 'accessed', label: 'Accessed', hint: 'YYYY-MM-DD' },
  ],
  video: [
    { key: 'container', label: 'Platform', hint: 'e.g. YouTube' },
    { key: 'url', label: 'Link' },
    { key: 'accessed', label: 'Accessed', hint: 'YYYY-MM-DD' },
  ],
  other: [
    { key: 'container', label: 'Where it’s from' },
    { key: 'publisher', label: 'Publisher' },
    { key: 'url', label: 'Link' },
  ],
};

function SourceForm({ source, onClose }: { source: Source | 'new' | null; onClose: () => void }) {
  const assignment = useWorkspace((s) => s.assignment);
  const existing = source && source !== 'new' ? source : null;
  const [kind, setKind] = useState<SourceKind>('article');
  const [data, setData] = useState<SourceData>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const key = existing?.id ?? (source ? 'new' : null);
  if (key !== opened) {
    setOpened(key);
    setKind(existing?.kind ?? 'article');
    setData(existing?.data ?? {});
    setNote(existing?.note ?? '');
  }
  const style = assignment?.style ?? 'apa';
  const preview = useMemo(() => html(reference(kind, data, style)), [kind, data, style]);
  const list = (v: string[] | undefined) => (v ?? []).join('\n');
  const field = (k: keyof SourceData, value: string) =>
    setData((d) => ({ ...d, [k]: k === 'authors' || k === 'editors' ? value.split('\n') : value }));

  const save = async () => {
    if (!assignment) return;
    const clean: SourceData = {};
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) {
        const items = v.map((x) => x.trim()).filter(Boolean);
        if (items.length) (clean as Record<string, unknown>)[k] = items;
      } else if (typeof v === 'string' && v.trim()) (clean as Record<string, unknown>)[k] = v.trim();
    }
    if (!clean.title) return toast('Give it a title.', 'warn');
    setBusy(true);
    try {
      if (existing) {
        const s = await updateSource(existing.id, { kind, data: clean, note: note.trim() });
        useWorkspace.setState({ sources: useWorkspace.getState().sources.map((x) => (x.id === s.id ? s : x)) });
      } else {
        const s = await addSource(assignment.id, { kind, data: clean, note: note.trim() });
        useWorkspace.setState({ sources: [...useWorkspace.getState().sources, s] });
      }
      onClose();
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!source}
      onClose={onClose}
      title={existing ? 'Edit source' : 'Add a source'}
      width={600}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="kind">
            What is it?
          </label>
          <select id="kind" className="field" value={kind} onChange={(e) => setKind(e.target.value as SourceKind)}>
            {(Object.keys(KIND_NAMES) as SourceKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_NAMES[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="authors">
            Authors <span className="font-normal text-ink-4">one per line: Surname, First names (or an organisation)</span>
          </label>
          <textarea id="authors" className="field min-h-20" value={list(data.authors)} onChange={(e) => field('authors', e.target.value)} placeholder={'Smith, Jane\nWorld Health Organization'} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="title">
            Title
          </label>
          <input id="title" className="field" value={data.title ?? ''} onChange={(e) => field('title', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="year">
            Year
          </label>
          <input id="year" className="field" value={data.year ?? ''} onChange={(e) => field('year', e.target.value)} placeholder="e.g. 2021" />
        </div>
        {FIELDS[kind].map((f) => (
          <div key={f.key} className={f.key === 'editors' ? 'sm:col-span-2' : ''}>
            <label className="label" htmlFor={`f-${f.key}`}>
              {f.label}
            </label>
            {f.key === 'editors' ? (
              <textarea id={`f-${f.key}`} className="field min-h-16" value={list(data.editors)} onChange={(e) => field('editors', e.target.value)} placeholder={f.hint} />
            ) : (
              <input id={`f-${f.key}`} className="field" value={(data[f.key] as string) ?? ''} onChange={(e) => field(f.key, e.target.value)} placeholder={f.hint} />
            )}
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="label" htmlFor="note">
            Note
          </label>
          <textarea id="note" className="field min-h-16" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it says, the page you need…" />
        </div>
        <div className="sm:col-span-2 rounded-2xl bg-paper px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">{style === 'apa' ? 'APA 7th' : 'Harvard'}</p>
          <p className="reference mt-1 text-[0.9375rem] leading-relaxed" dangerouslySetInnerHTML={{ __html: preview }} />
          <p className="mt-1 text-sm text-ink-3">In the text: {inText(data, style)}</p>
        </div>
      </div>
    </Modal>
  );
}

/** Chooses a source to cite at the cursor (with a page, if you like). */
export function CitePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sources = useWorkspace((s) => s.sources);
  const style = useWorkspace((s) => s.assignment?.style ?? 'apa');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState('');
  const shown = sources.filter((s) => JSON.stringify(s.data).toLowerCase().includes(query.toLowerCase()));
  return (
    <Modal open={open} onClose={onClose} title="Cite a source" width={520}>
      {sources.length === 0 ? (
        <p className="text-ink-2">Add sources in the Sources panel first, and they’ll be here to cite.</p>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
              <input className="field pl-9" placeholder="Search your sources" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </div>
            <input className="field w-24" placeholder="Page" value={page} onChange={(e) => setPage(e.target.value)} aria-label="Page (optional)" />
          </div>
          <ul className="mt-3 space-y-1.5">
            {shown.map((s) => (
              <li key={s.id}>
                <button
                  className="w-full rounded-2xl border border-line px-4 py-3 text-left transition-colors hover:border-iris/40 hover:bg-iris-soft/40"
                  onClick={() => {
                    editors.doc?.chain().focus().insertContent({ type: 'citation', attrs: { source: s.id, page: page.trim(), label: inText(s.data, style, page) } }).insertContent(' ').run();
                    setPage('');
                    setQuery('');
                    onClose();
                  }}
                >
                  <span className="block font-semibold">{inText(s.data, style, page)}</span>
                  <span className="mt-0.5 block truncate text-sm text-ink-3">{s.data.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
