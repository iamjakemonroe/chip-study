import type { Source, SourceData, SourceKind, Style } from './types.ts';

/** A reference as runs of text, some in italics, so it can be drawn on screen, written to
 * Markdown or put in a Word file the same way. */
export type Run = { text: string; italic?: boolean };

export interface Person {
  /** Surname, or the whole name of a group author (an organisation). */
  family: string;
  /** Initials, e.g. "J. M.", empty for a group. */
  initials: string;
  group: boolean;
}

// Words that only an organisation's name has (anything else can be put in {braces}).
const GROUP_WORDS =
  /\b(organi[sz]ation|association|institute|institution|university|college|department|agency|council|society|committee|ministry|bureau|foundation|cent(re|er)|inc|ltd|llc|plc|corporation|company|government|commission|nations)\b/i;

/** Reads an author as written: "Surname, Given Names", "Given Names Surname", or an
 * organisation ("World Health Organization", or anything in {braces} to be sure). */
export function parsePerson(raw: string): Person | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const braced = /^\{(.+)\}$/.exec(name);
  if (braced) return { family: braced[1].trim(), initials: '', group: true };
  let family: string;
  let given: string;
  if (name.includes(',')) {
    const [f, ...rest] = name.split(',');
    family = f.trim();
    given = rest.join(' ').trim();
  } else {
    if (GROUP_WORDS.test(name) || !name.includes(' ')) {
      // One word ("Plato", "UNESCO") or an organisation.
      return { family: name, initials: '', group: !name.includes(' ') ? /^[A-Z0-9&]{2,}$/.test(name) : true };
    }
    const parts = name.split(' ');
    // Particles stay with the surname: "Ludwig van Beethoven", "Gabriel García Márquez" is
    // ambiguous, so only the usual lowercase particles join it.
    let i = parts.length - 1;
    while (i > 1 && /^(van|von|de|der|den|del|della|di|da|du|la|le|bin|al|ibn)$/i.test(parts[i - 1])) i--;
    family = parts.slice(i).join(' ');
    given = parts.slice(0, i).join(' ');
  }
  return { family, initials: initialsOf(given), group: false };
}

/** "Jane Mary" → "J. M.", "Jean-Paul" → "J.-P.", "J.M." stays "J. M.". */
export function initialsOf(given: string): string {
  return given
    .replace(/\./g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split('-')
        .filter(Boolean)
        .map((part) => `${part[0].toUpperCase()}.`)
        .join('-'),
    )
    .join(' ');
}

function people(data: SourceData): Person[] {
  return (data.authors ?? []).map(parsePerson).filter((p): p is Person => p !== null);
}

const fullName = (p: Person) => (p.group || !p.initials ? p.family : `${p.family}, ${p.initials}`);
/** Harvard writes initials without spaces: "Lee, K.A.". */
const harvardName = (p: Person) => (p.group || !p.initials ? p.family : `${p.family}, ${p.initials.replace(/\. /g, '.')}`);

/** "A", "A, & B", "A, B, & C" (APA 7: up to 20, then the first 19, …, and the last). */
function apaAuthors(list: Person[]): string {
  const names = list.map(fullName);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length > 20) return `${names.slice(0, 19).join(', ')}, . . . ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
}

/** "A", "A and B", "A, B and C", then "A et al." from four (Harvard, Cite Them Right). */
function harvardAuthors(list: Person[]): string {
  const names = list.map(harvardName);
  if (names.length === 0) return '';
  if (names.length >= 4) return `${names[0]} et al.`;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const dash = (pages: string) => pages.trim().replace(/\s*-+\s*/g, '–');
const end = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);

function link(data: SourceData): string {
  const doi = (data.doi ?? '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  if (doi) return `https://doi.org/${doi}`;
  return (data.url ?? '').trim();
}

/** "2nd" from "2", "2nd" or "2nd edition". */
function edition(raw: string | undefined): string {
  const n = (raw ?? '').trim().match(/^(\d+)/)?.[1];
  if (!n) return (raw ?? '').trim();
  const v = Number(n);
  const suffix = v % 100 >= 11 && v % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] ?? 'th';
  return `${v}${suffix}`;
}

function longDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Joins runs, dropping empty ones. */
function runs(...parts: (Run | string | false | null | undefined)[]): Run[] {
  const out: Run[] = [];
  for (const part of parts) {
    if (!part) continue;
    const run = typeof part === 'string' ? { text: part } : part;
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && !!last.italic === !!run.italic) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

/** One entry for the reference list. */
export function reference(kind: SourceKind, data: SourceData, style: Style): Run[] {
  return style === 'harvard' ? harvard(kind, data) : apa(kind, data);
}

function apa(kind: SourceKind, d: SourceData): Run[] {
  const authors = apaAuthors(people(d));
  const year = d.year?.trim() || 'n.d.';
  const title = (d.title ?? '').trim() || 'Untitled';
  const url = link(d);
  // No author: the title moves to the front.
  const lead = authors ? `${end(authors)} (${year}). ` : '';
  const titleFirst = !authors;
  const ed = edition(d.edition);
  switch (kind) {
    case 'article': {
      const vol = (d.volume ?? '').trim();
      const issue = (d.issue ?? '').trim();
      const pages = d.pages ? dash(d.pages) : '';
      return runs(
        lead,
        titleFirst ? `${end(title)} (${year}). ` : `${end(title)} `,
        d.container ? { text: d.container.trim(), italic: true } : '',
        vol ? ', ' : '',
        vol ? { text: vol, italic: true } : '',
        issue ? `(${issue})` : '',
        pages ? `, ${pages}` : '',
        d.container || vol || pages ? '.' : '',
        url ? ` ${url}` : '',
      );
    }
    case 'chapter': {
      const editors = (d.editors ?? []).map(parsePerson).filter((p): p is Person => !!p);
      const eds = editors.map((p) => (p.group || !p.initials ? p.family : `${p.initials} ${p.family}`));
      const edText = eds.length ? `${eds.length > 1 ? `${eds.slice(0, -1).join(', ')}${eds.length > 2 ? ',' : ''} & ${eds[eds.length - 1]}` : eds[0]} (${eds.length > 1 ? 'Eds.' : 'Ed.'}), ` : '';
      const pages = d.pages ? dash(d.pages) : '';
      const extra = [ed ? `${ed} ed.` : '', pages ? `pp. ${pages}` : ''].filter(Boolean).join(', ');
      return runs(
        lead,
        titleFirst ? `${end(title)} (${year}). ` : `${end(title)} `,
        'In ',
        edText,
        { text: (d.container ?? '').trim() || 'Untitled book', italic: true },
        extra ? ` (${extra})` : '',
        '. ',
        d.publisher ? `${end(d.publisher.trim())}` : '',
        url ? ` ${url}` : '',
      );
    }
    case 'book':
    case 'report':
    case 'video':
    case 'web':
    case 'other': {
      const label = kind === 'video' ? ' [Video]' : '';
      const edText = kind === 'book' && ed ? ` (${ed} ed.)` : '';
      const report = kind === 'report' && d.issue ? ` (${d.issue.trim()})` : '';
      // A website's name is left out when it's the author's own.
      const site = (d.container ?? '').trim();
      const showSite = site && site !== authors && kind !== 'book';
      const publisher = (d.publisher ?? '').trim();
      const showPublisher = publisher && publisher !== authors && publisher !== site;
      return runs(
        lead,
        { text: title, italic: true },
        edText,
        report,
        label,
        titleFirst ? `. (${year})` : '',
        '. ',
        showSite ? `${end(site)} ` : '',
        showPublisher ? `${end(publisher)} ` : '',
        url,
      ).map((r, i, all) => (i === all.length - 1 ? { ...r, text: r.text.trimEnd() } : r));
    }
  }
}

function harvard(kind: SourceKind, d: SourceData): Run[] {
  const authors = harvardAuthors(people(d));
  const year = d.year?.trim() || 'no date';
  const title = (d.title ?? '').trim() || 'Untitled';
  const url = link(d);
  const accessed = d.accessed ? ` (Accessed: ${longDate(d.accessed)})` : '';
  const available = url ? ` Available at: ${url}${accessed}.` : '';
  const placePub = [d.place?.trim(), d.publisher?.trim()].filter(Boolean).join(': ');
  const ed = edition(d.edition);
  const who = authors || '';
  const lead = who ? `${who} (${year}) ` : '';
  switch (kind) {
    case 'article': {
      const vol = (d.volume ?? '').trim();
      const issue = (d.issue ?? '').trim();
      const pages = d.pages ? dash(d.pages) : '';
      return runs(
        lead,
        `‘${title}’`,
        !who ? ` (${year})` : '',
        ', ',
        { text: (d.container ?? '').trim() || 'Untitled journal', italic: true },
        vol ? `, ${vol}` : '',
        issue ? `(${issue})` : '',
        pages ? `, pp. ${pages}` : '',
        '.',
        available,
      );
    }
    case 'chapter': {
      const editors = (d.editors ?? []).map(parsePerson).filter((p): p is Person => !!p);
      const eds = harvardAuthors(editors);
      const pages = d.pages ? dash(d.pages) : '';
      return runs(
        lead,
        `‘${title}’`,
        !who ? ` (${year})` : '',
        ', in ',
        eds ? `${eds} (${editors.length > 1 ? 'eds' : 'ed.'}) ` : '',
        { text: (d.container ?? '').trim() || 'Untitled book', italic: true },
        '.',
        ed ? ` ${ed} edn.` : '',
        placePub ? ` ${placePub}` : '',
        pages ? `, pp. ${pages}` : '',
        placePub || pages ? '.' : '',
        available,
      );
    }
    default: {
      const label = kind === 'video' ? ' [Video]' : '';
      return runs(
        lead,
        { text: title, italic: true },
        !who ? ` (${year})` : '',
        label,
        '.',
        kind === 'book' && ed ? ` ${ed} edn.` : '',
        placePub ? ` ${end(placePub)}` : '',
        kind !== 'book' && !placePub && d.container && d.container.trim() !== who ? ` ${end(d.container.trim())}` : '',
        available,
      );
    }
  }
}

/** The citation in the text: "(Smith, 2020)", "(Smith & Lee, 2020)" (APA) or
 * "(Smith and Lee, 2020)" (Harvard), "(Smith et al., 2020)". */
export function inText(data: SourceData, style: Style, page?: string): string {
  const list = people(data);
  const year = data.year?.trim() || (style === 'apa' ? 'n.d.' : 'no date');
  const and = style === 'apa' ? '&' : 'and';
  let who: string;
  if (list.length === 0) {
    const title = (data.title ?? 'Untitled').trim();
    const short = title.split(/\s+/).slice(0, 4).join(' ');
    who = style === 'apa' ? `“${short}”` : short;
  } else if (list.length === 1) who = list[0].family;
  else if (list.length === 2) who = `${list[0].family} ${and} ${list[1].family}`;
  else if (style === 'harvard' && list.length === 3) who = `${list[0].family}, ${list[1].family} and ${list[2].family}`;
  else who = `${list[0].family} et al.`;
  const at = page?.trim() ? `, ${/[-–]/.test(page) ? 'pp.' : 'p.'} ${dash(page)}` : '';
  return `(${who}, ${year}${at})`;
}

/** The sorting key: the first author's surname, or the title. */
function sortKey(s: Pick<Source, 'data'>): string {
  const first = people(s.data)[0];
  return `${first?.family ?? s.data.title ?? ''} ${s.data.year ?? ''}`.toLowerCase();
}

/** The reference list, in alphabetical order. */
export function referenceList(sources: Pick<Source, 'kind' | 'data'>[], style: Style): Run[][] {
  return [...sources].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map((s) => reference(s.kind, s.data, style));
}

export const plain = (r: Run[]) => r.map((x) => x.text).join('');
export const markdown = (r: Run[]) => r.map((x) => (x.italic ? `*${x.text}*` : x.text)).join('');

const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const html = (r: Run[]) => r.map((x) => (x.italic ? `<em>${escape(x.text)}</em>` : escape(x.text))).join('');

export const STYLE_NAMES: Record<Style, string> = { apa: 'APA 7th', harvard: 'Harvard' };
export const KIND_NAMES: Record<SourceKind, string> = {
  article: 'Journal article',
  book: 'Book',
  chapter: 'Book chapter',
  web: 'Web page',
  report: 'Report',
  video: 'Video',
  other: 'Other',
};
