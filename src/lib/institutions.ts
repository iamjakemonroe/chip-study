import { site } from '../content/site.ts';
import { fromDay } from './dates.ts';
import type { InstitutionKind, InstitutionPlan, InstitutionRole, InstitutionStatus, InviteResult, Me, MyInstitution } from './types.ts';

/** Institutions (schools, colleges and universities) in Chip Study: the parts that don't talk to
 * the server. Reading a list of emails or a CSV, the links, the words for each status and role,
 * and turning the server's errors into sentences. */

/** An email, as the server checks one. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value);
}

/** Emails pasted any way people paste them: one per line, comma or semicolon separated, or
 * "Ada Lovelace <ada@school.edu>". Lowercased, without repeats, in the order given; anything
 * that was meant as an email and isn't one comes back in [invalid] so it can be fixed. */
export function parseEmails(text: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const piece of text.split(/[\n\r,;]+/)) take(piece, emails, invalid, false);
  return { emails, invalid };
}

/** Emails from a CSV file: any cell with an @ in it, in any column (names, headers and the rest
 * are left out). Quoted cells, commas inside quotes and Excel's semicolons all work. */
export function parseCsvEmails(text: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const row of parseCsv(text)) for (const cell of row) take(cell, emails, invalid, true);
  return { emails, invalid };
}

function take(piece: string, emails: string[], invalid: string[], onlyWithAt: boolean) {
  const raw = piece.replace(/^\uFEFF/, '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!raw) return;
  const angled = raw.match(/<([^<>]+)>/);
  const words = angled ? [angled[1]] : raw.split(/\s+/);
  const withAt = words.filter((w) => w.includes('@'));
  // Words without an @ are names or headings ("Lovelace, Ada", "Email"), left out; one word with
  // a dot in it is an address missing its @, to fix.
  if (!withAt.length) {
    if (!onlyWithAt && words.length === 1 && raw.includes('.')) add(invalid, raw);
    return;
  }
  for (const w of withAt) {
    const email = w.replace(/^mailto:/i, '').replace(/^[("'<[]+|[)"'>\].]+$/g, '').toLowerCase();
    if (isEmail(email)) add(emails, email);
    else add(invalid, w);
  }
}

function add(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

/** A CSV file's rows and cells (RFC 4180: quotes, "" inside quotes, line breaks inside quotes).
 * The separator is a comma, or a semicolon when the first line has more of those (Excel in much
 * of Europe). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** One CSV cell, quoted when it needs to be. Cells that a spreadsheet would run as a formula
 * start with an apostrophe. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The invite links made, as a CSV to keep or mail-merge. */
export function invitesCsv(rows: InviteResult[], role: InstitutionRole, className: string | null): string {
  const head = ['email', 'role', 'class', 'link', 'status'];
  const lines = rows.map((r) => [r.email, role, className ?? '', r.token ? inviteLink(r.token) : '', INVITE_STATUS[r.status]].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

/** Each email and its link, a line each, to paste into an email or a message. */
export function invitesText(rows: InviteResult[]): string {
  return rows
    .filter((r) => r.token)
    .map((r) => `${r.email}\t${inviteLink(r.token!)}`)
    .join('\n');
}

export const INVITE_STATUS: Record<InviteResult['status'], string> = {
  invited: 'Link ready',
  member: 'Already in',
  invalid: 'Not an email',
};

/** The most the server makes links for in one go. */
export const INVITE_BATCH = 500;

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function inviteLink(token: string): string {
  return `${site.url}/join/${token}`;
}

// ── Class codes ───────────────────────────────────────────────────────

/** A class code as typed ("abc 234", "ABC-234") made into the code itself. */
export function normalizeClassCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Six letters and numbers, without the ones that look alike (I, O, 0, 1). */
export function isClassCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code);
}

// ── Email domains ─────────────────────────────────────────────────────

/** Free email services: never a school's own domain. The server refuses the same ones. */
export const PUBLIC_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com', 'aol.com', 'proton.me', 'protonmail.com', 'ymail.com', 'mail.com', 'gmx.com'];

/** A domain as typed ("@Unilag.edu.ng", "https://www.unilag.edu.ng/about") made plain. */
export function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^.*@/, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

export function isDomain(domain: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain);
}

export function isPublicDomain(domain: string): boolean {
  return PUBLIC_DOMAINS.includes(cleanDomain(domain));
}

/** A website as typed, with https:// in front if it had nothing. */
export function cleanWebsite(input: string): string {
  const v = input.trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// ── Words for things ──────────────────────────────────────────────────

export const KIND_LABEL: Record<InstitutionKind, string> = {
  university: 'University',
  college: 'College',
  school: 'School',
  other: 'Other',
};

export const ROLE_LABEL: Record<InstitutionRole, string> = {
  admin: 'Admin',
  teacher: 'Teacher',
  student: 'Student',
};

/** "an admin", "a teacher", "a student". */
export function aRole(role: InstitutionRole): string {
  return role === 'admin' ? 'an admin' : `a ${role}`;
}

/** A day the server keeps as YYYY-MM-DD, said the local way: "5 Feb 2027". */
export function dayText(day: string | null | undefined, year = true): string {
  if (!day) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day) ? fromDay(day) : new Date(day);
  return d.toLocaleDateString(undefined, year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'long' });
}

/** The day a week starts, short: "3 Nov". */
export function weekLabel(day: string): string {
  return fromDay(day.slice(0, 10)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** A clean top for the axis: whole hours (or half hours under two) for study time, a round
 * number of students. */
export function niceTop(max: number, metric: 'minutes' | 'active'): number {
  if (metric === 'minutes') {
    if (max <= 60) return 60;
    if (max <= 120) return Math.ceil(max / 30) * 30;
    const hours = Math.ceil(max / 60);
    const step = hours <= 10 ? 1 : hours <= 50 ? 5 : hours <= 100 ? 10 : 10 ** Math.floor(Math.log10(hours)) / 2;
    return Math.ceil(hours / step) * step * 60;
  }
  if (max <= 5) return 5;
  const step = max <= 20 ? 5 : max <= 100 ? 10 : 10 ** Math.floor(Math.log10(max)) / 2;
  return Math.ceil(max / step) * step;
}

export type StatusTone = 'good' | 'wait' | 'warn' | 'off';

/** Where an institution stands, in a word or two, and how to colour it. */
export function institutionStatus(i: { status: InstitutionStatus; active: boolean; plan: InstitutionPlan; pilot_ends: string | null; paid_until: string | null }): { label: string; tone: StatusTone } {
  if (i.status === 'pending') return { label: 'Waiting for Kaivon', tone: 'wait' };
  if (i.status === 'rejected') return { label: 'Not approved', tone: 'off' };
  if (i.status === 'suspended') return { label: 'Paused', tone: 'warn' };
  if (!i.active) return { label: i.plan === 'paid' ? 'Plan ended' : 'Pilot ended', tone: 'warn' };
  if (i.plan === 'paid') return { label: 'Active', tone: 'good' };
  return { label: i.pilot_ends ? `Pilot until ${dayText(i.pilot_ends)}` : 'Pilot', tone: 'good' };
}

export const TONE_CLASS: Record<StatusTone, string> = {
  good: 'bg-mint-soft text-[#16795f]',
  wait: 'bg-sand-soft text-[#8a6a1f]',
  warn: 'bg-peach-soft text-[#9a4a1b]',
  off: 'bg-rose-soft text-[#b8355a]',
};

/** The active institution giving this account Pro, when Pro comes only from one: the server says
 * so (via_institution); a server older than that is read as tier pro with no paid-until date. */
export function proThrough(me: Pick<Me, 'tier' | 'pro_until' | 'via_institution'> | null | undefined, mine: MyInstitution[] | null | undefined): MyInstitution | null {
  if (!me || me.tier !== 'pro' || !mine) return null;
  if (me.via_institution === false || (me.via_institution === undefined && me.pro_until)) return null;
  return mine.find((m) => m.active) ?? null;
}

/** How Pro through an institution differs from Pro of your own, said the same way everywhere. */
export const VIA_INSTITUTION_NOTE = 'with a little less of Chip’s best model than personal Pro';

// ── Errors ────────────────────────────────────────────────────────────

/** What the server said, as a sentence for a person. Checked in order: the first match wins. */
const ERRORS: [RegExp, string][] = [
  [/fetch|network|Load failed/i, 'You seem to be offline. Try again in a moment.'],
  [/not authenticated|JWT/i, 'Your sign-in has run out. Sign in again.'],
  [/save your account first/, 'Save your account with your email first.'],
  [/parental consent needed/, 'A school confirms it has parents’ or guardians’ consent for students under 18.'],
  [/too many waiting/, 'You already have three institutions waiting for us to check. We’ll be in touch soon.'],
  [/too many/, 'That’s too many at once. Try fewer.'],
  [/no seats left/, 'There are no seats left. An admin can ask Kaivon for more.'],
  [/institution not active/, 'This institution isn’t open to students right now.'],
  [/invite not open/, 'That invite link can’t be used any more. Ask for a new one.'],
  [/invite is for another email/, 'That invite is for a different email. Sign in with the email it was sent to.'],
  [/already staff/, 'You’re a teacher or admin there already, so you can’t join as a student.'],
  [/last admin/, 'You’re the only admin. Make someone else an admin first.'],
  [/public email domain/, 'That’s a public email domain, like gmail.com. Use the institution’s own domain.'],
  [/study_institutions_domain|duplicate key/, 'Another institution already uses that email domain.'],
  [/no such class/, 'No class has that code. Check it with your teacher.'],
  [/under 18 not allowed here/, 'This institution hasn’t said students under 18 will join, so you can’t join it yet. Ask your teacher or its admins about it.'],
  [/schools need it/, 'A school always has students under 18, so this stays on.'],
  [/link expired/, 'That sign-in link has run out. Open Chip Study from your course again.'],
  [/linked to another account/, 'Your course account is already linked to a different Chip Study account. Sign in with that one.'],
  [/registered to another institution/, 'That platform is already connected to another institution. Write to support@kaivon.app.'],
  [/institution not approved/, 'Invoices are for approved institutions.'],
  [/not open/, 'That invoice is already paid or cancelled.'],
  [/no such account/, 'No account has that email, username or ID.'],
  [/no such code|your own code|already referred|too late/, 'That invite code can’t be used.'],
  [/no such institution/, 'That institution isn’t there any more.'],
  [/not a member/, 'They’re not part of this institution any more.'],
  [/not allowed/, 'You can’t do that here. An admin of the institution can.'],
  [/invalid input syntax/, 'That link isn’t right. Check you have all of it.'],
  [/check constraint|bad role|bad status/, 'Something in the form isn’t quite right. Check it and try again.'],
];

export function institutionError(message: string, fallback = 'Something went wrong. Try again in a moment.'): string {
  for (const [match, sentence] of ERRORS) if (match.test(message)) return sentence;
  return fallback;
}

// ── Countries ─────────────────────────────────────────────────────────

/** ISO 3166-1 two-letter codes; the names come from the browser, in its language. */
export const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN ' +
  'CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK ' +
  'HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH ' +
  'MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS ' +
  'RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE ' +
  'VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ');

let names: Intl.DisplayNames | null | undefined;

export function countryName(code: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(undefined, { type: 'region' });
    } catch {
      names = null;
    }
  }
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every country, by name, for a select. */
export function countryOptions(): { code: string; name: string }[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** A first guess at the country, from the browser's language ("en-GB": GB), or nothing. */
export function guessCountry(language = typeof navigator === 'undefined' ? '' : navigator.language): string {
  const region = language.split(/[-_]/)[1]?.toUpperCase() ?? '';
  return COUNTRY_CODES.includes(region) ? region : '';
}
