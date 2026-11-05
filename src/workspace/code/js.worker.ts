/// <reference lib="webworker" />
/** Runs JavaScript and TypeScript in a fresh worker each time: every file becomes a module, so
 * `import { add } from './math.js'` finds the student's other tab, and `console`, `prompt()` and
 * `alert()` write to the output. TypeScript's types are taken out (Sucrase) and line numbers
 * stay the same. */

import { transform } from 'sucrase';
import { findModule, rewriteImports, show, type CodeFile } from './project.ts';
import type { RunEvent, RunRequest } from './runner.ts';

declare const self: DedicatedWorkerGlobalScope & { prompt?: (m?: string) => string | null; alert?: (m?: unknown) => void };

let run = 0;
const post = (e: RunEvent) => self.postMessage({ run, ...e });

const line = (args: unknown[]) => `${args.map((a) => show(a)).join(' ')}\n`;

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { files, main, stdin } = e.data;
  run = e.data.run;
  const input = [...stdin];
  const started = performance.now();
  let failed = false;

  console.log = console.info = console.debug = (...a: unknown[]) => post({ type: 'out', text: line(a) });
  console.error = console.warn = (...a: unknown[]) => post({ type: 'err', text: line(a) });
  console.table = (data: unknown) => {
    if (data && typeof data === 'object') {
      const rows = Object.entries(data as Record<string, unknown>);
      const columns = [...new Set(rows.flatMap(([, r]) => (r && typeof r === 'object' ? Object.keys(r) : ['Values'])))];
      post({ type: 'table', columns: ['(index)', ...columns], rows: rows.map(([k, r]) => [k, ...columns.map((c) => show(r && typeof r === 'object' ? (r as Record<string, unknown>)[c] : c === 'Values' ? r : '', 1))]), more: 0 });
    } else console.log(data);
  };
  self.prompt = (m?: string) => {
    const answer = input.shift();
    post({ type: 'out', text: `${m ?? ''}${m && !/\s$/.test(m) ? ' ' : ''}${answer ?? ''}\n` });
    return answer ?? null;
  };
  self.alert = (m?: unknown) => post({ type: 'out', text: line([m]) });

  // Each file as a module, the ones it imports first; blob URLs in errors become file names.
  const urls = new Map<string, string>();
  const names = new Map<string, string>();
  const build = (file: CodeFile, path: string[]): string => {
    const known = urls.get(file.name);
    if (known) return known;
    if (path.includes(file.name)) throw new Error(`${[...path, file.name].join(' → ')} import each other in a circle. Move what they share into a third file.`);
    let code: string;
    try {
      // Every file goes through Sucrase: TypeScript loses its types, and a syntax error says where
      // it is (the browser's own message doesn't).
      code = transform(file.code, { transforms: /\.(m|c)?tsx?$/i.test(file.name) ? ['typescript'] : [], disableESTransforms: true, filePath: file.name }).code;
    } catch (err) {
      const at = /\((\d+):(\d+)\)\s*$/.exec((err as Error).message);
      const what = (err as Error).message.replace(/^Error transforming [^:]+: /, '').replace(/\s*\(\d+:\d+\)\s*$/, '');
      throw Object.assign(new SyntaxError(`${what}${at ? ` (line ${at[1]}, column ${at[2]})` : ''} in ${file.name}`), { stack: '' });
    }
    code = rewriteImports(code, (spec) => {
      const target = findModule(files, spec);
      return target ? build(target, [...path, file.name]) : null;
    });
    const url = URL.createObjectURL(new Blob([`${code}\n//# sourceURL=${file.name}`], { type: 'text/javascript' }));
    urls.set(file.name, url);
    names.set(url, file.name);
    return url;
  };
  const named = (text: string) => [...names].reduce((t, [url, name]) => t.split(url).join(name), text);
  const fail = (err: unknown) => {
    failed = true;
    const er = err as Error;
    const where = er?.stack?.split('\n').find((l) => /blob:|\.m?[jt]sx?:\d+/.test(l));
    post({ type: 'error', text: named(`${er?.name ?? 'Error'}: ${er?.message ?? String(err)}${where ? `\n    ${where.trim().replace(/^at /, 'at ')}` : ''}`), ms: performance.now() - started });
  };
  self.addEventListener('error', (ev) => (ev.preventDefault(), fail(ev.error ?? new Error(ev.message))));
  self.addEventListener('unhandledrejection', (ev) => (ev.preventDefault(), fail(ev.reason)));

  try {
    const url = build(main, []);
    await import(/* @vite-ignore */ url);
    if (!failed) post({ type: 'done', ms: performance.now() - started });
  } catch (err) {
    fail(err);
  }
};
