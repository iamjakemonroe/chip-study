import { describe, expect, it } from 'vitest';
import {
  chunk,
  cleanDomain,
  cleanWebsite,
  COUNTRY_CODES,
  countryName,
  countryOptions,
  csvCell,
  guessCountry,
  institutionError,
  institutionStatus,
  inviteLink,
  invitesCsv,
  invitesText,
  isClassCode,
  isDomain,
  isPublicDomain,
  niceTop,
  normalizeClassCode,
  parseCsv,
  parseCsvEmails,
  parseEmails,
  proThrough,
} from '../../src/lib/institutions.ts';
import { safeNext } from '../../src/lib/session.ts';
import type { MyInstitution } from '../../src/lib/types.ts';

describe('parseEmails', () => {
  it('reads one per line, or separated by commas or semicolons, lowercased and without repeats', () => {
    expect(parseEmails('Ada@School.edu\ngrace@school.edu, alan@school.edu;ada@school.edu\r\n\n')).toEqual({
      emails: ['ada@school.edu', 'grace@school.edu', 'alan@school.edu'],
      invalid: [],
    });
  });

  it('takes the address out of "Name <email>", and leaves names and headings out', () => {
    expect(parseEmails('Email\nAda Lovelace <ada@school.edu>; "Hopper, Grace" <grace@school.edu>\nLovelace, Ada')).toEqual({
      emails: ['ada@school.edu', 'grace@school.edu'],
      invalid: [],
    });
  });

  it('reads several on a line separated by spaces, and mailto: links', () => {
    expect(parseEmails('ada@school.edu grace@school.edu\tmailto:alan@school.edu').emails).toEqual(['ada@school.edu', 'grace@school.edu', 'alan@school.edu']);
  });

  it('says what was meant as an email and isn’t one', () => {
    expect(parseEmails('ada@school\nada.school.edu\nalan@@school.edu\ngrace@school.edu')).toEqual({
      emails: ['grace@school.edu'],
      invalid: ['ada@school', 'ada.school.edu', 'alan@@school.edu'],
    });
  });

  it('gives nothing for nothing', () => {
    expect(parseEmails('  \n , ; ')).toEqual({ emails: [], invalid: [] });
  });
});

describe('parseCsv', () => {
  it('reads quotes, commas and line breaks inside quotes, and "" as a quote', () => {
    expect(parseCsv('name,email\r\n"Lovelace, Ada",ada@school.edu\n"Say ""hi""","line\nbreak"\n')).toEqual([
      ['name', 'email'],
      ['Lovelace, Ada', 'ada@school.edu'],
      ['Say "hi"', 'line\nbreak'],
    ]);
  });

  it('reads Excel’s semicolons, and skips empty rows', () => {
    expect(parseCsv('name;email\n\nAda;ada@school.edu')).toEqual([
      ['name', 'email'],
      ['Ada', 'ada@school.edu'],
    ]);
  });
});

describe('parseCsvEmails', () => {
  it('finds emails in any column, past the heading and the names', () => {
    const csv = '\uFEFFFirst name,Last name,School email,Class\nAda,Lovelace,ADA@school.edu,Bio 101\nGrace,Hopper,grace@school.edu,Bio 101\nAlan,Turing,alan@school,Bio 101\n';
    expect(parseCsvEmails(csv)).toEqual({ emails: ['ada@school.edu', 'grace@school.edu'], invalid: ['alan@school'] });
  });

  it('reads a list exported from a mail app', () => {
    expect(parseCsvEmails('"Lovelace, Ada <ada@school.edu>"\n"Grace Hopper <grace@school.edu>"').emails).toEqual(['ada@school.edu', 'grace@school.edu']);
  });
});

describe('invite links as a file and as text', () => {
  const rows = [
    { email: 'ada@school.edu', token: 'abc123', status: 'invited' as const },
    { email: 'grace@school.edu', token: null, status: 'member' as const },
    { email: 'not-an-email', token: null, status: 'invalid' as const },
  ];

  it('links go to study.kaivon.app/join/<token>', () => {
    expect(inviteLink('abc123')).toBe('https://study.kaivon.app/join/abc123');
  });

  it('a CSV with each email, its role, class, link and status', () => {
    expect(invitesCsv(rows, 'student', 'Biology, Year 10')).toBe(
      [
        'email,role,class,link,status',
        'ada@school.edu,student,"Biology, Year 10",https://study.kaivon.app/join/abc123,Link ready',
        'grace@school.edu,student,"Biology, Year 10",,Already in',
        'not-an-email,student,"Biology, Year 10",,Not an email',
        '',
      ].join('\r\n'),
    );
  });

  it('cells a spreadsheet would run as a formula are made plain text', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('plain')).toBe('plain');
  });

  it('copying all gives each email and its link, a line each, only for links made', () => {
    expect(invitesText(rows)).toBe('ada@school.edu\thttps://study.kaivon.app/join/abc123');
  });

  it('long lists go to the server 500 at a time', () => {
    const list = Array.from({ length: 1201 }, (_, i) => `s${i}@school.edu`);
    expect(chunk(list, 500).map((c) => c.length)).toEqual([500, 500, 201]);
    expect(chunk([], 500)).toEqual([]);
  });
});

describe('class codes', () => {
  it('reads a code however it was typed', () => {
    expect(normalizeClassCode(' k7q-2md ')).toBe('K7Q2MD');
    expect(normalizeClassCode('abc 234')).toBe('ABC234');
  });

  it('are six letters and numbers, without I, O, 0 or 1', () => {
    expect(isClassCode('K7Q2MD')).toBe(true);
    for (const code of ['K7Q2M', 'K7Q2MDX', 'KIQ2MD', 'KOQ2MD', 'K0Q2MD', 'K1Q2MD', 'k7q2md']) expect(isClassCode(code), code).toBe(false);
  });
});

describe('email domains and websites', () => {
  it('cleans what’s typed down to the domain', () => {
    expect(cleanDomain('@Unilag.edu.ng')).toBe('unilag.edu.ng');
    expect(cleanDomain('https://www.unilag.edu.ng/about?x=1')).toBe('unilag.edu.ng');
    expect(cleanDomain('ada@student.unimelb.edu.au')).toBe('student.unimelb.edu.au');
    expect(cleanDomain('  school.edu.  ')).toBe('school.edu');
  });

  it('knows a domain the way the server does', () => {
    for (const d of ['school.edu', 'unilag.edu.ng', 'my-uni.ac.uk']) expect(isDomain(d), d).toBe(true);
    for (const d of ['school', 'school.', '.edu', 'sch ool.edu', 'school.e', 'school..edu']) expect(isDomain(d), d).toBe(false);
  });

  it('refuses free email services, as the server does', () => {
    expect(isPublicDomain('Gmail.com')).toBe(true);
    expect(isPublicDomain('@outlook.com')).toBe(true);
    expect(isPublicDomain('unilag.edu.ng')).toBe(false);
  });

  it('puts https:// in front of a website without it', () => {
    expect(cleanWebsite('unilag.edu.ng')).toBe('https://unilag.edu.ng');
    expect(cleanWebsite('http://old.school.edu')).toBe('http://old.school.edu');
    expect(cleanWebsite('  ')).toBe('');
  });
});

describe('institutionStatus', () => {
  const base = { status: 'approved' as const, active: true, plan: 'pilot' as const, pilot_ends: null, paid_until: null };

  it('says where an institution stands, in a word or two', () => {
    expect(institutionStatus({ ...base, status: 'pending', active: false })).toEqual({ label: 'Waiting for Kaivon', tone: 'wait' });
    expect(institutionStatus({ ...base, status: 'rejected', active: false })).toEqual({ label: 'Not approved', tone: 'off' });
    expect(institutionStatus({ ...base, status: 'suspended', active: false })).toEqual({ label: 'Paused', tone: 'warn' });
    expect(institutionStatus(base)).toEqual({ label: 'Pilot', tone: 'good' });
    expect(institutionStatus({ ...base, pilot_ends: '2027-02-05' }).label).toMatch(/^Pilot until .*2027/);
    expect(institutionStatus({ ...base, active: false, pilot_ends: '2026-01-01' })).toEqual({ label: 'Pilot ended', tone: 'warn' });
    expect(institutionStatus({ ...base, plan: 'paid', paid_until: '2027-09-01' })).toEqual({ label: 'Active', tone: 'good' });
    expect(institutionStatus({ ...base, plan: 'paid', active: false })).toEqual({ label: 'Plan ended', tone: 'warn' });
  });
});

describe('proThrough', () => {
  const inst = (over: Partial<MyInstitution>): MyInstitution => ({
    id: 'i1',
    name: 'University of Lagos',
    kind: 'university',
    country: 'NG',
    status: 'approved',
    role: 'student',
    plan: 'pilot',
    active: true,
    seats: 50,
    students: 3,
    pilot_ends: null,
    paid_until: null,
    joined_at: '2026-11-01T00:00:00Z',
    ...over,
  });

  it('is the active institution when Pro has no paid-until date', () => {
    expect(proThrough({ tier: 'pro', pro_until: null }, [inst({ id: 'a', active: false }), inst({ id: 'b' })])?.id).toBe('b');
  });

  it('is nobody when Pro is paid for on the web, or there’s no Pro, or no active institution', () => {
    expect(proThrough({ tier: 'pro', pro_until: '2026-12-01T00:00:00Z' }, [inst({})])).toBeNull();
    expect(proThrough({ tier: 'free', pro_until: null }, [inst({})])).toBeNull();
    expect(proThrough({ tier: 'pro', pro_until: null }, [inst({ active: false })])).toBeNull();
    expect(proThrough({ tier: 'pro', pro_until: null }, null)).toBeNull();
    expect(proThrough(null, [inst({})])).toBeNull();
  });

  it('goes by the server’s via_institution when it says', () => {
    // Paid-for Pro that also has an institution: Pro is their own.
    expect(proThrough({ tier: 'pro', pro_until: null, via_institution: false }, [inst({})])).toBeNull();
    expect(proThrough({ tier: 'pro', pro_until: '2026-12-01T00:00:00Z', via_institution: true }, [inst({ id: 'b' })])?.id).toBe('b');
  });
});

describe('institutionError', () => {
  it('turns each of the server’s errors into a sentence', () => {
    const cases: [string, RegExp][] = [
      ['not allowed', /can’t do that here/],
      ['no seats left', /no seats left/],
      ['institution not active', /isn’t open to students/],
      ['invite not open', /can’t be used any more/],
      ['invite is for another email', /different email/],
      ['already staff', /teacher or admin there already/],
      ['last admin', /only admin/],
      ['save your account first', /Save your account/],
      ['parental consent needed', /parents’ or guardians’ consent/],
      ['public email domain', /public email domain/],
      ['no such class', /No class has that code/],
      ['too many waiting', /three institutions waiting/],
      ['too many', /too many at once/],
      ['not a member', /not part of this institution/],
      ['duplicate key value violates unique constraint "study_institutions_domain"', /already uses that email domain/],
      ['invalid input syntax for type uuid: "abc"', /link isn’t right/],
      ['new row for relation "study_institutions" violates check constraint "study_institutions_name_check"', /isn’t quite right/],
      ['TypeError: Failed to fetch', /offline/],
      ['JWT expired', /sign-in has run out/],
    ];
    for (const [raw, sentence] of cases) expect(institutionError(raw), raw).toMatch(sentence);
  });

  it('falls back to what was being done', () => {
    expect(institutionError('something odd', 'Couldn’t make that class just now.')).toBe('Couldn’t make that class just now.');
    expect(institutionError('something odd')).toMatch(/Something went wrong/);
  });

  it('never says no exclamation marks or raw codes', () => {
    for (const raw of ['not allowed', 'no seats left', 'last admin', 'xyz']) expect(institutionError(raw)).not.toMatch(/!|_/);
  });
});

describe('niceTop', () => {
  it('rounds study time up to clean hours', () => {
    expect(niceTop(0, 'minutes')).toBe(60);
    expect(niceTop(45, 'minutes')).toBe(60);
    expect(niceTop(95, 'minutes')).toBe(120);
    expect(niceTop(130, 'minutes')).toBe(180);
    expect(niceTop(601, 'minutes')).toBe(900);
    expect(niceTop(12_345, 'minutes')).toBe(250 * 60);
  });

  it('rounds students up to a round number', () => {
    expect(niceTop(0, 'active')).toBe(5);
    expect(niceTop(3, 'active')).toBe(5);
    expect(niceTop(17, 'active')).toBe(20);
    expect(niceTop(42, 'active')).toBe(50);
    expect(niceTop(734, 'active')).toBe(750);
  });
});

describe('countries', () => {
  it('has every code once, and names them', () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(countryName('NG')).toBe('Nigeria');
    const all = countryOptions();
    expect(all).toHaveLength(COUNTRY_CODES.length);
    expect(all.map((c) => c.name)).toEqual([...all.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
  });

  it('guesses from the browser’s language, or leaves it to pick', () => {
    expect(guessCountry('en-GB')).toBe('GB');
    expect(guessCountry('en_NG')).toBe('NG');
    expect(guessCountry('en')).toBe('');
    expect(guessCountry('en-419')).toBe('');
  });
});

describe('safeNext', () => {
  it('goes back into the app, or to an invite link, and nowhere else', () => {
    expect(safeNext('/app/settings')).toBe('/app/settings');
    expect(safeNext('/join/0123abcdef')).toBe('/join/0123abcdef');
    for (const next of [null, '', '//evil.test', 'https://evil.test/app', '/join/../app', '/join/a/b', '/institutions']) expect(safeNext(next), String(next)).toBe('/app');
  });
});
