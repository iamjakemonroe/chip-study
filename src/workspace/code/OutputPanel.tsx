import { Eraser, Keyboard, MessageCircle, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Spinner } from '../../components/ui.tsx';

/** Under the code: what the program printed (text, tables, plots, errors), a web page or
 * Markdown preview, and the lines the program reads with input(). */

export type Entry =
  | { kind: 'out' | 'err' | 'note'; text: string }
  | { kind: 'image'; data: string }
  | { kind: 'table'; columns: string[]; rows: unknown[][]; more: number };

export type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; status: string }
  | { phase: 'done'; ms: number }
  | { phase: 'error'; text: string; ms: number }
  | { phase: 'stopped' };

export type Preview = { kind: 'web'; html: string; page: string } | { kind: 'markdown'; html: string };

const seconds = (ms: number) => (ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`);

const cell = (v: unknown) => (v === null ? 'NULL' : typeof v === 'number' && !Number.isInteger(v) ? String(Math.round(v * 1e6) / 1e6) : String(v));

export default function OutputPanel({
  entries,
  state,
  tab,
  onTab,
  preview,
  input,
  onInput,
  readsInput,
  showInput,
  onShowInput,
  onClear,
  onClose,
  onAskError,
}: {
  entries: Entry[];
  state: RunState;
  tab: 'output' | 'preview';
  onTab: (t: 'output' | 'preview') => void;
  preview: Preview | null;
  input: string;
  onInput: (v: string) => void;
  /** This language reads input (Python's input(), JavaScript's prompt()). */
  readsInput: boolean;
  showInput: boolean;
  onShowInput: (v: boolean) => void;
  onClear: () => void;
  onClose: () => void;
  onAskError: (() => void) | null;
}) {
  const body = useRef<HTMLDivElement>(null);
  // New output keeps the newest line in view (only this box scrolls, never the page).
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [entries, state]);

  return (
    <section className="code-out" aria-label="Output">
      <div className="code-out-bar">
        <div role="tablist" aria-label="Output or preview" className="flex items-center gap-1">
          <button role="tab" aria-selected={tab === 'output'} className="code-out-tab" onClick={() => onTab('output')}>
            Output
          </button>
          {preview && (
            <button role="tab" aria-selected={tab === 'preview'} className="code-out-tab" onClick={() => onTab('preview')}>
              {preview.kind === 'web' ? `Preview · ${preview.page}` : 'Preview'}
            </button>
          )}
        </div>
        <span className="code-out-status" aria-live="polite">
          {state.phase === 'running' && (
            <>
              <Spinner size={12} /> {state.status || 'Running…'}
            </>
          )}
          {state.phase === 'done' && `Finished in ${seconds(state.ms)}`}
          {state.phase === 'error' && <span className="text-rose">Stopped with an error</span>}
          {state.phase === 'stopped' && 'Stopped'}
        </span>
        <span className="flex-1" />
        {readsInput && (
          <button className={`code-out-btn ${showInput ? 'is-on' : ''}`} onClick={() => onShowInput(!showInput)} aria-pressed={showInput} title="What your program reads with input()">
            <Keyboard size={14} /> <span className="hidden sm:inline">Input</span>
          </button>
        )}
        <button className="code-out-btn" onClick={onClear} aria-label="Clear the output" title="Clear the output">
          <Eraser size={14} />
        </button>
        <button className="code-out-btn" onClick={onClose} aria-label="Hide the output" title="Hide the output">
          <X size={15} />
        </button>
      </div>
      {readsInput && showInput && (
        <label className="code-out-input">
          <span>Input: one line for each input() your program asks for</span>
          <textarea value={input} onChange={(e) => onInput(e.target.value)} rows={3} spellCheck={false} placeholder={'Ada\n36'} aria-label="Input for your program" />
        </label>
      )}
      <div ref={body} className="code-out-body" hidden={tab !== 'output'} role="log" aria-label="What your program printed">
        {entries.length === 0 && state.phase !== 'error' && state.phase !== 'running' && <p className="code-out-empty">Run your code (Ctrl or ⌘ + Enter) and what it prints shows here.</p>}
        {entries.map((e, i) =>
          e.kind === 'image' ? (
            <img key={i} className="code-out-img" src={`data:image/png;base64,${e.data}`} alt="A plot your code drew" />
          ) : e.kind === 'table' ? (
            <div key={i} className="code-out-table">
              <table>
                <thead>
                  <tr>
                    {e.columns.map((c, j) => (
                      <th key={j}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {e.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((v, k) => (
                        <td key={k} className={v === null ? 'is-null' : typeof v === 'number' ? 'is-num' : ''}>
                          {cell(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                {e.rows.length === 0 ? 'No rows' : `${e.rows.length + e.more} row${e.rows.length + e.more === 1 ? '' : 's'}`}
                {e.more > 0 && ` (showing the first ${e.rows.length})`}
              </p>
            </div>
          ) : (
            <pre key={i} className={`code-out-${e.kind}`}>
              {e.text}
            </pre>
          ),
        )}
        {state.phase === 'error' && (
          <div className="code-out-error">
            <pre>{state.text}</pre>
            {onAskError && (
              <button className="btn btn-ghost btn-sm" onClick={onAskError}>
                <MessageCircle size={15} className="text-iris" /> Ask Chip what this error means
              </button>
            )}
          </div>
        )}
      </div>
      {/* The page keeps running while its output is read (hidden, not removed). */}
      {preview &&
        (preview.kind === 'web' ? (
          <iframe key="web" className="code-out-frame" hidden={tab !== 'preview'} title={`Preview of ${preview.page}`} sandbox="allow-scripts allow-modals allow-forms" srcDoc={preview.html} />
        ) : (
          <div className="code-out-md chip-md" hidden={tab !== 'preview'} dangerouslySetInnerHTML={{ __html: preview.html }} />
        ))}
    </section>
  );
}
