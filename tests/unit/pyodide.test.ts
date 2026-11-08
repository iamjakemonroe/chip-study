// @vitest-environment node
// Python for the code editor, served from the site's own copy: only the pinned release, kept in
// R2 after its first download, with the right types and a year's caching.
import { describe, expect, it, vi } from 'vitest';
import { contentType, MAX_BYTES, pyodideFile, PYODIDE_VERSION, servePyodide, UPSTREAM, type PyodideBucket } from '../../worker/pyodide';

const V = PYODIDE_VERSION;
const at = (path: string, init?: RequestInit) => new Request(`https://study.kaivon.app${path}`, init);

function bucket(initial: Record<string, string> = {}) {
  const kept = new Map<string, { bytes: Uint8Array<ArrayBuffer>; type: string }>();
  for (const [k, v] of Object.entries(initial)) kept.set(k, { bytes: new TextEncoder().encode(v), type: '' });
  const b: PyodideBucket & { kept: typeof kept; puts: number } = {
    kept,
    puts: 0,
    async get(key) {
      const o = kept.get(key);
      if (!o) return null;
      return { body: new Blob([o.bytes]).stream(), httpEtag: `"${key.length}"`, size: o.bytes.byteLength };
    },
    async put(key, value, options) {
      b.puts++;
      kept.set(key, { bytes: new Uint8Array(value), type: options.httpMetadata.contentType });
    },
  };
  return b;
}

const upstreamWith = (body: string | null, status = 200, extra: Record<string, string> = {}) =>
  vi.fn(async () => new Response(body, { status, headers: extra }));

describe('which files', () => {
  it('serves only the pinned release, plain file names', () => {
    expect(pyodideFile(`/pyodide/${V}/full/pyodide.mjs`)).toBe('pyodide.mjs');
    expect(pyodideFile(`/pyodide/${V}/full/numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl`)).toBe('numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl');
    expect(pyodideFile('/pyodide/v0.27.0/full/pyodide.mjs')).toBeNull();
    expect(pyodideFile(`/pyodide/${V}/debug/pyodide.mjs`)).toBeNull();
    expect(pyodideFile(`/pyodide/${V}/full/../secrets`)).toBeNull();
    expect(pyodideFile(`/pyodide/${V}/full/a/../../b`)).toBeNull();
    expect(pyodideFile(`/pyodide/${V}/full/.env`)).toBeNull();
    expect(pyodideFile(`/pyodide/${V}/full/a%2F..%2Fb`)).toBeNull();
    expect(pyodideFile(`/pyodide/${V}/full/`)).toBeNull();
  });

  it('types files by name, never by what upstream says', () => {
    expect(contentType('pyodide.asm.wasm')).toBe('application/wasm');
    expect(contentType('pyodide.mjs')).toMatch(/^text\/javascript/);
    expect(contentType('pyodide-lock.json')).toMatch(/^application\/json/);
    expect(contentType('python_stdlib.zip')).toBe('application/zip');
    expect(contentType('pandas-2.3.whl')).toBe('application/zip');
    expect(contentType('ffi.d.ts')).toMatch(/^text\/plain/);
    expect(contentType('README')).toBe('application/octet-stream');
  });
});

describe('serving', () => {
  it('copies a file once from upstream, keeps it, and serves our copy after', async () => {
    const b = bucket();
    const up = upstreamWith('wasm-bytes', 200, { 'content-type': 'text/html' });
    const first = await servePyodide(at(`/pyodide/${V}/full/pyodide.asm.wasm`), b, up);
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('wasm-bytes');
    expect(first.headers.get('content-type')).toBe('application/wasm');
    expect(first.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(up).toHaveBeenCalledWith(`${UPSTREAM}${V}/full/pyodide.asm.wasm`, { redirect: 'follow' });
    expect(b.kept.get(`${V}/full/pyodide.asm.wasm`)?.type).toBe('application/wasm');

    const second = await servePyodide(at(`/pyodide/${V}/full/pyodide.asm.wasm`), b, up);
    expect(await second.text()).toBe('wasm-bytes');
    expect(second.headers.get('etag')).toBeTruthy();
    expect(up).toHaveBeenCalledTimes(1);
    expect(b.puts).toBe(1);
  });

  it('answers a matching etag with 304 and HEAD without a body', async () => {
    const b = bucket({ [`${V}/full/pyodide.mjs`]: 'export {}' });
    const etag = (await servePyodide(at(`/pyodide/${V}/full/pyodide.mjs`), b, upstreamWith(null))).headers.get('etag')!;
    const again = await servePyodide(at(`/pyodide/${V}/full/pyodide.mjs`, { headers: { 'if-none-match': etag } }), b, upstreamWith(null));
    expect(again.status).toBe(304);
    const head = await servePyodide(at(`/pyodide/${V}/full/pyodide.mjs`, { method: 'HEAD' }), b, upstreamWith(null));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('9');
    expect(await head.text()).toBe('');
  });

  it('never keeps a missing file, an upstream error or one too large', async () => {
    const b = bucket();
    expect((await servePyodide(at(`/pyodide/${V}/full/nope.whl`), b, upstreamWith('no', 404))).status).toBe(404);
    expect((await servePyodide(at(`/pyodide/${V}/full/x.whl`), b, upstreamWith('down', 503))).status).toBe(502);
    expect((await servePyodide(at(`/pyodide/${V}/full/x.whl`), b, vi.fn(async () => { throw new Error('offline'); }))).status).toBe(502);
    const huge = await servePyodide(at(`/pyodide/${V}/full/big.whl`), b, upstreamWith('x', 200, { 'content-length': String(MAX_BYTES + 1) }));
    expect(huge.status).toBe(502);
    expect(b.puts).toBe(0);
  });

  it('refuses other methods and other addresses without asking upstream', async () => {
    const up = upstreamWith('x');
    expect((await servePyodide(at(`/pyodide/${V}/full/pyodide.mjs`, { method: 'POST' }), bucket(), up)).status).toBe(405);
    expect((await servePyodide(at('/pyodide/v0.1.0/full/pyodide.mjs'), bucket(), up)).status).toBe(404);
    expect(up).not.toHaveBeenCalled();
  });

  it('still answers without a bucket, and when keeping fails', async () => {
    const plain = await servePyodide(at(`/pyodide/${V}/full/pyodide.mjs`), undefined, upstreamWith('export {}'));
    expect(await plain.text()).toBe('export {}');
    const broken = bucket();
    broken.put = async () => {
      throw new Error('r2 down');
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await servePyodide(at(`/pyodide/${V}/full/pyodide.mjs`), broken, upstreamWith('export {}'));
    expect(await res.text()).toBe('export {}');
    err.mockRestore();
  });
});
