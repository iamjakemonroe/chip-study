import { describe, expect, it } from 'vitest';
import { buildDeclaration, modelName, statement, toMarkdown } from '../../src/lib/declaration.ts';
import type { LogEntry } from '../../src/lib/types.ts';

const entry = (over: Partial<LogEntry>): LogEntry => ({
  id: Math.random().toString(36),
  assignment_id: 'a',
  message_id: null,
  at: '2026-10-20T10:00:00Z',
  action: 'explain',
  summary: '',
  prompt: '',
  output: '',
  words: 0,
  model: 'claude-haiku-5-5',
  ...over,
});

const assignment = { title: 'Climate essay', course: 'GEO 101', due_at: '2026-11-15T12:00:00Z' };

describe('AI-use declaration', () => {
  it('names models plainly', () => {
    expect(modelName('claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(modelName('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(modelName('claude-opus-5')).toBe('Claude Opus 5');
    expect(modelName('something-else')).toBe('something-else');
  });

  it('tallies the record in order, with the share of Chip’s words', () => {
    const d = buildDeclaration({
      student: 'Ada Lovelace',
      assignment,
      words: 1500,
      chipWords: 120,
      log: [
        entry({ at: '2026-10-21T09:00:00Z', action: 'write', summary: 'Asked Chip to write or improve text', prompt: 'Tighten my intro', output: 'Here is a tighter intro', model: 'claude-opus-5-5' }),
        entry({ at: '2026-10-20T09:00:00Z', action: 'explain', prompt: 'What is albedo?' }),
        entry({ at: '2026-10-21T09:05:00Z', action: 'inserted', words: 120, summary: 'Put Chip’s words into the document', model: 'claude-opus-5-5' }),
      ],
      now: new Date('2026-10-28T12:00:00Z'),
    });
    expect(d.share).toBe(8);
    expect(d.models).toEqual(['Claude Haiku 5.5', 'Claude Opus 5.5']);
    expect(d.entries.map((e) => e.asked)).toEqual(['What is albedo?', 'Tighten my intro', '']);
    expect(d.counts).toEqual([
      { label: 'Explanations', count: 1 },
      { label: 'Drafting or improving text', count: 1 },
      { label: 'Chip’s text put into the document', count: 1 },
    ]);
    expect(statement(d)).toContain('120 of the 1,500 words in my final document (8%) are still in Chip’s wording');
    expect(d.generated).toBe('28 October 2026');
    expect(d.due).toBe('15 November 2026');
  });

  it('never says more of Chip’s words than the document has', () => {
    const d = buildDeclaration({ student: 'A', assignment, words: 50, chipWords: 80, log: [entry({})] });
    expect(d.chipWords).toBe(50);
    expect(d.share).toBe(100);
  });

  it('says so plainly when Chip wasn’t used', () => {
    const d = buildDeclaration({ student: '', assignment, words: 900, chipWords: 0, log: [] });
    expect(statement(d)).toBe('I did not use Chip, Chip Study’s AI study partner, for this assignment.');
    expect(d.student).toBe('Student');
    expect(toMarkdown(d)).not.toContain('## Record');
  });

  it('writes Markdown that can’t be broken by what was asked', () => {
    const d = buildDeclaration({
      student: 'Ada',
      assignment,
      words: 10,
      chipWords: 0,
      ownWords: 'I used it to *plan*.',
      log: [entry({ prompt: 'a | b\nwith a\nnew line and `code`' })],
    });
    const out = toMarkdown(d);
    expect(out).toContain('# Declaration of AI use');
    expect(out).toContain('**Course:** GEO 101');
    expect(out).toContain('I used it to \\*plan\\*.');
    expect(out).toContain('a \\| b with a new line and \\`code\\`');
    expect(out.split('\n').filter((l) => l.startsWith('| ')).length).toBe(3);
  });

  it('keeps long prompts short', () => {
    const d = buildDeclaration({ student: 'A', assignment, words: 1, chipWords: 0, log: [entry({ prompt: 'x '.repeat(400) })] });
    expect(d.entries[0].asked.length).toBeLessThanOrEqual(280);
    expect(d.entries[0].asked.endsWith('…')).toBe(true);
  });
});
