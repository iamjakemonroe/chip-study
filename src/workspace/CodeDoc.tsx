import { indentWithTab } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { MessageCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StudyDocument } from '../lib/types.ts';
import { editors, useWorkspace } from './store.ts';
import { useSaver } from './useSaver.ts';

/** A code file: CodeMirror, with the language's colours, saved as you type. Loaded only when a
 * code tab is open. */

const LANGS: { id: string; name: string; load: () => Promise<import('@codemirror/language').LanguageSupport> }[] = [
  { id: 'python', name: 'Python', load: () => import('@codemirror/lang-python').then((m) => m.python()) },
  { id: 'javascript', name: 'JavaScript', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript()) },
  { id: 'typescript', name: 'TypeScript', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })) },
  { id: 'java', name: 'Java', load: () => import('@codemirror/lang-java').then((m) => m.java()) },
  { id: 'cpp', name: 'C / C++', load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) },
  { id: 'sql', name: 'SQL', load: () => import('@codemirror/lang-sql').then((m) => m.sql()) },
  { id: 'html', name: 'HTML', load: () => import('@codemirror/lang-html').then((m) => m.html()) },
  { id: 'css', name: 'CSS', load: () => import('@codemirror/lang-css').then((m) => m.css()) },
  { id: 'markdown', name: 'Markdown', load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()) },
];

const calm = EditorView.theme({
  '&': { fontSize: '14px', height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
  '.cm-content': { padding: '18px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#a3a5bb' },
  '.cm-activeLine': { backgroundColor: 'rgb(100 87 240 / 0.05)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#6457f0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgb(100 87 240 / 0.16) !important' },
  '.cm-cursor': { borderLeftColor: '#6457f0' },
});

export default function CodeDoc({ doc, onAskChip }: { doc: StudyDocument; onAskChip: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const { saver } = useSaver(doc);
  const initial = doc.content as { lang?: string; code?: string };
  const [lang, setLang] = useState(initial.lang ?? 'python');
  const langRef = useRef(lang);

  useEffect(() => {
    if (!host.current) return;
    const read = () => {
      const code = view.current?.state.doc.toString() ?? '';
      return { content: { lang: langRef.current, code }, text: code, words: 0, chipWords: 0 };
    };
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.code ?? '',
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          calm,
          language.current.of([]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) saver.change(read);
            if (u.selectionSet) {
              const { from, to } = u.state.selection.main;
              const text = from === to ? '' : u.state.sliceDoc(from, to).slice(0, 6000);
              if (text !== useWorkspace.getState().selection) useWorkspace.setState({ selection: text });
            }
          }),
        ],
      }),
    });
    view.current = v;
    editors.doc = null;
    editors.text = () => `Code file "${doc.title}" (${langRef.current}):\n${v.state.doc.toString()}`;
    return () => {
      v.destroy();
      view.current = null;
      editors.text = () => '';
    };
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    langRef.current = lang;
    let live = true;
    void LANGS.find((l) => l.id === lang)?.load().then((support) => {
      if (live) view.current?.dispatch({ effects: language.current.reconfigure(support) });
    });
    return () => {
      live = false;
    };
  }, [lang]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line/70 bg-white/80 px-4 py-2 backdrop-blur">
        <select
          className="field h-9 w-auto py-0 text-sm"
          value={lang}
          aria-label="Language"
          onChange={(e) => {
            setLang(e.target.value);
            langRef.current = e.target.value;
            const v = view.current;
            if (v) saver.change(() => ({ content: { lang: e.target.value, code: v.state.doc.toString() }, text: v.state.doc.toString(), words: 0, chipWords: 0 }));
          }}
        >
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <button className="btn btn-ghost btn-sm" onClick={() => onAskChip(useWorkspace.getState().selection ? 'Explain the code I selected, and anything that could go wrong with it.' : 'Explain my code, and point out any bugs or things to improve.')}>
          <MessageCircle size={15} className="text-iris" /> Ask Chip about this code
        </button>
      </div>
      <div ref={host} className="code-host min-h-0 flex-1 overflow-hidden bg-white/70" />
    </div>
  );
}
