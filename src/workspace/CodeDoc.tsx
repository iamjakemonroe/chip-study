import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { forceLinting, linter, lintGutter } from '@codemirror/lint';
import { Compartment, EditorState, Prec, type Extension, type Text } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { AlignLeft, Check, Eye, MessageCircle, Minus, Play, Plus, Settings2, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Menu, Segmented, Spinner } from '../components/ui.tsx';
import { renameDocument } from '../lib/api.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import type { StudyDocument } from '../lib/types.ts';
import { toast } from '../store/toast.ts';
import { canFormat, formatCode, formatError, loadRuff, pythonProblems } from './code/format.ts';
import { freeName, langById, langFromName, LANGS, renameForLang } from './code/langs.ts';
import OutputPanel, { type Entry, type Preview, type RunState } from './code/OutputPanel.tsx';
import { buildPage, cleanTraceback, pageFor, type CodeFile } from './code/project.ts';
import { previewBridge, startRun, type RunEvent, type RunHandle } from './code/runner.ts';
import { useCodeSettings } from './code/settings.ts';
import { editorTheme } from './code/theme.ts';
import { useRoomBinding } from './roomBinding.ts';
import { editors, useWorkspace } from './store.ts';
import { useSaver } from './useSaver.ts';

/** A code file: CodeMirror with the language's colours and suggestions, saved as you type. It
 * runs right here (Python, JavaScript, TypeScript, SQL; HTML and CSS as a live page; Markdown as a
 * preview), formats, shows problems, and Chip can explain an error without fixing it for you.
 * The assignment's other code tabs are the project: a page uses its stylesheet, main.py imports
 * helper.py. Loaded only when a code tab is open. */

interface Content {
  lang?: string;
  code?: string;
  /** What the program reads with input(), kept with the file. */
  stdin?: string;
}

const MAX_TEXT = 100_000;

/** Code left behind when a tab closes, until that tab opens again: its save is still on the way,
 * so a run or the reopened tab mustn't read the older copy. */
const leaving = new Map<string, string>();

export default function CodeDoc({ doc, onAskChip }: { doc: StudyDocument; onAskChip: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const split = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const parts = useRef({
    language: new Compartment(),
    problems: new Compartment(),
    look: new Compartment(),
    wrap: new Compartment(),
    vim: new Compartment(),
    guides: new Compartment(),
    tabs: new Compartment(),
    access: new Compartment(),
  }).current;
  // In a study room: bound live to the room's shared text (y-codemirror), saved by the room.
  const room = useRoomBinding();
  const canEdit = room ? room.canEdit : true;
  const shared = useMemo(() => room?.code(doc.id) ?? null, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { saver } = useSaver(doc, { off: !!room });
  const initial = (shared ? { lang: shared.lang, code: shared.text, stdin: shared.stdin } : doc.content) as Content;
  const [lang, setLang] = useState(initial.lang ?? langFromName(doc.title)?.id ?? 'python');
  const langRef = useRef(lang);
  const settings = useCodeSettings();
  const [stdin, setStdin] = useState(initial.stdin ?? '');
  const stdinRef = useRef(stdin);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [state, setState] = useState<RunState>({ phase: 'idle' });
  const [panel, setPanel] = useState(false);
  const [size, setSize] = useState(settings.panel);
  const [tab, setTab] = useState<'output' | 'preview'>('output');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showInput, setShowInput] = useState(!!initial.stdin);
  const [formatting, setFormatting] = useState(false);
  const run = useRef<RunHandle | null>(null);
  const token = useRef(crypto.randomUUID()).current;
  /** The end of what the program printed last, for Chip to see. */
  const printed = useRef('');
  const actions = useRef({ run: () => {}, format: () => {}, refresh: () => {} });
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const l = langById(lang);

  // The save after a tab closes runs when the editor has already gone: it reads this.
  const last = useRef<Text | null>(null);

  const read = () => {
    const code = (view.current?.state.doc ?? last.current)?.toString() ?? '';
    return { content: { lang: langRef.current, code, ...(stdinRef.current ? { stdin: stdinRef.current } : {}) }, text: code, words: 0, chipWords: 0 };
  };

  /** The assignment's code files as they are now (this one straight from the editor). */
  const project = (): { files: CodeFile[]; main: CodeFile } => {
    const main = { name: doc.title, code: view.current?.state.doc.toString() ?? '' };
    const others = useWorkspace
      .getState()
      .docs.filter((d) => d.kind === 'code' && d.id !== doc.id)
      .map((d) => ({ name: d.title, code: room ? room.codeText(d.id) : (leaving.get(d.id) ?? String((d.content as Content).code ?? '')) }));
    return { files: [main, ...others], main };
  };

  useEffect(() => {
    if (!host.current) return;
    const s = useCodeSettings.getState();
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: shared ? shared.text : (leaving.get(doc.id) ?? initial.code ?? ''),
        extensions: [
          parts.vim.of([]),
          ...(shared ? [shared.extension] : []),
          basicSetup,
          keymap.of([indentWithTab]),
          parts.access.of(access(canEdit)),
          Prec.high(
            keymap.of([
              { key: 'Mod-Enter', run: () => (actions.current.run(), true) },
              { key: 'Shift-Alt-f', run: () => (actions.current.format(), true) },
              { key: 'Mod-s', run: () => (void saver.flush(), true), preventDefault: true },
            ]),
          ),
          parts.look.of(editorTheme(s.theme, s.fontSize)),
          parts.wrap.of(s.wrap ? EditorView.lineWrapping : []),
          parts.guides.of([]),
          parts.tabs.of(tabs(s.tabSize)),
          parts.language.of([]),
          parts.problems.of([]),
          EditorView.contentAttributes.of({ 'aria-label': `Code: ${doc.title}` }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              last.current = u.state.doc;
              saver.change(read);
              if (refreshTimer.current) clearTimeout(refreshTimer.current);
              refreshTimer.current = setTimeout(() => actions.current.refresh(), 450);
            }
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
    last.current = v.state.doc;
    leaving.delete(doc.id);
    editors.doc = null;
    editors.text = () => `Code file "${doc.title}" (${langRef.current}):\n${v.state.doc.toString()}${printed.current ? `\n\nWhat it printed when last run:\n${printed.current}` : ''}`;
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      run.current?.stop();
      if (!room) leaving.set(doc.id, v.state.doc.toString());
      v.destroy();
      view.current = null;
      editors.text = () => '';
    };
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The language: its colours and suggestions, and Python's problems once Ruff is loaded.
  useEffect(() => {
    langRef.current = lang;
    let live = true;
    void langById(lang)
      .load()
      .then((support) => {
        if (!live || !view.current) return;
        view.current.dispatch({
          effects: [parts.language.reconfigure(support), parts.problems.reconfigure(lang === 'python' ? [linter((v) => pythonProblems(v.state.doc), { delay: 500 }), lintGutter()] : [])],
        });
      });
    return () => {
      live = false;
    };
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Renamed to index.html: it's HTML now.
  useEffect(() => {
    const named = langFromName(doc.title);
    if (named && named.id !== langRef.current) {
      setLang(named.id);
      langRef.current = named.id;
      if (shared) {
        if (canEdit) shared.setLang(named.id);
      } else saver.change(read);
    }
  }, [doc.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // In a room: someone else changed the language, or what this screen may do changed.
  const sharedLang = room ? (doc.content as Content).lang : undefined;
  useEffect(() => {
    if (sharedLang && sharedLang !== langRef.current) {
      setLang(sharedLang);
      langRef.current = sharedLang;
    }
  }, [sharedLang]);
  useEffect(() => {
    view.current?.dispatch({ effects: parts.access.reconfigure(access(canEdit)) });
  }, [canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Settings, as they change.
  useEffect(() => {
    view.current?.dispatch({ effects: [parts.look.reconfigure(editorTheme(settings.theme, settings.fontSize)), parts.wrap.reconfigure(settings.wrap ? EditorView.lineWrapping : []), parts.tabs.reconfigure(tabs(settings.tabSize))] });
  }, [settings.theme, settings.fontSize, settings.wrap, settings.tabSize]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    const on = settings.vim ? import('@replit/codemirror-vim').then((m) => m.vim({ status: true }) as Extension) : Promise.resolve([] as Extension);
    void on.then((ext) => live && view.current?.dispatch({ effects: parts.vim.reconfigure(ext) }));
    return () => {
      live = false;
    };
  }, [settings.vim]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    const on = settings.guides
      ? import('@replit/codemirror-indentation-markers').then((m) =>
          m.indentationMarkers({ thickness: 1, highlightActiveBlock: true, colors: { light: '#e6e6f0', activeLight: '#c9c4f7', dark: '#2a2c4c', activeDark: '#5a51a8' } }),
        )
      : Promise.resolve([] as Extension);
    void on.then((ext) => live && view.current?.dispatch({ effects: parts.guides.reconfigure(ext) }));
    return () => {
      live = false;
    };
  }, [settings.guides]); // eslint-disable-line react-hooks/exhaustive-deps

  // A web page's console comes back from the preview frame.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { chipPreview?: string; type?: string; text?: string } | null;
      if (m?.chipPreview !== token) return;
      push({ kind: m.type === 'err' ? 'err' : 'out', text: String(m.text ?? '').slice(0, 5000) });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [token]);

  /** Adds to the output: text runs on in one block, and very long output keeps its end. */
  const push = (entry: Entry) => {
    if (entry.kind === 'out' || entry.kind === 'err') printed.current = (printed.current + entry.text).slice(-2000);
    setEntries((list) => {
      const last = list[list.length - 1];
      let next: Entry[];
      if ((entry.kind === 'out' || entry.kind === 'err') && last?.kind === entry.kind) {
        const text = last.text + entry.text;
        next = [...list.slice(0, -1), { kind: entry.kind, text: text.length > MAX_TEXT ? `… (the start is cut: very long output)\n${text.slice(-MAX_TEXT)}` : text }];
      } else next = [...list, entry];
      return next.length > 400 ? next.slice(-400) : next;
    });
  };

  const onEvent = (e: RunEvent) => {
    if (e.type === 'status') setState((s) => (s.phase === 'running' ? { phase: 'running', status: e.text } : s));
    else if (e.type === 'out' || e.type === 'err' || e.type === 'note') push({ kind: e.type, text: e.text });
    else if (e.type === 'image') push({ kind: 'image', data: e.data });
    else if (e.type === 'table') push({ kind: 'table', columns: e.columns, rows: e.rows, more: e.more });
    else if (e.type === 'done') setState({ phase: 'done', ms: e.ms });
    else if (e.type === 'error') {
      const text = langRef.current === 'python' ? cleanTraceback(e.text) : e.text;
      printed.current = `${printed.current}\n${text}`.slice(-2000);
      setState({ phase: 'error', text, ms: e.ms });
    }
  };

  /** The page or Markdown preview, from the code as it is now (null when there's nothing to show). */
  const makePreview = (): Preview | null => {
    const { files, main } = project();
    if (langRef.current === 'markdown') return { kind: 'markdown', html: renderMarkdown(main.code) };
    const page = pageFor(files, main);
    return page ? { kind: 'web', html: buildPage(files, page, previewBridge(token)), page: page.name } : null;
  };

  // The preview follows the code; a page starts its console over each time it reloads.
  actions.current.refresh = () => {
    if (!preview || !panel) return;
    const next = makePreview();
    if (next?.kind === 'web') {
      setEntries([]);
      printed.current = '';
    }
    setPreview(next);
  };

  actions.current.run = () => {
    const runner = langById(langRef.current).runner;
    if (!runner) {
      toast(`${langById(langRef.current).name} can’t run in the browser yet. Chip can still read it and help you with it.`);
      return;
    }
    run.current?.stop();
    run.current = null;
    setPanel(true);
    const { files, main } = project();
    if (runner === 'markdown' || runner === 'web' || (runner === 'js' && pageFor(files, main))) {
      const p = makePreview();
      setEntries([]);
      printed.current = '';
      setState({ phase: 'idle' });
      if (p) {
        setPreview(p);
        setTab('preview');
      } else {
        setPreview(null);
        setTab('output');
        push({ kind: 'note', text: 'To see this stylesheet, add an HTML page that links it, for example index.html with <link rel="stylesheet" href="style.css">.' });
      }
      return;
    }
    setPreview(null);
    setEntries([]);
    printed.current = '';
    setTab('output');
    setState({ phase: 'running', status: '' });
    if (runner === 'python') void loadRuff().then(() => view.current && forceLinting(view.current), () => undefined);
    const lines = stdinRef.current ? stdinRef.current.replace(/\n$/, '').split('\n') : [];
    run.current = startRun(runner === 'python' ? 'python' : runner === 'sql' ? 'sql' : 'js', { files, main, stdin: lines }, onEvent);
  };

  const stop = () => {
    run.current?.stop();
    run.current = null;
    setState({ phase: 'stopped' });
  };

  actions.current.format = async () => {
    const v = view.current;
    const id = langRef.current;
    if (!v || formatting) return;
    if (!canFormat(id)) {
      toast(`${langById(id).name} can’t be formatted here yet.`);
      return;
    }
    const before = v.state.doc.toString();
    setFormatting(true);
    try {
      const after = await formatCode(id, before, useCodeSettings.getState().tabSize);
      if (id === 'python' && view.current) forceLinting(view.current);
      // Only what changed is replaced, so the cursor and scroll stay where they were.
      if (after !== before && v.state.doc.toString() === before) {
        let a = 0;
        while (a < before.length && a < after.length && before[a] === after[a]) a++;
        let b = 0;
        while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
        v.dispatch({ changes: { from: a, to: before.length - b, insert: after.slice(a, after.length - b) }, userEvent: 'input.format' });
      }
    } catch (err) {
      toast(`Couldn’t format it: ${formatError(err)}`, 'warn');
    } finally {
      setFormatting(false);
    }
  };

  const changeLang = (id: string) => {
    if (!canEdit) return;
    setLang(id);
    langRef.current = id;
    if (shared) shared.setLang(id);
    else saver.change(read);
    const taken = useWorkspace
      .getState()
      .docs.filter((d) => d.id !== doc.id)
      .map((d) => d.title);
    const next = renameForLang(doc.title, langById(id));
    if (next === doc.title) return;
    const name = freeName(next, taken);
    if (room) {
      room.rename(doc.id, name);
      return;
    }
    renameDocument(doc.id, name)
      .then(() => useWorkspace.setState({ docs: useWorkspace.getState().docs.map((d) => (d.id === doc.id ? { ...d, title: name } : d)) }))
      .catch((err: unknown) => toast((err as Error).message, 'warn'));
  };

  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = split.current?.getBoundingClientRect();
    if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    let now = size;
    const move = (ev: PointerEvent) => {
      now = Math.min(0.8, Math.max(0.15, (box.bottom - ev.clientY) / box.height));
      setSize(now);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      settings.change({ panel: now });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const running = state.phase === 'running';
  const readsInput = l.runner === 'python' || (l.runner === 'js' && !preview);

  return (
    <div className="code-wrap" data-theme={settings.theme}>
      <div className="code-bar">
        <select className="field h-9 w-auto py-0 text-sm" value={lang} aria-label="Language" disabled={!canEdit} onChange={(e) => changeLang(e.target.value)}>
          {LANGS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        {running ? (
          <button className="btn btn-sm code-run is-stop" onClick={stop} title="Stop the program">
            <Square size={13} fill="currentColor" /> Stop
          </button>
        ) : (
          <button
            className="btn btn-sm code-run"
            onClick={() => actions.current.run()}
            disabled={!l.runner}
            title={l.runner ? `${l.runner === 'markdown' ? 'Preview' : 'Run'} (Ctrl or ⌘ + Enter)` : `${l.name} can’t run in the browser yet`}
          >
            <Play size={13} fill="currentColor" /> {l.runner === 'markdown' ? 'Preview' : 'Run'}
          </button>
        )}
        <span className="flex-1" />
        {!canEdit && (
          <span className="hidden items-center gap-1.5 text-xs font-medium text-ink-3 sm:flex" role="status">
            <Eye size={14} className="text-iris" /> Viewing
          </span>
        )}
        {canFormat(lang) && canEdit && (
          <button className="btn btn-ghost btn-sm" onClick={() => void actions.current.format()} disabled={formatting} title="Format the code (Shift + Alt + F)">
            {formatting ? <Spinner size={14} /> : <AlignLeft size={15} />} <span className="hidden sm:inline">Format</span>
          </button>
        )}
        <Menu label="Editor settings" button={<Settings2 size={17} />}>
          {() => (
            <div className="code-settings">
              <div className="code-settings-row">
                <span>Colours</span>
                <Segmented
                  size="sm"
                  label="Editor colours"
                  value={settings.theme}
                  onChange={(theme) => settings.change({ theme })}
                  options={[
                    { value: 'day', label: 'Day' },
                    { value: 'night', label: 'Night' },
                  ]}
                />
              </div>
              <div className="code-settings-row">
                <span>Text size</span>
                <span className="flex items-center gap-1">
                  <button className="icon-btn h-7 w-7" aria-label="Smaller text" onClick={() => settings.change({ fontSize: Math.max(11, settings.fontSize - 1) })}>
                    <Minus size={14} />
                  </button>
                  <span className="w-6 text-center text-sm tabular-nums">{settings.fontSize}</span>
                  <button className="icon-btn h-7 w-7" aria-label="Bigger text" onClick={() => settings.change({ fontSize: Math.min(22, settings.fontSize + 1) })}>
                    <Plus size={14} />
                  </button>
                </span>
              </div>
              <div className="code-settings-row">
                <span>Indent</span>
                <Segmented
                  size="sm"
                  label="Spaces per indent"
                  value={String(settings.tabSize) as '2' | '4'}
                  onChange={(t) => settings.change({ tabSize: t === '2' ? 2 : 4 })}
                  options={[
                    { value: '2', label: '2 spaces' },
                    { value: '4', label: '4 spaces' },
                  ]}
                />
              </div>
              <Toggle on={settings.wrap} onChange={(wrap) => settings.change({ wrap })}>
                Wrap long lines
              </Toggle>
              <Toggle on={settings.guides} onChange={(guides) => settings.change({ guides })}>
                Indent guides
              </Toggle>
              <Toggle on={settings.vim} onChange={(vim) => settings.change({ vim })}>
                Vim keys
              </Toggle>
              <p className="code-settings-keys">
                <kbd>Ctrl/⌘ Enter</kbd> run · <kbd>Shift Alt F</kbd> format · <kbd>Ctrl/⌘ F</kbd> find · <kbd>Ctrl/⌘ /</kbd> comment · <kbd>Alt</kbd>+click more cursors
              </p>
            </div>
          )}
        </Menu>
        <button className="btn btn-ghost btn-sm" onClick={() => onAskChip(useWorkspace.getState().selection ? 'Explain the code I selected, and anything that could go wrong with it.' : 'Explain my code, and point out any bugs or things to improve.')}>
          <MessageCircle size={15} className="text-iris" /> <span className="hidden sm:inline">Ask Chip about this code</span>
          <span className="sm:hidden">Ask Chip</span>
        </button>
      </div>
      <div ref={split} className="code-split">
        <div ref={host} className="code-host" style={{ flex: panel ? `${1 - size} 1 0` : '1 1 0' }} />
        {panel && (
          <>
            <div
              className="code-handle"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize the output"
              aria-valuenow={Math.round(size * 100)}
              aria-valuemin={15}
              aria-valuemax={80}
              tabIndex={0}
              onPointerDown={drag}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowDown' ? -0.05 : 0;
                if (!step) return;
                e.preventDefault();
                const next = Math.min(0.8, Math.max(0.15, size + step));
                setSize(next);
                settings.change({ panel: next });
              }}
            />
            <div className="code-out-wrap" style={{ flex: `${size} 1 0` }}>
              <OutputPanel
                entries={entries}
                state={state}
                tab={tab}
                onTab={setTab}
                preview={preview}
                input={stdin}
                onInput={(v) => {
                  setStdin(v);
                  stdinRef.current = v;
                  if (shared) {
                    if (canEdit) shared.setStdin(v);
                  } else saver.change(read);
                }}
                readsInput={readsInput}
                showInput={showInput}
                onShowInput={setShowInput}
                onClear={() => {
                  setEntries([]);
                  printed.current = '';
                  if (!running) setState({ phase: 'idle' });
                }}
                onClose={() => {
                  if (running) stop();
                  setPanel(false);
                  setPreview(null);
                }}
                onAskError={
                  state.phase === 'error'
                    ? () => onAskChip(`When I run ${doc.title}, I get this error:\n\n${state.text}\n\nWhat does it mean? Give me a hint so I can fix it myself.`)
                    : null
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const tabs = (size: number): Extension => [EditorState.tabSize.of(size), indentUnit.of(' '.repeat(size))];

/** Typing allowed, or read-only (a room's viewers). */
const access = (canEdit: boolean): Extension => (canEdit ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)]);

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: string }) {
  return (
    <button role="menuitemcheckbox" aria-checked={on} className="code-settings-toggle" onClick={() => onChange(!on)}>
      <span className={`code-check ${on ? 'is-on' : ''}`}>{on && <Check size={12} strokeWidth={3} />}</span>
      {children}
    </button>
  );
}
