import { describe, expect, it } from 'vitest';
import { html, inText, initialsOf, markdown, parsePerson, plain, reference, referenceList } from '../../src/lib/citations.ts';

const article = {
  authors: ['Smith, Jane', 'Lee, Kim Ah'],
  year: '2020',
  title: 'Climate change and coastal towns',
  container: 'Journal of Coastal Research',
  volume: '36',
  issue: '4',
  pages: '100-115',
  doi: 'https://doi.org/10.2112/JCR-D-19-00123.1',
};

describe('names', () => {
  it('reads "Surname, Given" and "Given Surname"', () => {
    expect(parsePerson('Smith, Jane Mary')).toEqual({ family: 'Smith', initials: 'J. M.', group: false });
    expect(parsePerson('Jane Mary Smith')).toEqual({ family: 'Smith', initials: 'J. M.', group: false });
    expect(parsePerson('Ludwig van Beethoven')).toMatchObject({ family: 'van Beethoven', initials: 'L.' });
  });
  it('makes initials from hyphenated and dotted names', () => {
    expect(initialsOf('Jean-Paul')).toBe('J.-P.');
    expect(initialsOf('J.M.')).toBe('J. M.');
  });
  it('keeps organisations whole', () => {
    expect(parsePerson('World Health Organization')).toMatchObject({ family: 'World Health Organization', group: true });
    expect(parsePerson('{World Bank}')).toMatchObject({ family: 'World Bank', group: true });
    expect(parsePerson('UNESCO')).toMatchObject({ family: 'UNESCO', group: true });
    expect(parsePerson('   ')).toBeNull();
  });
});

describe('APA 7th', () => {
  it('a journal article, with its DOI as a link', () => {
    expect(markdown(reference('article', article, 'apa'))).toBe(
      'Smith, J., & Lee, K. A. (2020). Climate change and coastal towns. *Journal of Coastal Research*, *36*(4), 100–115. https://doi.org/10.2112/JCR-D-19-00123.1',
    );
  });
  it('three to twenty authors, with a comma before the ampersand', () => {
    const r = plain(reference('article', { ...article, authors: ['A, B', 'C, D', 'E, F'] }, 'apa'));
    expect(r.startsWith('A, B., C, D., & E, F. (2020).')).toBe(true);
  });
  it('more than twenty: the first nineteen, an ellipsis, the last', () => {
    const many = Array.from({ length: 22 }, (_, i) => `Author${i + 1}, X`);
    const r = plain(reference('book', { authors: many, year: '2001', title: 'Big' }, 'apa'));
    expect(r).toContain('Author19, X., . . . Author22, X. (2001).');
    expect(r).not.toContain('Author20');
  });
  it('a book with an edition and a publisher', () => {
    expect(markdown(reference('book', { authors: ['Kahneman, Daniel'], year: '2011', title: 'Thinking, fast and slow', edition: '2', publisher: 'Farrar, Straus and Giroux' }, 'apa'))).toBe(
      'Kahneman, D. (2011). *Thinking, fast and slow* (2nd ed.). Farrar, Straus and Giroux.',
    );
  });
  it('a chapter in an edited book', () => {
    expect(markdown(reference('chapter', { authors: ['Brown, Alice'], year: '2019', title: 'Learning to read', editors: ['Jane Smith', 'Kim Lee'], container: 'Handbook of reading', pages: '10-25', publisher: 'Routledge' }, 'apa'))).toBe(
      'Brown, A. (2019). Learning to read. In J. Smith & K. Lee (Eds.), *Handbook of reading* (pp. 10–25). Routledge.',
    );
  });
  it('a web page by an organisation, leaving out the site when it is the author', () => {
    expect(markdown(reference('web', { authors: ['World Health Organization'], year: '2023', title: 'Climate change', container: 'World Health Organization', url: 'https://www.who.int/climate' }, 'apa'))).toBe(
      'World Health Organization. (2023). *Climate change*. https://www.who.int/climate',
    );
  });
  it('no author: the title moves to the front; no date is n.d.', () => {
    expect(markdown(reference('web', { title: 'How tides work', container: 'Ocean Facts', url: 'https://ocean.example/tides' }, 'apa'))).toBe(
      '*How tides work*. (n.d.). Ocean Facts. https://ocean.example/tides',
    );
  });
  it('a video is labelled', () => {
    expect(plain(reference('video', { authors: ['{CrashCourse}'], year: '2012', title: 'The water cycle', container: 'YouTube', url: 'https://youtu.be/x' }, 'apa'))).toBe(
      'CrashCourse. (2012). The water cycle [Video]. YouTube. https://youtu.be/x',
    );
  });
});

describe('Harvard (Cite Them Right)', () => {
  it('a journal article', () => {
    expect(markdown(reference('article', { ...article, accessed: '2024-03-03' }, 'harvard'))).toBe(
      "Smith, J. and Lee, K.A. (2020) ‘Climate change and coastal towns’, *Journal of Coastal Research*, 36(4), pp. 100–115. Available at: https://doi.org/10.2112/JCR-D-19-00123.1 (Accessed: 3 March 2024).",
    );
  });
  it('four or more authors are the first et al.', () => {
    const r = plain(reference('book', { authors: ['A, B', 'C, D', 'E, F', 'G, H'], year: '2000', title: 'T' }, 'harvard'));
    expect(r.startsWith('A, B. et al. (2000) T.')).toBe(true);
  });
  it('a book with an edition, place and publisher', () => {
    expect(markdown(reference('book', { authors: ['Kahneman, Daniel'], year: '2011', title: 'Thinking, fast and slow', edition: '2nd', place: 'New York', publisher: 'Farrar, Straus and Giroux' }, 'harvard'))).toBe(
      'Kahneman, D. (2011) *Thinking, fast and slow*. 2nd edn. New York: Farrar, Straus and Giroux.',
    );
  });
  it('a web page with no date', () => {
    expect(markdown(reference('web', { authors: ['{NASA}'], title: 'Sea level', url: 'https://nasa.gov/sea', accessed: '2026-10-01' }, 'harvard'))).toBe(
      'NASA (no date) *Sea level*. Available at: https://nasa.gov/sea (Accessed: 1 October 2026).',
    );
  });
});

describe('in-text citations', () => {
  it('APA', () => {
    expect(inText({ authors: ['Smith, J'], year: '2020' }, 'apa')).toBe('(Smith, 2020)');
    expect(inText({ authors: ['Smith, J', 'Lee, K'], year: '2020' }, 'apa')).toBe('(Smith & Lee, 2020)');
    expect(inText({ authors: ['Smith, J', 'Lee, K', 'Brown, P'], year: '2020' }, 'apa', '12')).toBe('(Smith et al., 2020, p. 12)');
    expect(inText({ title: 'How tides work in practice today' }, 'apa')).toBe('(“How tides work in”, n.d.)');
  });
  it('Harvard', () => {
    expect(inText({ authors: ['Smith, J', 'Lee, K'], year: '2020' }, 'harvard', '4-6')).toBe('(Smith and Lee, 2020, pp. 4–6)');
    expect(inText({ authors: ['Smith, J', 'Lee, K', 'Brown, P'], year: '2020' }, 'harvard')).toBe('(Smith, Lee and Brown, 2020)');
    expect(inText({ authors: ['A, B', 'C, D', 'E, F', 'G, H'] }, 'harvard')).toBe('(A et al., no date)');
  });
});

describe('the reference list', () => {
  it('is in alphabetical order by first author, or title', () => {
    const list = referenceList(
      [
        { kind: 'book', data: { authors: ['Zed, A'], year: '2001', title: 'Last' } },
        { kind: 'web', data: { title: 'Middle page' } },
        { kind: 'book', data: { authors: ['Adams, B'], year: '1999', title: 'First' } },
      ],
      'apa',
    ).map(plain);
    expect(list[0].startsWith('Adams')).toBe(true);
    expect(list[1].startsWith('Middle page')).toBe(true);
    expect(list[2].startsWith('Zed')).toBe(true);
  });
  it('escapes HTML', () => {
    expect(html([{ text: 'A <b> & C' }, { text: 'T', italic: true }])).toBe('A &lt;b&gt; &amp; C<em>T</em>');
  });
});
