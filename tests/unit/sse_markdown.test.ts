import { describe, expect, it } from 'vitest';
import { markdownToEditorHtml, renderMarkdown } from '../../src/lib/markdown.ts';
import { SseReader } from '../../src/lib/sse.ts';

describe('server-sent events', () => {
  it('reads events cut anywhere, in order', () => {
    const got: unknown[] = [];
    const r = new SseReader((e) => got.push(e));
    const wire = 'data: {"t":"start"}\n\ndata: {"t":"text","text":"Hel"}\n\n: keep-alive\n\ndata: {"t":"text","text":"lo\\n"}\r\n\r\ndata: {"t":"done"}';
    for (let i = 0; i < wire.length; i += 7) r.push(wire.slice(i, i + 7));
    r.end();
    expect(got).toEqual([{ t: 'start' }, { t: 'text', text: 'Hel' }, { t: 'text', text: 'lo\n' }, { t: 'done' }]);
  });
});

describe('markdown', () => {
  it('draws math, and leaves money alone', () => {
    const html = renderMarkdown('Area is $\\pi r^2$, costs $5 and $10.\n\n$$\\int_0^1 x\\,dx$$');
    expect(html).toContain('katex');
    expect(html).toContain('math-block');
    expect(html).toContain('costs $5 and $10');
  });
  it('is safe: scripts and handlers go, links open in a new tab', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"><script>alert(2)</script>[site](https://example.com)');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('gives the editor math nodes it can edit', () => {
    const html = markdownToEditorHtml('# Title\n\nSo $E=mc^2$.\n\n$$a^2+b^2=c^2$$');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<span data-type="inline-math" data-latex="E=mc^2"></span>');
    expect(html).toContain('<div data-type="block-math" data-latex="a^2+b^2=c^2"></div>');
  });
  it('tables come through', () => {
    expect(renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')).toContain('<table>');
  });
});
