/** A student's code files work together like a small project: the code tabs of one assignment.
 * `index.html` pulls in `style.css` and `script.js`, `main.py` imports `helper.py`, and
 * `main.js` imports `./math.js`. These helpers are pure so they can be tested. */

export interface CodeFile {
  name: string;
  code: string;
}

const norm = (path: string) => path.trim().replace(/^\.\//, '').toLowerCase();

/** The file [path] points to (`./style.css`, `style.css`), or null for anything else (a URL, a
 * folder we don't have). */
export function findFile(files: CodeFile[], path: string): CodeFile | null {
  if (/^[a-z]+:|^\/\//i.test(path.trim())) return null;
  const want = norm(path);
  return files.find((f) => norm(f.name) === want) ?? null;
}

/** For JavaScript imports: `./math` finds `math.js` or `math.ts` too, as bundlers do. */
export function findModule(files: CodeFile[], spec: string): CodeFile | null {
  if (!/^\.\.?\//.test(spec)) return null;
  const want = norm(spec);
  return files.find((f) => norm(f.name) === want) ?? files.find((f) => norm(f.name).replace(/\.(m|c)?[jt]sx?$/, '') === want) ?? null;
}

/** The HTML page to show when [active] runs: the page itself, or the page that uses this
 * stylesheet or script (`index.html` first). */
export function pageFor(files: CodeFile[], active: CodeFile): CodeFile | null {
  if (/\.html?$/i.test(active.name)) return active;
  const pages = files.filter((f) => /\.html?$/i.test(f.name));
  const uses = (p: CodeFile) => [...p.code.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)].some((m) => norm(m[1]) === norm(active.name));
  const index = pages.find((p) => norm(p.name) === 'index.html');
  if (/\.css$/i.test(active.name)) return pages.find(uses) ?? index ?? pages[0] ?? null;
  return pages.find(uses) ?? null;
}

const escapeEnd = (code: string, tag: string) => code.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

/** [page] ready for a sandboxed frame: its stylesheets and scripts from the other files written
 * in, with [bridge] (the console that reports back) first in the head. */
export function buildPage(files: CodeFile[], page: CodeFile, bridge: string): string {
  let html = page.code
    .replace(/<link\b[^>]*>/gi, (tag) => {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      const file = href && /stylesheet/i.test(tag) ? findFile(files, href) : null;
      return file ? `<style data-file="${file.name}">\n${escapeEnd(file.code, 'style')}\n</style>` : tag;
    })
    .replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, before: string, src: string, after: string) => {
      const file = findFile(files, src);
      return file ? `<script${`${before}${after}`.replace(/\s+$/, '')} data-file="${file.name}">\n${escapeEnd(file.code, 'script')}\n//# sourceURL=${file.name}\n</script>` : tag;
    });
  const head = `<script>${bridge}</script>`;
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (h) => `${h}${head}`);
  else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (h) => `${h}<head>${head}</head>`);
  else html = `${head}${html}`;
  return html;
}

/** [code] with its relative imports (`import x from './math.js'`, `export * from './a'`,
 * `import('./b')`) pointed wherever [resolve] says; ones it can't resolve stay as written. */
export function rewriteImports(code: string, resolve: (spec: string) => string | null): string {
  const swap = (whole: string, quote: string, spec: string) => {
    const to = resolve(spec);
    return to ? whole.replace(`${quote}${spec}${quote}`, `${quote}${to}${quote}`) : whole;
  };
  return code
    .replace(/(\b(?:import|export)\b[^'"`;]*?\bfrom\s*)(["'])([^"']+)\2/g, (whole, _lead, q: string, spec: string) => swap(whole, q, spec))
    .replace(/(\bimport\s*)(["'])([^"']+)\2/g, (whole, _lead, q: string, spec: string) => swap(whole, q, spec))
    .replace(/(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g, (whole, _lead, q: string, spec: string) => swap(whole, q, spec));
}

/** A Python traceback without the frames of the machinery that runs it in the browser: only the
 * student's own files and the error. */
export function cleanTraceback(text: string): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^ {2}File "/.test(line)) skipping = /^ {2}File "\/lib\/|^ {2}File "<exec>"/.test(line);
    else if (!/^ {4}/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  // A traceback left with no frames says nothing more than its last line.
  return out.length === 2 && out[0].startsWith('Traceback') ? out[1] : out.join('\n');
}

/** A value as the console would show it: strings as they are, everything else readable. */
export function show(v: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
  if (typeof v === 'function') return `[Function ${v.name || '(anonymous)'}]`;
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'symbol') return v.toString();
  if (v === null || typeof v !== 'object') return String(v);
  if (v instanceof Error) return depth ? `[${v.name}: ${v.message}]` : `${v.name}: ${v.message}`;
  if (seen.has(v)) return '[Circular]';
  if (depth > 3) return Array.isArray(v) ? '[Array]' : '[Object]';
  seen.add(v);
  const inner = (x: unknown) => show(x, depth + 1, seen);
  if (Array.isArray(v)) return `[ ${v.slice(0, 100).map(inner).join(', ')}${v.length > 100 ? `, … ${v.length - 100} more` : ''} ]`.replace('[  ]', '[]');
  if (v instanceof Map) return `Map(${v.size}) { ${[...v].slice(0, 50).map(([k, x]) => `${inner(k)} => ${inner(x)}`).join(', ')} }`;
  if (v instanceof Set) return `Set(${v.size}) { ${[...v].slice(0, 50).map(inner).join(', ')} }`;
  if (v instanceof Date) return v.toISOString();
  const name = v.constructor && v.constructor !== Object ? `${v.constructor.name} ` : '';
  const entries = Object.entries(v).slice(0, 50).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${inner(x)}`);
  return entries.length ? `${name}{ ${entries.join(', ')} }` : `${name}{}`;
}
