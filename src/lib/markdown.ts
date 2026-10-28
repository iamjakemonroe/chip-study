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

const reading = new Marked({ gfm: true, breaks: false });
reading.use({ extensions: mathExtensions(false) });
const editing = new Marked({ gfm: true, breaks: false });
editing.use({ extensions: mathExtensions(true) });

let hooked = false;
function purifier() {
  if (!hooked) {
    hooked = true;
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
  return purifier().sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true }, ADD_ATTR: ['target'] });
}

/** Markdown as HTML for the editor to take in (math as math nodes). */
export function markdownToEditorHtml(text: string): string {
  const html = editing.parse(text, { async: false }) as string;
  return purifier().sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['data-type', 'data-latex'] });
}
