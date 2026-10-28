import { docxText } from './zip.ts';

/** Text from a file the student adds (an assignment sheet, a reading), taken out on their own
 * device. PDFs are read with pdf.js, Word files with our own small reader; a photo, or a scanned
 * PDF with no text in it, comes back empty for Chip to read instead. */

export type FileKind = 'pdf' | 'docx' | 'text' | 'image' | 'other';

export function kindOf(file: File): FileKind {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (/^image\/(png|jpe?g|webp|gif)$/.test(file.type) || /\.(png|jpe?g|webp|gif)$/.test(name)) return 'image';
  if (file.type.startsWith('text/') || /\.(txt|md|markdown|csv|rtf)$/.test(name)) return 'text';
  return 'other';
}

export async function extractText(file: File): Promise<{ kind: FileKind; text: string; pages?: number }> {
  const kind = kindOf(file);
  if (kind === 'text') return { kind, text: (await file.text()).trim() };
  if (kind === 'docx') return { kind, text: await docxText(await file.arrayBuffer()) };
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
