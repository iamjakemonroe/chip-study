/// <reference lib="webworker" />
/** Runs Python in the browser (Pyodide, CPython in WebAssembly), off the page's thread so a long
 * loop never freezes the app; Stop ends the worker. Loaded once, then kept for the next run. The
 * student's other .py files are written beside main so `import helper` works, packages that come
 * with Pyodide (numpy, pandas, matplotlib…) load when imported, and plots come back as images. */

import { PYODIDE_UPSTREAM, PYODIDE_VERSION } from '../../../shared/pyodide.ts';
import type { RunEvent, RunRequest } from './runner.ts';

declare const self: DedicatedWorkerGlobalScope;

/** The site's own copy (served by the Worker, worker/pyodide.ts). The dev server and the e2e
 * preview have no Worker, so they load the same release from its CDN. */
const PYODIDE = import.meta.env.DEV || import.meta.env.MODE === 'e2e'
  ? `${PYODIDE_UPSTREAM}${PYODIDE_VERSION}/full/`
  : new URL(`/pyodide/${PYODIDE_VERSION}/full/`, self.location.origin).href;
const HOME = '/home/pyodide/project';

interface Pyodide {
  FS: { mkdirTree(p: string): void; writeFile(p: string, d: string): void; readdir(p: string): string[]; unlink(p: string): void; isDir(mode: number): boolean; stat(p: string): { mode: number } };
  setStdout(o: { write: (b: Uint8Array) => number }): void;
  setStderr(o: { write: (b: Uint8Array) => number }): void;
  setStdin(o: { stdin: () => string | null }): void;
  loadPackagesFromImports(code: string, o?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }): Promise<unknown>;
  runPythonAsync(code: string, o?: { globals?: unknown; filename?: string }): Promise<unknown>;
  runPython(code: string, o?: { globals?: unknown }): unknown;
  globals: { get(name: string): (() => PyDict) & unknown; set(name: string, v: unknown): void };
}
interface PyDict {
  set(k: string, v: unknown): void;
  destroy(): void;
}

let pyodide: Promise<Pyodide> | null = null;
let run = 0;
let pending = '';
let pendingErr = '';
let timer: ReturnType<typeof setTimeout> | null = null;

const post = (e: RunEvent) => self.postMessage({ run, ...e });

/** Output goes out in batches: a loop printing 100,000 lines mustn't send 100,000 messages. */
function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (pending) post({ type: 'out', text: pending });
  if (pendingErr) post({ type: 'err', text: pendingErr });
  pending = '';
  pendingErr = '';
}
const later = () => {
  if (pending.length + pendingErr.length > 16000) flush();
  else timer ??= setTimeout(flush, 40);
};
const decoder = new TextDecoder();
const errDecoder = new TextDecoder();

async function load(): Promise<Pyodide> {
  const { loadPyodide } = (await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`)) as { loadPyodide: (o: { indexURL: string }) => Promise<Pyodide> };
  const py = await loadPyodide({ indexURL: PYODIDE });
  py.setStdout({ write: (b) => ((pending += decoder.decode(b, { stream: true })), later(), b.length) });
  py.setStderr({ write: (b) => ((pendingErr += errDecoder.decode(b, { stream: true })), later(), b.length) });
  py.FS.mkdirTree(HOME);
  py.globals.set('_chip_image', (b64: string) => (flush(), post({ type: 'image', data: b64 })));
  // Plots: plt.show() sends the figures drawn so far (in order with the prints around them).
  py.runPython(`
import os, sys
os.environ["MPLBACKEND"] = "AGG"
def _chip_show_figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    import io, base64
    for n in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(n).savefig(buf, format="png", dpi=110, bbox_inches="tight")
        _chip_image(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
def _chip_patch_show():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None and getattr(plt.show, "__name__", "") != "_chip_show":
        def _chip_show(*args, **kwargs):
            _chip_show_figures()
        plt.show = _chip_show
`);
  return py;
}

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { files, main, stdin } = e.data;
  run = e.data.run;
  const input = [...stdin];
  try {
    if (!pyodide) {
      post({ type: 'status', text: 'Getting Python ready (the first run downloads about 10 MB)…' });
      pyodide = load();
    }
    const py = await pyodide.catch((err: unknown) => {
      pyodide = null;
      throw new Error(`Python couldn't load. Check your connection and run again. (${(err as Error).message})`);
    });
    // The project's files, fresh each run: files deleted since aren't importable any more.
    for (const name of py.FS.readdir(HOME)) if (name !== '.' && name !== '..' && !py.FS.isDir(py.FS.stat(`${HOME}/${name}`).mode)) py.FS.unlink(`${HOME}/${name}`);
    for (const f of files) if (/^[\w.-]+\.py$/i.test(f.name)) py.FS.writeFile(`${HOME}/${f.name}`, f.code);
    py.setStdin({
      stdin: () => {
        const line = input.shift();
        if (line === undefined) return null;
        pending += `${line}\n`;
        later();
        return line;
      },
    });
    const all = files.filter((f) => /\.py$/i.test(f.name)).map((f) => f.code).join('\n');
    await py.loadPackagesFromImports(all, {
      messageCallback: (m) => /^Loading /.test(m) && post({ type: 'status', text: m.replace(/^Loading /, 'Loading ').replace(/,? ?$/, '…') }),
      errorCallback: () => undefined,
    });
    post({ type: 'status', text: '' });
    // Each run starts clean: the project's modules are imported again, nothing is left over.
    py.runPython(`
import os, sys
os.chdir("${HOME}")
if "${HOME}" not in sys.path:
    sys.path.insert(0, "${HOME}")
for _name, _mod in list(sys.modules.items()):
    if (getattr(_mod, "__file__", None) or "").startswith("${HOME}/"):
        del sys.modules[_name]
`);
    const globals = py.globals.get('dict')();
    globals.set('__name__', '__main__');
    const started = performance.now();
    try {
      if (/\bmatplotlib\b/.test(all)) py.runPython('import matplotlib\nmatplotlib.use("AGG")\nimport matplotlib.pyplot\n_chip_patch_show()');
      await py.runPythonAsync(main.code, { globals, filename: main.name });
      py.runPython('_chip_show_figures()');
      flush();
      post({ type: 'done', ms: performance.now() - started });
    } catch (err) {
      py.runPython('_chip_show_figures()');
      flush();
      post({ type: 'error', text: String((err as Error).message ?? err), ms: performance.now() - started });
    } finally {
      globals.destroy();
    }
  } catch (err) {
    flush();
    post({ type: 'error', text: (err as Error).message ?? String(err), ms: 0 });
  }
};
