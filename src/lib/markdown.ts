import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked, type TokenizerAndRendererExtension } from 'marked';

/** Markdown with math, two ways: for reading (Chip's answers: KaTeX drawn, made safe) and for the
 * editor (math kept as the editor's math nodes, so it stays editable). */

const tex = (latex: string, display: boolean) =>
  katex.renderToString(latex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' });

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function mathExtensions(forEditor: boolean): TokenizerAndRendererExtension[] {
  return [
    {
      name: 'blockMath',
      level: 'block',
      start: (src) => src.match(/\$\$/)?.index,
      tokenizer(src) {
        const m = /^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n|$)/.exec(src);
        if (m) return { type: 'blockMath', raw: m[0], text: m[1].trim() };
        return undefined;
      },
      renderer: (token) =>
        forEditor
          ? `<div data-type="block-math" data-latex="${attr(token.text)}"></div>`
          : `<div class="math-block">${tex(token.text, true)}</div>`,
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: (src) => src.match(/\$/)?.index,
      tokenizer(src) {
        // $x^2$, not "$5 and $10": no space just inside, and not followed by a digit.
        const m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src) ?? /^\$\$((?:\\.|[^\\$])+?)\$\$/.exec(src);
        if (m) return { type: 'inlineMath', raw: m[0], text: m[1] };
        return undefined;
      },
      renderer: (token) =>
        forEditor ? `<span data-type="inline-math" data-latex="${attr(token.text)}"></span>` : tex(token.text, false),
    },
  ];
}

/** Images never load from Markdown: one could send what's on screen to someone else's server
 * (`![](https://…/?q=<your essay>)`). An image reads as its description instead. */
const noImages = {
  renderer: {
    image({ text }: { text: string }) {
      return text ? `<span class="md-image">[${attr(text)}]</span>` : '';
    },
  },
};

const reading = new Marked({ gfm: true, breaks: false });
reading.use({ extensions: mathExtensions(false) }, noImages);
const editing = new Marked({ gfm: true, breaks: false });
editing.use({ extensions: mathExtensions(true) }, noImages);

/** Never in Chip's answers, a reading or anything put into a document: nothing that can ask for a
 * password, restyle the page, load something from elsewhere or run anything. */
const FORBID_TAGS = [
  'style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'fieldset', 'label', 'output',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'script', 'noscript', 'template',
  'img', 'picture', 'source', 'video', 'audio', 'track', 'canvas', 'dialog', 'marquee',
  'image', 'use', 'feimage', 'foreignobject', 'mglyph',
];
const FORBID_ATTR = ['src', 'srcset', 'action', 'formaction', 'background', 'poster', 'ping', 'xlink:href', 'popover', 'srcdoc', 'data', 'usemap'];

/** KaTeX draws math with a few inline styles (heights, offsets, colours): kept, but only those
 * properties, with plain values (no url(), no fixed positions, nothing huge), and only inside math. */
const LENGTH = /^-?(?:\d+(?:\.\d+)?|\.\d+)(em|ex|px|pt)?$/;
const COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+\s*)?\))$/i;
const BORDER_STYLE = /^(?:solid|dashed|dotted|double|none)$/;
const MATH_LENGTHS = new Set(['height', 'width', 'min-width', 'top', 'bottom', 'left', 'margin-left', 'margin-right', 'margin-top', 'padding-left', 'vertical-align', 'border-width', 'border-top-width', 'border-bottom-width', 'border-right-width']);

const length = (v: string): boolean => {
  const m = LENGTH.exec(v);
  if (!m) return false;
  const n = Math.abs(parseFloat(v));
  return m[1] === 'px' || m[1] === 'pt' ? n <= 600 : n <= 40;
};

function mathStyle(css: string): string {
  const kept: string[] = [];
  for (const decl of css.split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl.slice(at + 1).trim();
    if (!value || /[\\()]/.test(value.replace(/^rgba?\([^)]*\)$/i, ''))) continue;
    const ok = MATH_LENGTHS.has(prop)
      ? length(value)
      : prop === 'color' || prop === 'background-color' || prop === 'border-color'
        ? COLOR.test(value)
        : prop === 'border-style' || prop === 'border-right-style'
          ? BORDER_STYLE.test(value)
          : prop === 'position'
            ? value === 'relative'
            : prop === 'border'
              ? value.split(/\s+/).every((t) => length(t) || BORDER_STYLE.test(t) || COLOR.test(t))
              : false;
    if (ok) kept.push(`${prop}:${value}`);
  }
  return kept.join(';');
}

let hooked = false;
function purifier() {
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
      if (data.attrName === 'style') {
        // Only math keeps a style, and only what math needs.
        const inMath = typeof (node as Element).closest === 'function' && !!(node as Element).closest('.katex');
        const css = inMath ? mathStyle(data.attrValue) : '';
        if (css) data.attrValue = css;
        else data.keepAttr = false;
      } else if (data.attrName === 'href' && node.nodeName !== 'A' && node.nodeName !== 'a') {
        // Links are links; nothing else fetches anything.
        data.keepAttr = false;
      }
    });
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  return DOMPurify;
}

/** Chip's Markdown as safe HTML to show. */
export function renderMarkdown(text: string): string {
  const html = reading.parse(text, { async: false }) as string;
  return purifier().sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true }, ADD_ATTR: ['target'], FORBID_TAGS, FORBID_ATTR });
}

/** Markdown as HTML for the editor to take in (math as math nodes). Nothing styled, no forms and
 * no images can go into a document this way. */
export function markdownToEditorHtml(text: string): string {
  const html = editing.parse(text, { async: false }) as string;
  return purifier().sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['data-type', 'data-latex'], FORBID_TAGS, FORBID_ATTR: [...FORBID_ATTR, 'style'] });
}
