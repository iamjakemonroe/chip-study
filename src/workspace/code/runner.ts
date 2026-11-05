import type { CodeFile } from './project.ts';

/** Starts and stops the workers that run code. Python keeps its worker between runs (loading
 * Python takes seconds); JavaScript and SQL get a fresh one each time. Stop ends the worker, so
 * an endless loop really stops. */

export interface RunRequest {
  run: number;
  files: CodeFile[];
  main: CodeFile;
  /** What the program reads, a line per input() or prompt(). */
  stdin: string[];
}

export type RunEvent =
  | { type: 'out' | 'err' | 'note' | 'status'; text: string }
  | { type: 'image'; data: string }
  | { type: 'table'; columns: string[]; rows: unknown[][]; more: number }
  | { type: 'done'; ms: number }
  | { type: 'error'; text: string; ms: number };

export type WorkerKind = 'python' | 'js' | 'sql';

export interface RunHandle {
  /** Ends the run now (and the worker with it, unless it's Python that has finished). */
  stop(): void;
}

let python: Worker | null = null;
let runs = 0;

const spawn = (kind: WorkerKind) =>
  kind === 'python'
    ? new Worker(new URL('./py.worker.ts', import.meta.url), { type: 'module', name: 'python' })
    : kind === 'js'
      ? new Worker(new URL('./js.worker.ts', import.meta.url), { type: 'module', name: 'javascript' })
      : new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module', name: 'sqlite' });

export function startRun(kind: WorkerKind, req: Omit<RunRequest, 'run'>, onEvent: (e: RunEvent) => void): RunHandle {
  const run = ++runs;
  const worker = kind === 'python' ? (python ??= spawn('python')) : spawn(kind);
  let finished = false;
  const onMessage = (e: MessageEvent<RunEvent & { run: number }>) => {
    if (e.data.run !== run) return;
    if (e.data.type === 'done' || e.data.type === 'error') {
      finished = true;
      if (kind === 'sql') worker.terminate();
    }
    onEvent(e.data);
  };
  const onCrash = (e: ErrorEvent) => {
    e.preventDefault();
    if (!finished) onEvent({ type: 'error', text: e.message || 'The code runner couldn’t start. Check your connection and run again.', ms: 0 });
    finished = true;
    end();
  };
  const end = () => {
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onCrash);
    if (kind !== 'python' || !finished) {
      worker.terminate();
      if (python === worker) python = null;
    }
  };
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onCrash);
  worker.postMessage({ ...req, run } satisfies RunRequest);
  return { stop: end };
}

/** The console of a web page in the preview frame: what it logs and its errors come to the
 * output, tagged with [token] so nothing else can pose as it. */
export function previewBridge(token: string): string {
  // The frame has no origin of its own (so it can't reach the app), which makes localStorage
  // throw; pages that use it (a to-do list) get one that lasts until the next run.
  return `(()=>{try{localStorage}catch{const m=()=>{const d=new Map();return{getItem:k=>d.has(String(k))?d.get(String(k)):null,setItem:(k,v)=>{d.set(String(k),String(v))},removeItem:k=>{d.delete(String(k))},clear:()=>d.clear(),key:i=>[...d.keys()][i]??null,get length(){return d.size}}};for(const n of ['localStorage','sessionStorage'])try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch{}}const t=${JSON.stringify(token)};const f=v=>{if(typeof v==='string')return v;if(v instanceof Error)return v.name+': '+v.message;try{return JSON.stringify(v)}catch{return String(v)}};const s=(type,a)=>parent.postMessage({chipPreview:t,type,text:a.map(f).join(' ')+'\\n'},'*');for(const k of ['log','info','debug']){const o=console[k];console[k]=(...a)=>{s('out',a);o.apply(console,a)}}for(const k of ['warn','error']){const o=console[k];console[k]=(...a)=>{s('err',a);o.apply(console,a)}}addEventListener('error',e=>s('err',[e.message+(e.lineno?' ('+(e.filename&&!/^about:/.test(e.filename)?e.filename.split('/').pop()+', ':'')+'line '+e.lineno+')':'')]));addEventListener('unhandledrejection',e=>s('err',['Unhandled promise rejection: '+f(e.reason)]))})();`;
}
