import type { LanguageSupport } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

/** The languages a code file can be in: how to colour it, its file name, and how it runs in the
 * browser (Python in WebAssembly, JavaScript in a worker, a web page in a sandboxed frame, SQL
 * in SQLite). Java and C++ are coloured and explained by Chip, not run. */

export type Runner = 'python' | 'js' | 'web' | 'sql' | 'markdown';

export interface Lang {
  id: string;
  name: string;
  /** The extension new files get, then every extension that means this language. */
  exts: string[];
  runner: Runner | null;
  load: () => Promise<Extension>;
}

export const LANGS: Lang[] = [
  { id: 'python', name: 'Python', exts: ['py', 'pyw'], runner: 'python', load: () => import('@codemirror/lang-python').then((m) => m.python()) },
  { id: 'javascript', name: 'JavaScript', exts: ['js', 'mjs', 'cjs', 'jsx'], runner: 'js', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript()) },
  { id: 'typescript', name: 'TypeScript', exts: ['ts', 'mts', 'cts', 'tsx'], runner: 'js', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })) },
  { id: 'html', name: 'HTML', exts: ['html', 'htm'], runner: 'web', load: () => Promise.all([import('@codemirror/lang-html'), emmet('html')]).then(([m, e]) => [m.html(), e]) },
  { id: 'css', name: 'CSS', exts: ['css'], runner: 'web', load: () => Promise.all([import('@codemirror/lang-css'), emmet('css'), import('@replit/codemirror-css-color-picker')]).then(([m, e, c]) => [m.css(), e, c.colorPicker]) },
  { id: 'sql', name: 'SQL (SQLite)', exts: ['sql'], runner: 'sql', load: () => import('@codemirror/lang-sql').then((m) => m.sql({ dialect: m.SQLite })) },
  { id: 'java', name: 'Java', exts: ['java'], runner: null, load: () => withWords(import('@codemirror/lang-java').then((m) => m.java())) },
  { id: 'cpp', name: 'C / C++', exts: ['cpp', 'cc', 'cxx', 'c', 'h', 'hpp'], runner: null, load: () => withWords(import('@codemirror/lang-cpp').then((m) => m.cpp())) },
  { id: 'markdown', name: 'Markdown', exts: ['md', 'markdown'], runner: 'markdown', load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()) },
];

/** Java and C++ come without suggestions: the words already in the file will do. */
function withWords(lang: Promise<LanguageSupport>): Promise<Extension> {
  return Promise.all([lang, import('@codemirror/autocomplete')]).then(([l, a]) => [l, l.language.data.of({ autocomplete: a.completeAnyWord })]);
}

/** Emmet: type `ul>li*3` or `m10` and press Tab. */
function emmet(syntax: 'html' | 'css'): Promise<Extension> {
  return import('@emmetio/codemirror6-plugin').then((m) => m.abbreviationTracker({ syntax: syntax === 'html' ? m.EmmetKnownSyntax.html : m.EmmetKnownSyntax.css }));
}

export const langById = (id: string): Lang => LANGS.find((l) => l.id === id) ?? LANGS[0];

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name.trim())?.[1].toLowerCase() ?? null;

/** The language a file name means (`index.html` → HTML), or null when it doesn't say. */
export function langFromName(name: string): Lang | null {
  const e = ext(name);
  return (e && LANGS.find((l) => l.exts.includes(e))) || null;
}

/** [name] with the extension of [lang], when it has a code extension now (`main.py` → `main.js`);
 * names without one are the student's choice and stay as they are. */
export function renameForLang(name: string, lang: Lang): string {
  const now = langFromName(name);
  if (!now || now.id === lang.id) return name;
  return name.trim().replace(/\.[a-z0-9]+$/i, `.${lang.exts[0]}`);
}

/** A file name not already taken in [taken]: `main.py`, then `main-2.py`… */
export function freeName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const [stem, tail] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 2; ; i++) if (!used.has(`${stem}-${i}${tail}`.toLowerCase())) return `${stem}-${i}${tail}`;
}
