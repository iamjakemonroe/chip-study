import { Mark, mergeAttributes, Node, type Editor } from '@tiptap/core';
import { Highlight } from '@tiptap/extension-highlight';
import { Mathematics } from '@tiptap/extension-mathematics';
import { TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { Typography } from '@tiptap/extension-typography';
import { Placeholder } from '@tiptap/extensions';
import { DOMParser as PMDOMParser, Fragment, Slice, type MarkType, type Node as PMNode, type NodeType } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import { countWords } from '../lib/autosave.ts';
import { inText } from '../lib/citations.ts';
import type { Source, Style } from '../lib/types.ts';

/** Words Chip wrote that are in the document: marked until the student rewrites them (typing next
 * to them isn't Chip's, so the mark doesn't spread). */
export const ChipWords = Mark.create({
  name: 'chip',
  inclusive: false,
  addAttributes() {
    return { message: { default: null, parseHTML: (el) => el.getAttribute('data-message'), renderHTML: (a) => (a.message ? { 'data-message': a.message } : {}) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-chip]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-chip': '', class: 'chip-words', title: 'Written with Chip' }), 0];
  },
});

/** A citation in the text, tied to one of the assignment's sources: "(Smith, 2020)". Its label
 * follows the source and the referencing style. */
export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      source: { default: null, parseHTML: (el) => el.getAttribute('data-source') },
      page: { default: '', parseHTML: (el) => el.getAttribute('data-page') ?? '' },
      label: { default: '', parseHTML: (el) => el.textContent ?? '' },
    };
  },
  parseHTML() {
    return [{ tag: 'cite[data-source]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['cite', mergeAttributes(HTMLAttributes, { 'data-source': node.attrs.source, 'data-page': node.attrs.page || null, class: 'citation' }), node.attrs.label || '(citation)'];
  },
  renderText({ node }) {
    return node.attrs.label;
  },
});

export function extensions(opts: { onMath: (kind: 'inline' | 'block', latex: string, pos: number) => void }) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Start writing, or ask Chip to help you plan…'),
    }),
    Typography,
    Highlight,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TableKit.configure({ table: { resizable: false } }),
    Mathematics.configure({
      katexOptions: { throwOnError: false },
      inlineOptions: { onClick: (node, pos) => opts.onMath('inline', node.attrs.latex, pos) },
      blockOptions: { onClick: (node, pos) => opts.onMath('block', node.attrs.latex, pos) },
    }),
    ChipWords,
    Citation,
  ];
}

/** The document as plain text, math as LaTeX and citations as they read. */
export function plainText(editor: Editor): string {
  return editor.getText({
    blockSeparator: '\n\n',
    textSerializers: {
      inlineMath: ({ node }) => `$${node.attrs.latex}$`,
      blockMath: ({ node }) => `$$${node.attrs.latex}$$`,
      citation: ({ node }) => node.attrs.label,
    },
  });
}

/** Words in the document still in Chip's wording. */
export function chipWordCount(doc: PMNode): number {
  let text = '';
  doc.descendants((node) => {
    if (node.isText) {
      text += node.marks.some((m) => m.type.name === 'chip') ? node.text : ' ';
      return false;
    }
    if (node.isBlock) text += ' ';
    return true;
  });
  return countWords(text);
}

function markAll(fragment: Fragment, parent: NodeType, mark: MarkType, message: string | null): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      out.push(parent.allowsMarkType(mark) ? node.mark(mark.create({ message }).addToSet(node.marks)) : node);
    } else if (node.content.size > 0) {
      out.push(node.copy(markAll(node.content, node.type, mark, message)));
    } else out.push(node);
  });
  return Fragment.fromArray(out);
}

/** Puts Chip's [html] into the document at the cursor (or over the selection), marked as Chip's.
 * Returns the words put in. */
export function insertFromChip(editor: Editor, html: string, message: string | null): number {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const slice = PMDOMParser.fromSchema(editor.schema).parseSlice(holder);
  let content = markAll(slice.content, editor.schema.topNodeType, editor.schema.marks.chip, message);
  // One paragraph goes in as words in the line, not a new paragraph.
  let open = [slice.openStart, slice.openEnd];
  if (content.childCount === 1 && content.firstChild?.type.name === 'paragraph') {
    content = Fragment.from(content.firstChild);
    open = [1, 1];
  }
  const words = countWords(holder.textContent ?? '');
  editor.view.dispatch(editor.state.tr.replaceSelection(new Slice(content, open[0], open[1])).scrollIntoView());
  editor.commands.focus();
  return words;
}

/** Brings every citation's label up to date with its source and the style. */
export function refreshCitations(editor: Editor, sources: Source[], style: Style) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const tr = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'citation') return true;
    const source = byId.get(node.attrs.source);
    const label = source ? inText(source.data, style, node.attrs.page) : '(source removed)';
    if (label !== node.attrs.label) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, label });
      changed = true;
    }
    return false;
  });
  if (changed) {
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  }
}

/** The sources cited in the document, in the order they first appear. */
export function citedSources(editor: Editor): string[] {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'citation' && node.attrs.source && !ids.includes(node.attrs.source)) ids.push(node.attrs.source);
    return true;
  });
  return ids;
}
