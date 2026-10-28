import { describe, expect, it } from 'vitest';
import { plainAnswer, segments } from '../../src/lib/blocks.ts';

const fence = (name: string, body: string) => ['```' + name, body, '```'].join('\n');

describe("Chip's cards", () => {
  it('splits Markdown and a tasks block', () => {
    const s = segments(`Here's a plan.\n\n${fence('tasks', '[{"title":"Read","due":"2026-11-01"},{"title":"Draft","due":"soon"}]')}\nGood luck!`);
    expect(s).toEqual([
      { kind: 'md', text: "Here's a plan.\n" },
      { kind: 'tasks', tasks: [{ title: 'Read', due: '2026-11-01' }, { title: 'Draft', due: null }] },
      { kind: 'md', text: 'Good luck!' },
    ]);
  });

  it('reads a quiz, dropping questions whose answer is out of range', () => {
    const s = segments(fence('quiz', JSON.stringify({ questions: [
      { q: 'Q1?', options: ['a', 'b', 'c', 'd'], answer: 2, why: 'c' },
      { q: 'Q2?', options: ['a', 'b'], answer: 5, why: '' },
    ] })));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'quiz', questions: [{ q: 'Q1?', answer: 2 }] });
  });

  it('forgives a trailing comma', () => {
    expect(segments(fence('cards', '[{"front":"A","back":"B"},]'))[0]).toEqual({ kind: 'cards', cards: [{ front: 'A', back: 'B' }] });
  });

  it('reads rubric feedback with or without numbers', () => {
    const s = segments(fence('rubric', '{"criteria":[{"name":"Argument","band":"Good","score":7,"out_of":10,"feedback":"f","next":"n"},{"name":"Style","band":"Fair","score":null,"out_of":null,"feedback":"","next":""}],"overall":"Solid."}'));
    expect(s[0]).toMatchObject({ kind: 'rubric', overall: 'Solid.', criteria: [{ score: 7, out_of: 10 }, { score: null }] });
  });

  it("marks a source verified only when it has a link", () => {
    const s = segments(fence('sources', '[{"kind":"article","authors":["Smith, J."],"year":"2020","title":"T","url":"https://x.org","verified":true},{"kind":"zine","title":"U","verified":true},{"title":"V","url":"javascript:alert(1)","verified":true}]'));
    expect(s[0]).toMatchObject({ kind: 'sources' });
    const list = (s[0] as Extract<(typeof s)[0], { kind: 'sources' }>).sources;
    expect(list.map((x) => [x.kind, x.verified, x.data.url])).toEqual([
      ['article', true, 'https://x.org'],
      ['other', false, ''],
      ['other', false, ''],
    ]);
  });

  it('keeps a draft as Markdown, code inside it and all', () => {
    const body = 'An intro.\n\n```python\nprint(1)\n```\n\nThe end.';
    const s = segments(`Try this:\n${fence('draft', body)}\nWant it shorter?`);
    expect(s.map((x) => x.kind)).toEqual(['md', 'draft', 'md']);
    expect(s[1]).toEqual({ kind: 'draft', text: body, done: true });
  });

  it('while streaming: an unfinished block is pending, an unfinished draft shows so far', () => {
    expect(segments('Plan:\n```tasks\n[{"title":"Re', true)).toEqual([{ kind: 'md', text: 'Plan:' }, { kind: 'pending', block: 'tasks' }]);
    expect(segments('```draft\nThe first line', true)).toEqual([{ kind: 'draft', text: 'The first line', done: false }]);
  });

  it('broken JSON is shown as code, not lost', () => {
    const s = segments(fence('tasks', '[{"title": nope}]'));
    expect(s).toEqual([{ kind: 'md', text: '```\n[{"title": nope}]\n```' }]);
  });

  it('ordinary code fences are left alone', () => {
    expect(segments('```js\nlet a = 1\n```')).toEqual([{ kind: 'md', text: '```js\nlet a = 1\n```' }]);
  });

  it('copies as text without the cards', () => {
    expect(plainAnswer(`Hi\n${fence('tasks', '[{"title":"A","due":null}]')}\n${fence('draft', 'Body')}`)).toBe('Hi\n\nBody');
  });
});
