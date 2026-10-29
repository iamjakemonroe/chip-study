/** Which files Chip Study can read, by kind, and what the file pickers offer. Small on purpose:
 * the pickers load it with the page, and the readers (extract.ts) load when a file is added. */

export type FileKind = 'pdf' | 'docx' | 'sheet' | 'slides' | 'opendoc' | 'epub' | 'rtf' | 'notebook' | 'html' | 'text' | 'image' | 'old' | 'other';

// Plain text: notes, data, references, captions and code.
const TEXT = 'txt text md markdown csv tsv json jsonl xml yaml yml toml ini cfg log tex bib ris srt vtt py r rmd qmd m jl sas do sps sql js mjs cjs ts jsx tsx java kt kts scala c h cc cpp hpp cs go rs rb php swift dart lua pl hs ml f90 asm vb bas cls frm sh bash zsh ps1 bat css scss less vue svelte'.split(' ');
// Older or app-only formats, and what to save them as.
const OLD: Record<string, string> = {
  doc: 'Save it as a Word document (.docx) or a PDF',
  xls: 'Save it as an Excel workbook (.xlsx)',
  xlsb: 'Save it as an Excel workbook (.xlsx)',
  ppt: 'Save it as a PowerPoint file (.pptx) or a PDF',
  pages: 'Export it from Pages as Word or PDF',
  numbers: 'Export it from Numbers as Excel',
  key: 'Export it from Keynote as PowerPoint or PDF',
};

const extOf = (file: File) => (file.name.includes('.') ? file.name.toLowerCase().split('.').pop()! : '');

export function kindOf(file: File): FileKind {
  const ext = extOf(file);
  const type = file.type;
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['docx', 'docm', 'dotx'].includes(ext) || type.includes('wordprocessingml')) return 'docx';
  if (['xlsx', 'xlsm', 'xltx', 'xltm'].includes(ext) || type.includes('spreadsheetml') || type === 'application/vnd.ms-excel.sheet.macroenabled.12') return 'sheet';
  if (['pptx', 'pptm', 'ppsx', 'potx'].includes(ext) || type.includes('presentationml')) return 'slides';
  if (['odt', 'ods', 'odp'].includes(ext) || type.startsWith('application/vnd.oasis.opendocument')) return 'opendoc';
  if (ext === 'epub' || type === 'application/epub+zip') return 'epub';
  if (ext === 'rtf' || type === 'application/rtf' || type === 'text/rtf') return 'rtf';
  if (ext === 'ipynb') return 'notebook';
  if (['html', 'htm', 'xhtml'].includes(ext) || type === 'text/html') return 'html';
  if (/^image\/(png|jpe?g|webp|gif)$/.test(type) || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  if (ext in OLD) return 'old';
  if (TEXT.includes(ext) || type.startsWith('text/') || type === 'application/json') return 'text';
  return 'other';
}

/** Whether there's text to take out of a file of this kind (everything but photos and files we
 * can't open). */
export const hasText = (kind: FileKind) => kind !== 'image' && kind !== 'old' && kind !== 'other';

/** Why [file] can't be added, and what to do instead. */
export function cantRead(file: File): string {
  const old = OLD[extOf(file)];
  if (old) return `Chip can’t open ${file.name} as it is. ${old}, then add that.`;
  return `${file.name}: Chip reads PDFs, Word, Excel, PowerPoint, OpenDocument and EPUB files, text, data, code and photos.`;
}

const DOCUMENTS = ['pdf', 'docx', 'docm', 'xlsx', 'xlsm', 'xltx', 'pptx', 'pptm', 'ppsx', 'odt', 'ods', 'odp', 'epub', 'rtf', 'ipynb', 'html', 'htm', ...TEXT, ...Object.keys(OLD)];
/** What a file picker offers for readings: documents, data and code. */
export const ACCEPT_DOCUMENTS = [...DOCUMENTS.map((e) => `.${e}`), 'application/pdf', 'text/plain'].join(',');
/** ...and photos too. */
export const ACCEPT_ANY = `${ACCEPT_DOCUMENTS},image/png,image/jpeg,image/webp,image/gif`;
