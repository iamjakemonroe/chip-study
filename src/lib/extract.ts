import { kindOf, type FileKind } from './filetypes.ts';
import { epubText, htmlText, notebookText, openDocumentText, rtfText, slidesText, workbookText } from './office.ts';
import { docxText, openZip } from './zip.ts';

export { cantRead, hasText, kindOf, type FileKind } from './filetypes.ts';

/** Text from a file the student adds (an assignment sheet, a reading, their data or code), taken
 * out on their own device. PDFs are read with pdf.js; Word, Excel (formulas and an .xlsm's macros
 * too, never run), PowerPoint, OpenDocument and EPUB files with our own small readers; RTF,
 * notebooks, web pages, text, data and code as text. A photo, or a scanned PDF with no text in
 * it, comes back empty for Chip to read instead. */

export async function extractText(file: File): Promise<{ kind: FileKind; text: string; pages?: number }> {
  const kind = kindOf(file);
  if (kind === 'text') return { kind, text: (await file.text()).trim() };
  if (kind === 'rtf') return { kind, text: rtfText(await file.text()) };
  if (kind === 'notebook') return { kind, text: notebookText(await file.text()) };
  if (kind === 'html') return { kind, text: htmlText(await file.text()) };
  if (kind === 'docx') return { kind, text: await docxText(await file.arrayBuffer()) };
  if (kind === 'sheet' || kind === 'slides' || kind === 'opendoc' || kind === 'epub') {
    const zip = openZip(await file.arrayBuffer());
    if (!zip) throw new Error(`${file.name} couldn’t be opened. Is it protected with a password? Save a copy without one, then add that.`);
    const read = kind === 'sheet' ? workbookText : kind === 'slides' ? slidesText : kind === 'opendoc' ? openDocumentText : epubText;
    return { kind, text: await read(zip) };
  }
  if (kind === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = '';
        } else if (item.str && !item.str.endsWith(' ')) line += ' ';
      }
      if (line.trim()) lines.push(line);
      pages.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).join('\n'));
    }
    const pagesRead = pdf.numPages;
    await task.destroy();
    return { kind, text: pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(), pages: pagesRead };
  }
  return { kind, text: '' };
}

/** A file as base64 (for Chip to read a scan or a photo). */
export async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function mediaType(file: File): string {
  const kind = kindOf(file);
  if (kind === 'pdf') return 'application/pdf';
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split('.').pop();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
}
