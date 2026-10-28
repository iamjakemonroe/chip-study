/** Just enough of a zip reader to open a Word file (.docx) in the browser: finds an entry by
 * name and inflates it with the browser's own DecompressionStream. */

export async function readZipEntry(data: ArrayBuffer, name: string): Promise<string | null> {
  const view = new DataView(data);
  // The end of central directory record: its signature, searched for from the end.
  let eocd = -1;
  for (let i = data.byteLength - 22; i >= Math.max(0, data.byteLength - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) return null;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const entry = decoder.decode(new Uint8Array(data, at + 46, nameLength));
    if (entry === name) {
      const localName = view.getUint16(local + 26, true);
      const localExtra = view.getUint16(local + 28, true);
      const start = local + 30 + localName + localExtra;
      const bytes = new Uint8Array(data, start, compressed);
      if (method === 0) return decoder.decode(bytes);
      if (method !== 8) return null;
      const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** The text of a Word document: paragraphs on their own lines, tabs and breaks kept, table
 * cells separated by tabs. */
export async function docxText(data: ArrayBuffer): Promise<string> {
  const xml = await readZipEntry(data, 'word/document.xml');
  if (!xml) throw new Error('That doesn’t look like a Word document.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const out: string[] = [];
  const paragraph = (p: Element): string => {
    let text = '';
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (child.namespaceURI !== W) continue;
        if (child.localName === 't') text += child.textContent ?? '';
        else if (child.localName === 'tab') text += '\t';
        else if (child.localName === 'br' || child.localName === 'cr') text += '\n';
        else if (child.localName !== 'p') walk(child);
      }
    };
    walk(p);
    return text;
  };
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) return '';
  for (const block of Array.from(body.children)) {
    if (block.localName === 'p') out.push(paragraph(block));
    else if (block.localName === 'tbl') {
      for (const row of Array.from(block.getElementsByTagNameNS(W, 'tr'))) {
        const cells = Array.from(row.getElementsByTagNameNS(W, 'tc')).map((cell) =>
          Array.from(cell.getElementsByTagNameNS(W, 'p')).map(paragraph).join(' ').trim(),
        );
        out.push(cells.join('\t'));
      }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
