import type { Diagnostic } from '@codemirror/lint';
import type { Text } from '@codemirror/state';

/** Format and check code, each tool loaded only when it's first needed: Prettier for the web
 * languages, Ruff for Python (formatting and the problems it finds), sql-formatter for SQL. */

type Workspace = { format(code: string): string; check(code: string): RuffDiagnostic[] };
interface RuffDiagnostic {
  code: string | null;
  message: string;
  tags?: string[];
  start_location: { row: number; column: number };
  end_location: { row: number; column: number };
}

let ruff: Promise<Workspace> | null = null;
let ruffReady: Workspace | null = null;

/** Ruff (about 4 MB over the network), loaded when Python is first run or formatted. */
export function loadRuff(): Promise<Workspace> {
  ruff ??= import('@astral-sh/ruff-wasm-web')
    .then(async (m) => {
      await m.default();
      const settings = m.Workspace.defaultSettings() as Record<string, unknown>;
      const ws = new m.Workspace({ ...settings, lint: { ...(settings.lint as object), select: ['E4', 'E7', 'E9', 'F'] } }, m.PositionEncoding.Utf16) as unknown as Workspace;
      ruffReady = ws;
      return ws;
    })
    .catch((err: unknown) => {
      ruff = null;
      throw err;
    });
  return ruff;
}

export const canFormat = (lang: string) => ['python', 'javascript', 'typescript', 'html', 'css', 'markdown', 'sql'].includes(lang);

/** [code] formatted the standard way for [lang]. Throws with the reason when the code can't be
 * read (a syntax error), so the student knows why nothing changed. */
export async function formatCode(lang: string, code: string, tabSize: number): Promise<string> {
  if (lang === 'python') return (await loadRuff()).format(code);
  if (lang === 'sql') return (await import('sql-formatter')).format(code, { language: 'sqlite', tabWidth: tabSize, keywordCase: 'upper' });
  const prettier = await import('prettier/standalone');
  const opts = { tabWidth: tabSize, printWidth: 100, singleQuote: false };
  if (lang === 'javascript') return prettier.format(code, { ...opts, parser: 'babel', plugins: [await import('prettier/plugins/babel'), await import('prettier/plugins/estree')] });
  if (lang === 'typescript') return prettier.format(code, { ...opts, parser: 'typescript', plugins: [await import('prettier/plugins/typescript'), await import('prettier/plugins/estree')] });
  if (lang === 'css') return prettier.format(code, { ...opts, parser: 'css', plugins: [await import('prettier/plugins/postcss')] });
  if (lang === 'markdown') return prettier.format(code, { ...opts, parser: 'markdown', plugins: [await import('prettier/plugins/markdown')] });
  if (lang === 'html')
    return prettier.format(code, {
      ...opts,
      parser: 'html',
      plugins: await Promise.all([import('prettier/plugins/html'), import('prettier/plugins/postcss'), import('prettier/plugins/babel'), import('prettier/plugins/estree')]),
    });
  throw new Error('This language can’t be formatted here yet.');
}

/** A formatter's error, short: the first line, without the stack. */
export const formatError = (err: unknown) => String((err as Error)?.message ?? err).split('\n')[0].slice(0, 200);

const at = (doc: Text, row: number, column: number) => {
  const line = doc.line(Math.min(Math.max(row, 1), doc.lines));
  return Math.min(line.from + Math.max(column - 1, 0), line.to);
};

/** The problems Ruff sees in Python [doc]: none until Ruff has been loaded (by a run or a format),
 * so opening a file never downloads it. */
export function pythonProblems(doc: Text): Diagnostic[] {
  if (!ruffReady) return [];
  let found: RuffDiagnostic[];
  try {
    found = ruffReady.check(doc.toString());
  } catch {
    return [];
  }
  return found.slice(0, 200).map((d) => {
    const from = at(doc, d.start_location.row, d.start_location.column);
    const to = Math.max(at(doc, d.end_location.row, d.end_location.column), from);
    const serious = !d.code || d.code.startsWith('E9') || /^F(821|822|823|63|7)/.test(d.code);
    return {
      from,
      to,
      severity: serious ? 'error' : d.tags?.includes('unnecessary') ? 'info' : 'warning',
      message: d.message,
      source: d.code ? `Ruff ${d.code}` : 'Python',
      markClass: d.tags?.includes('unnecessary') ? 'cm-unused' : undefined,
    } satisfies Diagnostic;
  });
}
