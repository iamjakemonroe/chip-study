import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import katex from 'katex';
import { Bold, ClipboardCheck, Italic, Link2, MessageCircle, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../components/ui.tsx';
import { listDocuments, type DocSnapshot } from '../lib/api.ts';
import { countWords } from '../lib/autosave.ts';
import type { StudyDocument } from '../lib/types.ts';
import { usePrefs } from '../store/prefs.ts';
import { toast } from '../store/toast.ts';
import { chipWordCount, extensions, plainText, refreshCitations } from './extensions.ts';
import { CitePicker } from './panels/SourcesPanel.tsx';
import { editors, useWorkspace } from './store.ts';
import { Toolbar } from './Toolbar.tsx';
import { clearBackup, readBackup, useSaver } from './useSaver.ts';

const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] };

/** The document's text and counts, worked out once for each version of it (documents never
 * change in place, so the same one is the same text): the word count and a save share it. */
type Measure = { doc: PMNode; text: string; words: number; chipWords: number };
const measured = new WeakMap<Editor, Measure>();

function measure(editor: Editor): Measure {
  const doc = editor.state.doc;
  const last = measured.get(editor);
  if (last?.doc === doc) return last;
  const text = plainText(editor);
  const m = { doc, text, words: countWords(text), chipWords: chipWordCount(doc) };
  measured.set(editor, m);
  return m;
}

function snapshot(editor: Editor): DocSnapshot {
  const { text, words, chipWords } = measure(editor);
  return { content: editor.getJSON() as Record<string, unknown>, text, words, chipWords };
}

/** Runs [fn] when the browser has a moment, so counting never lands in the middle of typing. */
const whenIdle = (fn: () => void) =>
  'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 1);

/** The writing surface: a calm page, the tools above it, saving as you go. */
export function DocEditor({ doc, onAskChip }: { doc: StudyDocument; onAskChip: (mode: 'explain' | 'write' | 'check', text: string) => void }) {
  const docFont = usePrefs((s) => s.docFont);
  const focusMode = useWorkspace((s) => s.focusMode);
  const { saver, state } = useSaver(doc);
  const [math, setMath] = useState<{ kind: 'inline' | 'block'; latex: string; pos: number | null } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [citing, setCiting] = useState(false);
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const counts = (editor: Editor) => {
    if (countTimer.current) clearTimeout(countTimer.current);
    countTimer.current = setTimeout(
      () =>
        whenIdle(() => {
          if (editor.isDestroyed) return;
          const { words, chipWords } = measure(editor);
          const st = useWorkspace.getState();
          if (st.words !== words || st.chipWords !== chipWords) useWorkspace.setState({ words, chipWords });
        }),
      400,
    );
  };

  const content = useMemo(() => {
    const backup = readBackup(doc);
    const c = backup?.content ?? doc.content;
    return c && (c as { type?: string }).type === 'doc' ? c : EMPTY;
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor(
    {
      extensions: extensions({ onMath: (kind, latex, pos) => setMath({ kind, latex, pos }) }),
      content,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { class: 'doc-prose', 'aria-label': `${doc.title}: your document`, spellcheck: 'true', 'aria-multiline': 'true', role: 'textbox' },
      },
      onCreate: ({ editor: e }) => {
        editors.doc = e;
        editors.text = () => plainText(e);
        counts(e);
        if (readBackup(doc)) {
          saver.change(() => snapshot(e));
          toast('Restored the changes you hadn’t saved on this device.', 'good');
        }
        if (editors.pending) {
          const html = editors.pending;
          editors.pending = null;
          setTimeout(() => {
            e.chain().focus('end').insertContent(html).run();
            toast('Your table is at the end of your document.', 'good');
          }, 50);
        }
      },
      onUpdate: ({ editor: e }) => {
        saver.change(() => snapshot(e));
        counts(e);
      },
      onSelectionUpdate: ({ editor: e }) => {
        const { from, to } = e.state.selection;
        const text = from === to ? '' : e.state.doc.textBetween(from, to, '\n\n', ' ').slice(0, 6000);
        if (text !== useWorkspace.getState().selection) useWorkspace.setState({ selection: text });
      },
    },
    [doc.id],
  );

  useEffect(
    () => () => {
      if (editors.doc === editor) {
        editors.doc = null;
        editors.text = () => '';
      }
      if (countTimer.current) clearTimeout(countTimer.current);
    },
    [editor],
  );

  // Citations follow their sources and the referencing style.
  const sources = useWorkspace((s) => s.sources);
  const style = useWorkspace((s) => s.assignment?.style ?? 'apa');
  useEffect(() => {
    if (editor && !editor.isDestroyed) refreshCitations(editor, sources, style);
  }, [editor, sources, style]);

  if (!editor) return null;

  const loadTheirs = async () => {
    const fresh = (await listDocuments(doc.assignment_id)).find((d) => d.id === doc.id);
    if (!fresh) return;
    editor.commands.setContent(fresh.content && (fresh.content as { type?: string }).type === 'doc' ? fresh.content : EMPTY, { emitUpdate: false });
    await saver.resolve('theirs', fresh.version);
    clearBackup(doc.id);
    useWorkspace.setState((s) => ({ docs: s.docs.map((d) => (d.id === doc.id ? fresh : d)) }));
    counts(editor);
  };

  return (
    <div className={`doc-shell ${docFont === 'sans' ? 'doc-sans' : 'doc-serif'} ${focusMode ? 'doc-focus' : ''}`}>
      <div className="doc-toolbar">
        <Toolbar editor={editor} onLink={() => setLink(editor.getAttributes('link').href ?? '')} onMath={(kind) => setMath({ kind, latex: '', pos: null })} onCite={() => setCiting(true)} />
      </div>
      {state === 'conflict' && (
        <div className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl border border-sand/30 bg-sand-soft px-4 py-3 text-sm" role="alert">
          <span className="flex-1 text-[#7a5a14]">This document was changed on another device or tab since you opened it.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => void loadTheirs()}>
            Load theirs
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void saver.resolve('mine')}>
            Keep mine
          </button>
        </div>
      )}
      <div className="doc-page">
        <EditorContent editor={editor} />
      </div>
      <BubbleMenu editor={editor} options={{ placement: 'top', offset: 8 }} shouldShow={({ editor: e, state: st }) => !st.selection.empty && e.isEditable && !e.isActive('inlineMath') && !e.isActive('blockMath') && !e.isActive('citation')}>
        <div className="flex items-center gap-0.5 rounded-2xl border border-line bg-white p-1 shadow-[var(--shadow-lift)]">
          <button className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-iris-2 hover:bg-iris-soft" onMouseDown={(e) => e.preventDefault()} onClick={() => onAskChip('explain', useWorkspace.getState().selection)}>
            <MessageCircle size={15} /> Ask Chip
          </button>
          <button className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-ink-2 hover:bg-paper-2" onMouseDown={(e) => e.preventDefault()} onClick={() => onAskChip('check', useWorkspace.getState().selection)}>
            <ClipboardCheck size={15} /> Check
          </button>
          <button className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-ink-2 hover:bg-paper-2" onMouseDown={(e) => e.preventDefault()} onClick={() => onAskChip('write', useWorkspace.getState().selection)}>
            <Wand2 size={15} /> Improve
          </button>
          <span className="mx-0.5 h-5 w-px bg-line" />
          <button className="icon-btn h-8 w-8" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={15} />
          </button>
          <button className="icon-btn h-8 w-8" aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={15} />
          </button>
          <button className="icon-btn h-8 w-8" aria-label="Link" onMouseDown={(e) => e.preventDefault()} onClick={() => setLink(editor.getAttributes('link').href ?? '')}>
            <Link2 size={15} />
          </button>
        </div>
      </BubbleMenu>

      <MathDialog
        value={math}
        onClose={() => setMath(null)}
        onSave={(latex) => {
          if (!math) return;
          const c = editor.chain().focus();
          if (math.pos === null) {
            if (math.kind === 'inline') c.insertInlineMath({ latex }).run();
            else c.insertBlockMath({ latex }).run();
          } else if (math.kind === 'inline') c.updateInlineMath({ latex, pos: math.pos }).run();
          else c.updateBlockMath({ latex, pos: math.pos }).run();
          setMath(null);
        }}
        onDelete={() => {
          if (!math || math.pos === null) return;
          if (math.kind === 'inline') editor.chain().focus().deleteInlineMath({ pos: math.pos }).run();
          else editor.chain().focus().deleteBlockMath({ pos: math.pos }).run();
          setMath(null);
        }}
      />
      <Modal open={link !== null} onClose={() => setLink(null)} title="Link" width={440}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const href = (link ?? '').trim();
            const chain = editor.chain().focus().extendMarkRange('link');
            if (!href) chain.unsetLink().run();
            else chain.setLink({ href: /^(https?:|mailto:)/i.test(href) ? href : `https://${href}` }).run();
            setLink(null);
          }}
        >
          <input className="field" placeholder="https://…" value={link ?? ''} onChange={(e) => setLink(e.target.value)} autoFocus />
          <div className="mt-4 flex justify-end gap-2">
            {editor.isActive('link') && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => (editor.chain().focus().extendMarkRange('link').unsetLink().run(), setLink(null))}>
                Remove link
              </button>
            )}
            <button className="btn btn-primary btn-sm">Save</button>
          </div>
        </form>
      </Modal>
      <CitePicker open={citing} onClose={() => setCiting(false)} />
    </div>
  );
}

function MathDialog({ value, onClose, onSave, onDelete }: { value: { kind: 'inline' | 'block'; latex: string; pos: number | null } | null; onClose: () => void; onSave: (latex: string) => void; onDelete: () => void }) {
  const [latex, setLatex] = useState('');
  useEffect(() => setLatex(value?.latex ?? ''), [value]);
  const preview = useMemo(() => {
    try {
      return katex.renderToString(latex || '\\;', { displayMode: value?.kind === 'block', throwOnError: false });
    } catch {
      return '';
    }
  }, [latex, value?.kind]);
  return (
    <Modal open={!!value} onClose={onClose} title={value?.pos === null ? 'Insert math' : 'Edit math'} width={520}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (latex.trim()) onSave(latex.trim());
        }}
      >
        <label className="label" htmlFor="latex">
          LaTeX
        </label>
        <textarea id="latex" className="field min-h-24 font-mono text-sm" placeholder={'e.g. \\frac{a}{b} = \\sqrt{x^2 + y^2}'} value={latex} onChange={(e) => setLatex(e.target.value)} autoFocus />
        <div className="mt-3 min-h-14 overflow-x-auto rounded-2xl bg-paper px-4 py-3 text-center" aria-label="Preview" dangerouslySetInnerHTML={{ __html: preview }} />
        <p className="mt-2 text-xs text-ink-3">Tip: type $x^2$ straight into your document for math in the line.</p>
        <div className="mt-4 flex justify-end gap-2">
          {value?.pos !== null && (
            <button type="button" className="btn btn-ghost btn-sm text-rose" onClick={onDelete}>
              Delete
            </button>
          )}
          <button className="btn btn-primary btn-sm" disabled={!latex.trim()}>
            {value?.pos === null ? 'Insert' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
