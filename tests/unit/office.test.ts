import { describe, expect, it } from 'vitest';
import { cantRead, hasText, kindOf } from '../../src/lib/filetypes.ts';
import { columnName, epubText, htmlText, joinPath, notebookText, openDocumentText, rtfText, slidesText, workbookText } from '../../src/lib/office.ts';
import { decompress } from '../../src/lib/vba.ts';
import { openZip } from '../../src/lib/zip.ts';
import { zip } from './zip_fixture.ts';

const open = (files: Record<string, string>) => openZip(zip(files))!;
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (items: [string, string, string?][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, target, type = `${REL}/worksheet`]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join('')}</Relationships>`;

describe('which files Chip reads', () => {
  const file = (name: string, type = '') => new File(['x'], name, { type });
  it('knows each kind by its name or type', () => {
    expect(kindOf(file('Q7.xlsm'))).toBe('sheet');
    expect(kindOf(file('data.XLSX'))).toBe('sheet');
    expect(kindOf(file('lecture.pptx'))).toBe('slides');
    expect(kindOf(file('essay.docm'))).toBe('docx');
    expect(kindOf(file('notes.odt'))).toBe('opendoc');
    expect(kindOf(file('book.epub'))).toBe('epub');
    expect(kindOf(file('draft.rtf'))).toBe('rtf');
    expect(kindOf(file('lab.ipynb'))).toBe('notebook');
    expect(kindOf(file('page.html'))).toBe('html');
    for (const name of ['analysis.py', 'model.R', 'query.sql', 'refs.bib', 'thesis.tex', 'data.csv', 'Main.java', 'app.ts']) expect(kindOf(file(name)), name).toBe('text');
    expect(kindOf(file('photo.jpg'))).toBe('image');
    expect(kindOf(file('old.doc'))).toBe('old');
    expect(kindOf(file('clip.mp4', 'video/mp4'))).toBe('other');
    expect(hasText('sheet') && !hasText('image') && !hasText('old')).toBe(true);
  });
  it('says what to do with a file it can’t open', () => {
    expect(cantRead(file('marks.xls'))).toBe('Chip can’t open marks.xls as it is. Save it as an Excel workbook (.xlsx), then add that.');
    expect(cantRead(file('clip.mp4'))).toMatch(/Chip reads PDFs, Word, Excel, PowerPoint/);
  });
});

describe('Excel', () => {
  it('reads each sheet as a grid, with its formulas, dates and named ranges', async () => {
    const text = await workbookText(
      open({
        'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>
          <sheet name="Sales" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2" state="hidden"/></sheets>
          <definedNames><definedName name="Rate">Sales!$B$4</definedName><definedName name="_xlnm.Print_Area">Sales!$A$1:$C$4</definedName></definedNames></workbook>`,
        'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheets/sheet1.xml'], ['rId2', '/xl/worksheets/sheet2.xml']]),
        'xl/sharedStrings.xml': `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Month</t></si><si><t>Units</t></si><si><r><t>Ja</t></r><r><t>n</t></r></si><si><t>Feb</t></si></sst>`,
        'xl/styles.xml': `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
        'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>45962</v></c></row>
          <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>0.30000000000000004</v></c></row>
          <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>12</v></c></row>
          <row r="4"><c r="A4" t="inlineStr"><is><t>Total</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>12.3</v></c><c r="C4" t="b"><v>1</v></c></row>
          </sheetData></worksheet>`.replace('<c r="C1">', '<c r="C1" s="1">'),
        'xl/worksheets/sheet2.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`,
      }),
    );
    expect(text).toBe(
      [
        '## Sheet "Sales"',
        '\tA\tB\tC',
        '1\tMonth\tUnits\t2025-11-01',
        '2\tJan\t0.3\t',
        '3\tFeb\t12\t',
        '4\tTotal\t12.3\tTRUE',
        '',
        'Formulas in "Sales":',
        'B4: =SUM(B2:B3) → 12.3',
        '',
        '## Sheet "Notes" (hidden) (empty)',
        '',
        '## Named ranges',
        'Rate: Sales!$B$4',
      ].join('\n'),
    );
  });

  it('names columns past Z', () => {
    expect([0, 25, 26, 51, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
  });
});

describe('VBA', () => {
  it('decompresses literals and copies (MS-OVBA)', () => {
    const literals = Uint8Array.from([0x01, 0x19, 0xb0, 0x00, ...'abcdefgh'.split('').map((c) => c.charCodeAt(0)), 0x00, ...'ijklmnop'.split('').map((c) => c.charCodeAt(0)), 0x00, ...'qrstuv.'.split('').map((c) => c.charCodeAt(0))]);
    expect(new TextDecoder().decode(decompress(literals))).toBe('abcdefghijklmnopqrstuv.');
    // "abc", then a token copying 6 bytes from 3 back.
    expect(new TextDecoder().decode(decompress(Uint8Array.from([0x01, 0x05, 0xb0, 0x08, 0x61, 0x62, 0x63, 0x03, 0x20])))).toBe('abcabcabc');
    expect(() => decompress(Uint8Array.from([0x02]))).toThrow();
  });
});

describe('PowerPoint', () => {
  it('reads slides in the deck’s order, with the notes', async () => {
    const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const slide = (lines: string[]) => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ${A}><p:cSld><p:spTree><p:sp><p:txBody>${lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const text = await slidesText(
      open({
        'ppt/presentation.xml': `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${REL}"><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
        'ppt/_rels/presentation.xml.rels': rels([['rId2', 'slides/slide1.xml', `${REL}/slide`], ['rId3', 'slides/slide2.xml', `${REL}/slide`]]),
        'ppt/slides/slide1.xml': slide(['Photosynthesis', 'Light reactions']),
        'ppt/slides/slide2.xml': slide(['Overview']),
        'ppt/slides/_rels/slide1.xml.rels': rels([['rId1', '../notesSlides/notesSlide1.xml', `${REL}/notesSlide`]]),
        'ppt/notesSlides/notesSlide1.xml': slide(['Mention the thylakoid.', '2']),
      }),
    );
    expect(text).toBe('## Slide 1\nOverview\n\n## Slide 2\nPhotosynthesis\nLight reactions\nNotes: Mention the thylakoid.');
  });
});

describe('OpenDocument', () => {
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';
  it('reads a text document, leaving footnotes out', async () => {
    const text = await openDocumentText(
      open({ 'content.xml': `<office:document-content ${NS}><office:body><office:text><text:h>Method</text:h><text:p>We<text:s/>sampled<text:note><text:note-body><text:p>See appendix.</text:p></text:note-body></text:note> 40 sites.</text:p></office:text></office:body></office:document-content>` }),
    );
    expect(text).toBe('Method\nWe sampled 40 sites.');
  });
  it('reads a spreadsheet, with formulas, without its endless empty cells', async () => {
    const text = await openDocumentText(
      open({
        'content.xml': `<office:document-content ${NS}><office:body><office:spreadsheet><table:table table:name="Data">
          <table:table-row><table:table-cell><text:p>x</text:p></table:table-cell><table:table-cell table:formula="of:=[.A2]*2"><text:p>4</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1022"/></table:table-row>
          <table:table-row table:number-rows-repeated="1048575"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
          </table:table></office:spreadsheet></office:body></office:document-content>`,
      }),
    );
    expect(text).toBe('## Sheet "Data"\n1\tx\t4 [=[.A2]*2]');
  });
});

describe('web pages, books, RTF and notebooks', () => {
  it('reads a page’s text, a line a block', () => {
    expect(htmlText('<html><head><style>p{}</style></head><body><h1>Title</h1><p>One <b>bold</b>\n word.</p><script>x()</script><table><tr><td>a</td><td>b</td></tr></table></body></html>')).toBe('Title\n\nOne bold word.\n\na\tb');
  });
  it('reads an EPUB in its spine’s order', async () => {
    const text = await epubText(
      open({
        'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
        'OEBPS/content.opf': '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Cells</dc:title></metadata><manifest><item id="a" href="ch%201.xhtml"/><item id="b" href="text/ch2.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>',
        'OEBPS/ch 1.xhtml': '<html><body><p>Chapter one.</p></body></html>',
        'OEBPS/text/ch2.xhtml': '<html><body><p>Chapter two.</p></body></html>',
      }),
    );
    expect(text).toBe('# Cells\n\nChapter two.\n\nChapter one.');
  });
  it('reads RTF without its settings', () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl\f0\fswiss Helvetica;}{\colortbl;\red255\green255\blue255;}{\*\expandedcolortbl;;}
\f0\fs24 \cf0 Caf\'e9 notes\par
Line \u8212? two\tab end\par
{\field{\*\fldinst HYPERLINK "https://x.org"}{\fldrslt link}}}`;
    expect(rtfText(rtf)).toBe('Café notes\nLine — two\tend\nlink');
  });
  it('reads a notebook’s cells and output', () => {
    const nb = JSON.stringify({
      metadata: { language_info: { name: 'python' } },
      cells: [
        { cell_type: 'markdown', source: ['# Lab 3\n', 'Fit a line.'] },
        { cell_type: 'code', source: 'print(2 + 2)', outputs: [{ text: ['4\n'] }] },
        { cell_type: 'code', source: '1/0', outputs: [{ ename: 'ZeroDivisionError', evalue: 'division by zero' }] },
      ],
    });
    expect(notebookText(nb)).toBe('# Lab 3\nFit a line.\n\nIn [2]:\n```python\nprint(2 + 2)\n```\nOut:\n4\n\nIn [3]:\n```python\n1/0\n```\nOut:\nZeroDivisionError: division by zero');
  });
  it('joins relationship paths', () => {
    expect(joinPath('ppt/slides', '../notesSlides/n1.xml')).toBe('ppt/notesSlides/n1.xml');
    expect(joinPath('xl', '/xl/worksheets/s.xml')).toBe('xl/worksheets/s.xml');
  });
});
