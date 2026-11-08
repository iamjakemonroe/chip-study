/** Python for the code editor (Pyodide) served from study.kaivon.app itself, at
 * /pyodide/<version>/full/<file>.
 *
 * Every file lives in R2 (the PYODIDE binding). The first time a file is asked for, it is copied
 * once from the same pinned release on jsDelivr and kept; from then on our copy is served. So
 * students' Python keeps working when a third-party CDN is slow or down, and their browsers never
 * talk to it. A release never changes, so files are cached for a year.
 *
 * Only the pinned release is served (the bucket is not a mirror for anyone's version), only
 * GET/HEAD, only plain file names, and nothing larger than MAX_BYTES. Without the binding (a
 * local run, or before go-live), files come straight from upstream and nothing is kept. */

import { PYODIDE_UPSTREAM as UPSTREAM, PYODIDE_VERSION } from '../shared/pyodide.ts';

export { PYODIDE_VERSION, UPSTREAM };
/** The biggest file in a release is the WebAssembly runtime (about 10 MB); packages are smaller. */
export const MAX_BYTES = 64 * 1024 * 1024;

const PATH = /^\/pyodide\/(v\d+\.\d+\.\d+)\/full\/([A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)*)$/;

const TYPES: Record<string, string> = {
  mjs: 'text/javascript; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',
  json: 'application/json; charset=utf-8',
  zip: 'application/zip',
  whl: 'application/zip',
  tar: 'application/x-tar',
  txt: 'text/plain; charset=utf-8',
  map: 'application/json; charset=utf-8',
  'd.ts': 'text/plain; charset=utf-8',
};

/** What a file is served as: by its name, never by what upstream said. */
export function contentType(file: string): string {
  const name = file.split('/').pop() ?? file;
  if (name.endsWith('.d.ts')) return TYPES['d.ts'];
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return TYPES[ext] ?? 'application/octet-stream';
}

/** The file asked for, or null when the address isn't one we serve. */
export function pyodideFile(pathname: string): string | null {
  const m = PATH.exec(pathname);
  if (!m || m[1] !== PYODIDE_VERSION) return null;
  const file = m[2];
  if (file.split('/').some((s) => s === '.' || s === '..' || s.startsWith('.'))) return null;
  return file;
}

/** Just the parts of R2 used here, so tests can pass a plain fake. */
export interface PyodideBucket {
  get(key: string): Promise<{ body: ReadableStream; httpEtag: string; size: number } | null>;
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
}

const headers = (file: string, extra: Record<string, string> = {}): Headers =>
  new Headers({
    'content-type': contentType(file),
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    ...extra,
  });

const plain = (status: number, text: string, allow?: string): Response =>
  new Response(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...(allow ? { allow } : {}) },
  });

/** Answers /pyodide/... (the caller has already checked the path starts with /pyodide/). */
export async function servePyodide(
  request: Request,
  bucket: PyodideBucket | undefined,
  upstream: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Method not allowed', 'GET, HEAD');
  const file = pyodideFile(new URL(request.url).pathname);
  if (!file) return plain(404, 'Not found');
  const key = `${PYODIDE_VERSION}/full/${file}`;
  const head = request.method === 'HEAD';

  if (bucket) {
    const kept = await bucket.get(key);
    if (kept) {
      if (request.headers.get('if-none-match') === kept.httpEtag) {
        await kept.body.cancel();
        return new Response(null, { status: 304, headers: headers(file, { etag: kept.httpEtag }) });
      }
      const h = headers(file, { etag: kept.httpEtag, 'content-length': String(kept.size) });
      if (head) {
        await kept.body.cancel();
        return new Response(null, { status: 200, headers: h });
      }
      return new Response(kept.body, { status: 200, headers: h });
    }
  }

  let res: Response;
  try {
    res = await upstream(`${UPSTREAM}${key}`, { redirect: 'follow' });
  } catch (e) {
    console.error('pyodide upstream', key, e instanceof Error ? e.message : e);
    return plain(502, 'Python is not reachable right now. Try again in a moment.');
  }
  if (res.status === 404) return plain(404, 'Not found');
  if (!res.ok) {
    console.error('pyodide upstream', key, res.status);
    return plain(502, 'Python is not reachable right now. Try again in a moment.');
  }
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) return plain(502, 'That file is too large to serve.');
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return plain(502, 'That file is too large to serve.');

  if (bucket) {
    try {
      await bucket.put(key, bytes, { httpMetadata: { contentType: contentType(file) } });
    } catch (e) {
      // Still answer: the next request tries to keep it again.
      console.error('pyodide keep', key, e instanceof Error ? e.message : e);
    }
  }
  return new Response(head ? null : bytes, { status: 200, headers: headers(file, { 'content-length': String(bytes.byteLength) }) });
}
