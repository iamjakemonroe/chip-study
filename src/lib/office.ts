import { vbaModules } from './vba.ts';
import type { Zip } from './zip.ts';

/** Text from the other files a student adds, for Chip to read: Excel workbooks (with their
 * formulas, and the macros of an .xlsm), PowerPoint slides with their notes, OpenDocument files,
 * EPUB books, RTF, Jupyter notebooks and web pages. All of it is read on the student's device. */

const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');
const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
const kid = (el: Element, name: string) => Array.from(el.children).find((c) => c.localName === name);
const all = (el: Document | Element, name: string) => Array.from(el.getElementsByTagNameNS('*', name));
const oneLine = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();

/** [target] from a relationship in [dir], as a path in the zip. */
export function joinPath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = dir ? dir.split('/') : [];
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1).replace(/\/$/, '');

/** A part's relationships, by id: where each one points, and what kind it is. */
async function relationships(zip: Zip, part: string): Promise<Map<string, { target: string; type: string }>> {
  const out = new Map<string, { target: string; type: string }>();
  const text = await zip.text(joinPath(dirOf(part), `_rels/${part.split('/').pop()}.rels`));
  if (!text) return out;
  for (const r of all(xml(text), 'Relationship')) {
    out.set(r.getAttribute('Id') ?? '', { target: joinPath(dirOf(part), r.getAttribute('Target') ?? ''), type: r.getAttribute('Type') ?? '' });
  }
  return out;
}

// ── Excel ────────────────────────────────────────────────────────────────────

/** "A" for 0, "AA" for 26. */
export function columnName(n: number): string {
  let s = '';
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

const columnIndex = (ref: string) => {
  let n = 0;
  for (const ch of (ref.match(/^[A-Z]+/i)?.[0] ?? 'A').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

const MAX_ROWS = 5000;
const MAX_FORMULAS = 400;

/** Whether an Excel number format shows a date, a time, or neither. */
function dateFormat(id: number, code: string | undefined): 'date' | 'time' | null {
  if ((id >= 14 && id <= 17) || id === 22) return 'date';
  if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return 'time';
  if (!code) return null;
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, '');
  if (/[dy]/i.test(bare)) return 'date';
  if (/[hs]/i.test(bare)) return 'time';
  return null;
}

function excelDate(serial: number, as: 'date' | 'time', base1904: boolean): string | null {
  if (serial < 0 || serial > 2_958_465) return null; // Past the year 9999: not a date after all.
  const ms = Math.round((serial + (base1904 ? 1462 : 0)) * 86_400_000);
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  const iso = d.toISOString();
  if (as === 'time') return iso.slice(11, 19);
  return serial % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

const tidyNumber = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : v;
};

/** An Excel workbook (.xlsx or .xlsm): each sheet as a grid of values with row numbers and
 * column letters, then its formulas; named ranges; and an .xlsm's macros. */
export async function workbookText(zip: Zip): Promise<string> {
  const bookXml = await zip.text('xl/workbook.xml');
  if (!bookXml) throw new Error('That doesn’t look like an Excel workbook.');
  const book = xml(bookXml);
  const rels = await relationships(zip, 'xl/workbook.xml');

  const shared: string[] = [];
  const sst = await zip.text('xl/sharedStrings.xml');
  if (sst) {
    for (const si of all(xml(sst), 'si')) {
      // The text, without the phonetic guides (rPh) some files carry.
      shared.push(all(si, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent ?? '').join(''));
    }
  }

  const styles: ('date' | 'time' | null)[] = [];
  const stylesXml = await zip.text('xl/styles.xml');
  if (stylesXml) {
    const doc = xml(stylesXml);
    const codes = new Map(all(doc, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '']));
    const xfs = all(doc, 'cellXfs')[0];
    if (xfs) for (const xf of kids(xfs, 'xf')) styles.push(dateFormat(Number(xf.getAttribute('numFmtId') ?? 0), codes.get(Number(xf.getAttribute('numFmtId') ?? 0))));
  }
  const pr = all(book, 'workbookPr')[0];
  const base1904 = ['1', 'true'].includes(pr?.getAttribute('date1904') ?? '');

  const out: string[] = [];
  for (const sheet of all(book, 'sheet')) {
    const name = sheet.getAttribute('name') ?? 'Sheet';
    const hidden = sheet.getAttribute('state') && sheet.getAttribute('state') !== 'visible' ? ' (hidden)' : '';
    const rid = sheet.getAttribute('r:id') ?? Array.from(sheet.attributes).find((a) => a.localName === 'id')?.value ?? '';
    const rel = rels.get(rid);
    const text = rel && (await zip.text(rel.target));
    if (!text) continue; // A chart sheet, or one that's missing.
    const doc = xml(text);
    const rows = new Map<number, Map<number, string>>();
    const formulas: string[] = [];
    let extraFormulas = 0;
    let minCol = Infinity;
    let maxCol = -1;
    let rowCount = 0;
    let cutRows = 0;
    for (const row of all(doc, 'row')) {
      const cells = kids(row, 'c');
      if (!cells.length) continue;
      if (++rowCount > MAX_ROWS) {
        cutRows++;
        continue;
      }
      const r = Number(row.getAttribute('r')) || rowCount;
      const values = new Map<number, string>();
      cells.forEach((c, i) => {
        const ref = c.getAttribute('r') ?? `${columnName(i)}${r}`;
        const col = columnIndex(ref);
        const t = c.getAttribute('t');
        const v = kid(c, 'v')?.textContent ?? '';
        let value: string;
        if (t === 's') value = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') value = all(c, 't').map((x) => x.textContent ?? '').join('');
        else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'str' || t === 'e' || t === 'd') value = v;
        else if (v === '') value = '';
        else {
          const as = styles[Number(c.getAttribute('s') ?? 0)];
          value = (as && Number.isFinite(Number(v)) && excelDate(Number(v), as, base1904)) || tidyNumber(v);
        }
        const f = kid(c, 'f');
        if (f) {
          const shown = f.textContent ? `=${f.textContent}` : '';
          // A shared formula is written once, on the first cell of its range.
          const where = f.getAttribute('t') === 'shared' && f.getAttribute('ref') ? `${f.getAttribute('ref')} (filled from ${ref})` : ref;
          if (shown) {
            if (formulas.length < MAX_FORMULAS) formulas.push(`${where}: ${shown}${value !== '' ? ` → ${oneLine(value)}` : ''}`);
            else extraFormulas++;
          }
        }
        if (value === '') return;
        values.set(col, oneLine(value));
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
      });
      if (values.size) rows.set(r, values);
    }
    if (!rows.size) {
      out.push(`## Sheet "${name}"${hidden} (empty)`);
      continue;
    }
    const cols = Array.from({ length: maxCol - minCol + 1 }, (_, i) => minCol + i);
    const lines = [`## Sheet "${name}"${hidden}`, ['', ...cols.map(columnName)].join('\t')];
    for (const [r, values] of [...rows].sort((a, b) => a[0] - b[0])) lines.push([String(r), ...cols.map((c) => values.get(c) ?? '')].join('\t'));
    if (cutRows) lines.push(`(The first ${MAX_ROWS.toLocaleString()} rows with data; ${cutRows.toLocaleString()} more aren’t shown.)`);
    if (formulas.length) {
      lines.push('', `Formulas in "${name}":`, ...formulas);
      if (extraFormulas) lines.push(`(…and ${extraFormulas.toLocaleString()} more.)`);
    }
    out.push(lines.join('\n'));
  }

  const names = all(book, 'definedName').filter((n) => !n.getAttribute('name')?.startsWith('_xlnm'));
  if (names.length) out.push(['## Named ranges', ...names.map((n) => `${n.getAttribute('name')}: ${n.textContent}`)].join('\n'));

  const bin = await zip.bytes('xl/vbaProject.bin');
  if (bin) {
    const modules = vbaModules(bin);
    if (modules.length) out.push(['## Macros (VBA)', ...modules.map((m) => `### ${m.name}\n${m.code}`)].join('\n\n'));
  }
  return out.join('\n\n').trim();
}

// ── PowerPoint ───────────────────────────────────────────────────────────────

const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';

/** The paragraphs of a slide or its notes, one a line. */
function drawingText(doc: Document): string[] {
  return Array.from(doc.getElementsByTagNameNS(DRAWING, 'p'))
    .map((p) => {
      let text = '';
      for (const run of Array.from(p.children)) {
        if (run.localName === 'br') text += '\n';
        else if (run.localName === 'r' || run.localName === 'fld') text += kid(run, 't')?.textContent ?? '';
      }
      return text.trim();
    })
    .filter(Boolean);
}

/** A PowerPoint deck (.pptx): each slide's text in order, with the speaker's notes. */
export async function slidesText(zip: Zip): Promise<string> {
  const pres = await zip.text('ppt/presentation.xml');
  if (!pres) throw new Error('That doesn’t look like a PowerPoint file.');
  const rels = await relationships(zip, 'ppt/presentation.xml');
  let slides = all(xml(pres), 'sldId')
    .map((s) => rels.get(s.getAttribute('r:id') ?? Array.from(s.attributes).find((a) => a.localName === 'id' && a.prefix)?.value ?? '')?.target)
    .filter((t): t is string => !!t);
  if (!slides.length) {
    slides = zip.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  }
  const out: string[] = [];
  for (const [i, path] of slides.entries()) {
    const text = await zip.text(path);
    if (!text) continue;
    const lines = [`## Slide ${i + 1}`, ...drawingText(xml(text))];
    const notesPath = [...(await relationships(zip, path)).values()].find((r) => r.type.endsWith('/notesSlide'))?.target;
    const notes = notesPath ? await zip.text(notesPath) : null;
    // The notes page repeats the slide number; the rest is what the speaker wrote.
    const said = notes ? drawingText(xml(notes)).filter((l) => !/^\d+$/.test(l)) : [];
    if (said.length) lines.push(`Notes: ${said.join('\n')}`);
    out.push(lines.join('\n'));
  }
  return out.join('\n\n').trim();
}

// ── OpenDocument (LibreOffice, Google Docs downloads) ────────────────────────

const ODF_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const ODF_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const ODF_DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';

function odfParagraph(el: Element): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) text += node.textContent ?? '';
    else if (node.nodeType === 1) {
      const e = node as Element;
      if (e.localName === 's') text += ' '.repeat(Number(e.getAttributeNS(ODF_TEXT, 'c') ?? 1) || 1);
      else if (e.localName === 'tab') text += '\t';
      else if (e.localName === 'line-break') text += '\n';
      else if (e.localName !== 'note' && e.localName !== 'annotation') text += odfParagraph(e);
    }
  }
  return text;
}

/** Whether [el] is in a footnote or a comment (left out: they'd break up the text). */
const aside = (el: Element) => {
  for (let up = el.parentElement; up; up = up.parentElement) if (up.localName === 'note' || up.localName === 'annotation') return true;
  return false;
};

const odfParagraphs = (root: Element) =>
  Array.from(root.getElementsByTagNameNS(ODF_TEXT, '*'))
    .filter((e) => (e.localName === 'p' || e.localName === 'h') && !aside(e))
    .map((e) => odfParagraph(e).trim())
    .filter(Boolean);

/** An OpenDocument text, spreadsheet or presentation (.odt, .ods, .odp). */
export async function openDocumentText(zip: Zip): Promise<string> {
  const content = await zip.text('content.xml');
  if (!content) throw new Error('That doesn’t look like an OpenDocument file.');
  const doc = xml(content);
  const body = all(doc, 'body')[0];
  if (!body) return '';
  const sheet = all(body, 'spreadsheet')[0];
  if (sheet) {
    const out: string[] = [];
    for (const table of Array.from(sheet.getElementsByTagNameNS(ODF_TABLE, 'table'))) {
      const lines = [`## Sheet "${table.getAttributeNS(ODF_TABLE, 'name') ?? 'Sheet'}"`];
      let r = 0;
      for (const row of Array.from(table.getElementsByTagNameNS(ODF_TABLE, 'table-row'))) {
        const repeat = Number(row.getAttributeNS(ODF_TABLE, 'number-rows-repeated') ?? 1) || 1;
        const cells: string[] = [];
        for (const cell of Array.from(row.children)) {
          if (cell.localName !== 'table-cell' && cell.localName !== 'covered-table-cell') continue;
          const value = oneLine(odfParagraphs(cell).join(' '));
          const formula = cell.getAttributeNS(ODF_TABLE, 'formula');
          const shown = formula ? `${value} [${formula.replace(/^of:/, '')}]` : value;
          const times = Math.min(Number(cell.getAttributeNS(ODF_TABLE, 'number-columns-repeated') ?? 1) || 1, shown ? 200 : 1024);
          for (let i = 0; i < times; i++) cells.push(shown);
        }
        while (cells.length && !cells[cells.length - 1]) cells.pop();
        if (cells.length) {
          for (let i = 0; i < Math.min(repeat, 200); i++) lines.push([String(r + i + 1), ...cells].join('\t'));
          if (lines.length > MAX_ROWS) break;
        }
        r += repeat;
      }
      out.push(lines.length > 1 ? lines.join('\n') : `${lines[0]} (empty)`);
    }
    return out.join('\n\n').trim();
  }
  const pages = Array.from(body.getElementsByTagNameNS(ODF_DRAW, 'page'));
  if (pages.length) return pages.map((p, i) => [`## Slide ${i + 1}`, ...odfParagraphs(p)].join('\n')).join('\n\n').trim();
  return odfParagraphs(body).join('\n').trim();
}

// ── Web pages and EPUB books ─────────────────────────────────────────────────

const BLOCKS = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tr', 'ul']);

/** The readable text of an HTML page: a line for each block, cells split by tabs. */
export function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out += (child.textContent ?? '').replace(/\s+/g, ' ');
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = (child as Element).localName;
      if (['script', 'style', 'noscript', 'template', 'svg', 'head'].includes(tag)) continue;
      if (tag === 'pre') {
        out += `\n${child.textContent ?? ''}\n`;
        continue;
      }
      const block = BLOCKS.has(tag);
      if (block) out += '\n';
      walk(child);
      if (tag === 'td' || tag === 'th') out += '\t';
      if (block) out += '\n';
    }
  };
  walk(doc.body ?? doc.documentElement);
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, '').replace(/^ +/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** An EPUB book: its chapters in reading order. */
export async function epubText(zip: Zip): Promise<string> {
  const container = await zip.text('META-INF/container.xml');
  const opfPath = container ? all(xml(container), 'rootfile')[0]?.getAttribute('full-path') : null;
  const opfText = opfPath ? await zip.text(opfPath) : null;
  if (!opfPath || !opfText) throw new Error('That doesn’t look like an EPUB book.');
  const opf = xml(opfText);
  const hrefs = new Map(all(opf, 'item').map((i) => [i.getAttribute('id') ?? '', i.getAttribute('href') ?? '']));
  const title = all(opf, 'title')[0]?.textContent?.trim();
  const out: string[] = title ? [`# ${title}`] : [];
  for (const ref of all(opf, 'itemref')) {
    const href = hrefs.get(ref.getAttribute('idref') ?? '');
    if (!href) continue;
    const page = await zip.text(joinPath(dirOf(opfPath), decodeURIComponent(href.split('#')[0])));
    const text = page ? htmlText(page) : '';
    if (text) out.push(text);
  }
  return out.join('\n\n').trim();
}

// ── RTF and notebooks ────────────────────────────────────────────────────────

// Groups that hold settings, not the document's text.
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'fldinst', 'filetbl', 'revtbl', 'pgdsctbl', 'expandedcolortbl', 'shppict', 'nonshppict']);
const RTF_CHARS: Record<string, string> = { par: '\n', line: '\n', sect: '\n\n', page: '\n\n', row: '\n', cell: '\t', tab: '\t', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ' };

/** The text of an RTF document (TextEdit's and WordPad's format). */
export function rtfText(rtf: string): string {
  const cp1252 = new TextDecoder('windows-1252');
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let pending = 0; // Fallback characters still to drop after a \u.
  let out = '';
  const token = /\\([a-z]{1,32})(-?\d{1,10})? ?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|[\r\n]+|([^\\{}\r\n]+)/gi;
  for (const [, word, arg, hex, symbol, brace, text] of rtf.matchAll(token)) {
    if (brace) {
      pending = 0;
      if (brace === '{') stack.push({ skip, uc });
      else ({ skip, uc } = stack.pop() ?? { skip: false, uc: 1 });
    } else if (symbol) {
      pending = 0;
      if (symbol === '*') skip = true;
      else if (!skip && symbol === '~') out += ' ';
      else if (!skip && '{}\\'.includes(symbol)) out += symbol;
      else if (!skip && symbol === '\n') out += '\n';
    } else if (word) {
      pending = 0;
      if (RTF_SKIP.has(word)) skip = true;
      else if (skip) continue;
      else if (word in RTF_CHARS) out += RTF_CHARS[word];
      else if (word === 'uc') uc = Number(arg ?? 1);
      else if (word === 'u') {
        const code = Number(arg ?? 0);
        out += String.fromCharCode(code < 0 ? code + 0x10000 : code);
        pending = uc;
      }
    } else if (hex) {
      if (pending > 0) pending--;
      else if (!skip) out += cp1252.decode(new Uint8Array([parseInt(hex, 16)]));
    } else if (text) {
      let t = text;
      if (pending > 0) {
        const drop = Math.min(pending, t.length);
        t = t.slice(drop);
        pending -= drop;
      }
      if (!skip) out += t;
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

type NotebookCell = { cell_type?: string; source?: string | string[]; outputs?: { text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string }[] };

/** A Jupyter notebook (.ipynb): its cells in order, with their text output. */
export function notebookText(json: string): string {
  let nb: { cells?: NotebookCell[]; worksheets?: { cells?: NotebookCell[] }[]; metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } } };
  try {
    nb = JSON.parse(json);
  } catch {
    throw new Error('That notebook couldn’t be opened.');
  }
  const join = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join('') : (s ?? ''));
  const language = nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? '';
  const cells = nb.cells ?? nb.worksheets?.[0]?.cells ?? [];
  return cells
    .map((cell, i) => {
      const source = join(cell.source).trim();
      if (cell.cell_type !== 'code') return source;
      const outputs = (cell.outputs ?? [])
        .map((o) => (o.ename ? `${o.ename}: ${o.evalue ?? ''}` : join(o.text ?? o.data?.['text/plain'])))
        .map((t) => t.trim())
        .filter(Boolean);
      return [`In [${i + 1}]:`, '```' + language, source, '```', ...(outputs.length ? ['Out:', outputs.join('\n')] : [])].join('\n');
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}
