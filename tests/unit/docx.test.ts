import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { docxText, readZipEntry } from '../../src/lib/zip.ts';

/** A minimal zip with [files], each deflated (or stored). */
function zip(files: Record<string, string>, store = false): ArrayBuffer {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const raw = enc.encode(body);
    const data = store ? raw : new Uint8Array(deflateRawSync(raw));
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, store ? 0 : 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(data, 30 + n.length);
    const central = new Uint8Array(46 + n.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, store ? 0 : 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    central.set(n, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    all.set(part, at);
    at += part.length;
  }
  return all.buffer;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docXml = `<?xml version="1.0"?><w:document ${W}><w:body>
<w:p><w:r><w:t>Assignment 2: Coastal</w:t></w:r><w:r><w:t xml:space="preserve"> erosion</w:t></w:r></w:p>
<w:p><w:r><w:t>Word count:</w:t><w:tab/><w:t>1,500</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Criterion</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Weight</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Argument</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>40%</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p>
</w:body></w:document>`;

describe('reading Word files', () => {
  it('finds and inflates an entry', async () => {
    const z = zip({ 'a.txt': 'hello', 'word/document.xml': 'x'.repeat(500) });
    expect(await readZipEntry(z, 'a.txt')).toBe('hello');
    expect(await readZipEntry(z, 'word/document.xml')).toBe('x'.repeat(500));
    expect(await readZipEntry(z, 'missing')).toBeNull();
    expect(await readZipEntry(zip({ 'a.txt': 'stored' }, true), 'a.txt')).toBe('stored');
  });
  it('takes paragraphs, tabs, breaks and tables out of a .docx', async () => {
    const text = await docxText(zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': docXml }));
    expect(text).toBe('Assignment 2: Coastal erosion\nWord count:\t1,500\nCriterion\tWeight\nArgument\t40%\nLine one\nline two');
  });
  it('says so when it isn’t a Word file', async () => {
    await expect(docxText(zip({ 'other.xml': '<x/>' }))).rejects.toThrow('Word document');
    await expect(docxText(new TextEncoder().encode('not a zip').buffer)).rejects.toThrow();
  });
});
