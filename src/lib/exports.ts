import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { statement, toMarkdown, type Declaration } from './declaration.ts';

/** Files to download: a document as Word or Markdown, and the AI-use declaration as Word, PDF or
 * Markdown. Loaded only when someone exports. */

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };

export function download(data: Blob | string, filename: string, type = 'text/markdown;charset=utf-8') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const fileName = (title: string, ext: string) => `${title.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Document'}.${ext}`;

// ── A document as Word ────────────────────────────────────────────────

function runs(nodes: Json[] | undefined): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (n.type === 'inlineMath') {
      out.push(new TextRun({ text: String(n.attrs?.latex ?? ''), font: 'Cambria Math', italics: true }));
      continue;
    }
    if (n.type === 'citation') {
      out.push(new TextRun({ text: String(n.attrs?.label ?? '') }));
      continue;
    }
    if (n.type !== 'text') continue;
    const has = (t: string) => n.marks?.some((m) => m.type === t) ?? false;
    const link = n.marks?.find((m) => m.type === 'link');
    const run = new TextRun({
      text: n.text ?? '',
      bold: has('bold'),
      italics: has('italic'),
      underline: has('underline') || link ? {} : undefined,
      strike: has('strike'),
      highlight: has('highlight') ? 'yellow' : undefined,
      font: has('code') ? 'Consolas' : undefined,
      color: link ? '4F43D6' : undefined,
    });
    out.push(link ? new ExternalHyperlink({ link: String(link.attrs?.href ?? ''), children: [run] }) : run);
  }
  return out;
}

const ALIGN = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as const;

function blocks(nodes: Json[] | undefined, ctx: { list?: 'bullet' | 'number'; level: number; quote?: boolean }): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const n of nodes ?? []) {
    const alignment = ALIGN[n.attrs?.textAlign as keyof typeof ALIGN];
    switch (n.type) {
      case 'paragraph':
        out.push(
          new Paragraph({
            children: runs(n.content),
            alignment,
            spacing: { after: 160, line: 300 },
            ...(ctx.list === 'bullet' ? { bullet: { level: ctx.level } } : ctx.list === 'number' ? { numbering: { reference: 'numbers', level: ctx.level } } : {}),
            ...(ctx.quote ? { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'C9C3FF', space: 12 } } } : {}),
          }),
        );
        break;
      case 'heading': {
        const level = Number(n.attrs?.level ?? 1);
        out.push(new Paragraph({ children: runs(n.content), heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, alignment, spacing: { before: 240, after: 120 } }));
        break;
      }
      case 'bulletList':
      case 'orderedList':
        for (const item of n.content ?? []) {
          let first = true;
          for (const child of item.content ?? []) {
            if (child.type === 'bulletList' || child.type === 'orderedList') out.push(...blocks([child], { ...ctx, level: ctx.level + 1 }));
            else if (first) {
              out.push(...blocks([child], { ...ctx, list: n.type === 'bulletList' ? 'bullet' : 'number' }));
              first = false;
            } else out.push(...blocks([child], { ...ctx, list: undefined }));
          }
        }
        break;
      case 'blockquote':
        out.push(...blocks(n.content, { ...ctx, quote: true }));
        break;
      case 'codeBlock':
        out.push(
          new Paragraph({
            children: (n.content ?? []).flatMap((t) => (t.text ?? '').split('\n')).map((line, i) => new TextRun({ text: line, font: 'Consolas', size: 20, break: i ? 1 : 0 })),
            shading: { fill: 'F4F4F8' },
            spacing: { after: 160 },
          }),
        );
        break;
      case 'blockMath':
        out.push(new Paragraph({ children: [new TextRun({ text: String(n.attrs?.latex ?? ''), font: 'Cambria Math', italics: true })], alignment: AlignmentType.CENTER, spacing: { after: 160 } }));
        break;
      case 'horizontalRule':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D9D9E6', space: 1 } }, spacing: { after: 160 } }));
        break;
      case 'table':
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: (n.content ?? []).map(
              (row) =>
                new TableRow({
                  children: (row.content ?? []).map(
                    (cell) =>
                      new TableCell({
                        children: blocks(cell.content, { level: 0 }).filter((b): b is Paragraph => b instanceof Paragraph),
                        shading: cell.type === 'tableHeader' ? { fill: 'F0F0F7' } : undefined,
                        margins: { top: 80, bottom: 80, left: 100, right: 100 },
                      }),
                  ),
                }),
            ),
          }),
        );
        out.push(new Paragraph({ children: [] }));
        break;
    }
  }
  return out;
}

function wordDocument(children: (Paragraph | Table)[], title: string) {
  return new Document({
    creator: 'Chip Study',
    title,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 24 } } },
    },
    numbering: {
      config: [
        {
          reference: 'numbers',
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: level % 2 ? LevelFormat.LOWER_LETTER : LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children }],
  });
}

export async function documentDocx(content: Record<string, unknown>, title: string): Promise<Blob> {
  return Packer.toBlob(wordDocument(blocks((content as Json).content, { level: 0 }), title));
}

// ── A document as Markdown ────────────────────────────────────────────

function inlineMd(nodes: Json[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'inlineMath') return `$${n.attrs?.latex}$`;
      if (n.type === 'citation') return String(n.attrs?.label ?? '');
      let t = n.text ?? '';
      const has = (m: string) => n.marks?.some((x) => x.type === m);
      if (has('code')) t = `\`${t}\``;
      if (has('bold')) t = `**${t}**`;
      if (has('italic')) t = `*${t}*`;
      if (has('strike')) t = `~~${t}~~`;
      const link = n.marks?.find((m) => m.type === 'link');
      if (link) t = `[${t}](${link.attrs?.href})`;
      return t;
    })
    .join('');
}

function md(nodes: Json[] | undefined, indent = ''): string[] {
  const out: string[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph':
        out.push(indent + inlineMd(n.content), '');
        break;
      case 'heading':
        out.push(`${'#'.repeat(Number(n.attrs?.level ?? 1))} ${inlineMd(n.content)}`, '');
        break;
      case 'bulletList':
      case 'orderedList':
        (n.content ?? []).forEach((item, i) => {
          const mark = n.type === 'bulletList' ? '- ' : `${i + 1}. `;
          const [first, ...rest] = item.content ?? [];
          out.push(`${indent}${mark}${first ? inlineMd(first.content) : ''}`);
          for (const r of rest) out.push(...md([r], `${indent}   `).filter(Boolean));
        });
        out.push('');
        break;
      case 'blockquote':
        out.push(...md(n.content).map((l) => (l ? `> ${l}` : '>')));
        break;
      case 'codeBlock':
        out.push(`\`\`\`${n.attrs?.language ?? ''}`, (n.content ?? []).map((t) => t.text).join(''), '```', '');
        break;
      case 'blockMath':
        out.push(`$$${n.attrs?.latex}$$`, '');
        break;
      case 'horizontalRule':
        out.push('---', '');
        break;
      case 'table': {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inlineMd(p.content)).join(' ').replace(/\|/g, '\\|')));
        if (rows.length) {
          out.push(`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`);
          for (const r of rows.slice(1)) out.push(`| ${r.join(' | ')} |`);
          out.push('');
        }
        break;
      }
    }
  }
  return out;
}

export function documentMarkdown(content: Record<string, unknown>): string {
  return md((content as Json).content).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ── The declaration ───────────────────────────────────────────────────

export async function declarationDocx(d: Declaration): Promise<Blob> {
  const p = (text: string, opts: { bold?: boolean; size?: number; color?: string; after?: number } = {}) =>
    new Paragraph({ children: [new TextRun({ text, bold: opts.bold, size: opts.size, color: opts.color })], spacing: { after: opts.after ?? 120 } });
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: 'Declaration of AI use', heading: HeadingLevel.TITLE, spacing: { after: 240 } }),
    p(`Student: ${d.student}`),
    p(`Assignment: ${d.assignment}`),
    ...(d.course ? [p(`Course: ${d.course}`)] : []),
    ...(d.due ? [p(`Due: ${d.due}`)] : []),
    p(`Generated: ${d.generated} by Chip Study (study.kaivon.app)`, { color: '6C6E8A', after: 240 }),
    new Paragraph({ text: 'Statement', heading: HeadingLevel.HEADING_2 }),
    p(statement(d), { after: 240 }),
  ];
  if (d.ownWords) children.push(new Paragraph({ text: 'In my own words', heading: HeadingLevel.HEADING_2 }), p(d.ownWords, { after: 240 }));
  if (d.counts.length) {
    children.push(new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_2 }));
    for (const c of d.counts) children.push(new Paragraph({ text: `${c.label}: ${c.count}`, bullet: { level: 0 } }));
  }
  if (d.entries.length) {
    children.push(new Paragraph({ text: 'Record', heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }));
    const cell = (text: string, header = false) =>
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: header, size: 18 })] })], shading: header ? { fill: 'F0F0F7' } : undefined, margins: { top: 60, bottom: 60, left: 80, right: 80 } });
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: ['When', 'What', 'Asked', 'Chip’s answer (start)', 'Words'].map((h) => cell(h, true)) }),
          ...d.entries.map((e) => new TableRow({ children: [cell(e.at), cell(e.what), cell(e.asked || '—'), cell(e.gave || '—'), cell(e.words ? String(e.words) : '')] })),
        ],
      }),
    );
  }
  children.push(p('', { after: 480 }), p('Signed: ______________________        Date: ______________'));
  return Packer.toBlob(wordDocument(children, 'Declaration of AI use'));
}

/** Text the PDF's built-in fonts can draw (they cover Western European letters). */
const latin = (t: string) =>
  t
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    // eslint-disable-next-line no-control-regex -- tabs and line breaks are kept on purpose
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');

export async function declarationPdf(d: Declaration): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 56;
  let y = M;
  const room = (h: number) => {
    if (y + h > H - M) {
      pdf.addPage();
      y = M;
    }
  };
  const write = (text: string, size = 11, opts: { bold?: boolean; color?: [number, number, number]; gap?: number; width?: number; x?: number } = {}) => {
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...(opts.color ?? [25, 26, 46]));
    const lines = pdf.splitTextToSize(latin(text), opts.width ?? W - 2 * M) as string[];
    for (const line of lines) {
      room(size * 1.4);
      pdf.text(line, opts.x ?? M, y);
      y += size * 1.4;
    }
    y += opts.gap ?? 4;
  };
  write('Declaration of AI use', 20, { bold: true, gap: 12 });
  write(`Student: ${d.student}`);
  write(`Assignment: ${d.assignment}`);
  if (d.course) write(`Course: ${d.course}`);
  if (d.due) write(`Due: ${d.due}`);
  write(`Generated: ${d.generated} by Chip Study (study.kaivon.app)`, 10, { color: [108, 110, 138], gap: 14 });
  write('Statement', 13, { bold: true });
  write(statement(d), 11, { gap: 12 });
  if (d.ownWords) {
    write('In my own words', 13, { bold: true });
    write(d.ownWords, 11, { gap: 12 });
  }
  if (d.counts.length) {
    write('Summary', 13, { bold: true });
    for (const c of d.counts) write(`- ${c.label}: ${c.count}`, 11, { gap: 0 });
    y += 12;
  }
  if (d.entries.length) {
    write('Record', 13, { bold: true, gap: 6 });
    for (const e of d.entries) {
      room(60);
      write(`${e.at}  ·  ${e.what}${e.words ? `  ·  ${e.words} words` : ''}`, 10, { bold: true, gap: 0 });
      if (e.asked) write(`Asked: ${e.asked}`, 10, { color: [71, 73, 100], gap: 0 });
      if (e.gave) write(`Chip: ${e.gave}`, 10, { color: [108, 110, 138], gap: 0 });
      y += 8;
    }
  }
  room(60);
  y += 28;
  write('Signed: ______________________        Date: ______________');
  return pdf.output('blob');
}

export const declarationMarkdown = toMarkdown;
