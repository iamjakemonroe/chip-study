/** The institutions side of the pretend Supabase (e2e/mock.ts): schools, colleges and
 * universities, their members, classes and invite links, and Kaivon's review. It follows the
 * rules of utopia's 20261107160000_study_institutions.sql, with 20261107180000_study_growth.sql
 * (a school confirms parents' consent; a student's classes) and 20261107210000_study_institution_gaps.sql
 * (peeking at a class code, open invites, the staff check, clearing a domain, forgetting), kept in
 * memory: who may do what, seats, and the errors the SQL raises. */

type Role = 'admin' | 'teacher' | 'student';
type Status = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface Inst {
  id: string;
  name: string;
  country: string;
  kind: 'university' | 'college' | 'school' | 'other';
  website: string;
  domain_requested: string;
  email_domain: string | null;
  contact_name: string;
  contact_role: string;
  students_estimate: number | null;
  minors_consent: boolean;
  status: Status;
  plan: 'pilot' | 'paid';
  seats: number;
  pilot_ends: string | null;
  paid_until: string | null;
  review_note: string;
  reviewed_at: string | null;
  created_by: string;
  created_at: string;
}

export interface Person {
  id: string;
  name: string;
  email: string;
}

interface Member {
  institution_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
  /** Seen what the institution can see (null: joined from a learning platform, not yet). */
  consented: boolean;
}

interface Klass {
  id: string;
  institution_id: string;
  name: string;
  code: string;
  archived: boolean;
  created_at: string;
  help_level: 'guide' | 'explain' | 'hints';
  course_brief: string;
  tutor_notes: string;
}

export interface MockInvoice {
  id: string;
  institution_id: string;
  ref: string;
  label: string;
  seats: number;
  months: number;
  currency: 'USD' | 'NGN';
  amount: number;
  status: 'open' | 'paid' | 'void';
  created_at: string;
  paid_at: string | null;
}

export interface MockPlatform {
  id: string;
  institution_id: string;
  name: string;
  issuer: string;
  client_id: string;
  deployment_id: string;
  auth_url: string;
  jwks_url: string;
  created_at: string;
  courses: number;
}

export interface MockPending {
  token: string;
  platform_id: string;
  email: string | null;
  teacher: boolean;
  course: string | null;
  /** Linked already to someone else's account. */
  owner?: string;
}

interface Invite {
  token: string;
  institution_id: string;
  email: string;
  role: Role;
  class_id: string | null;
  state: 'open' | 'used' | 'expired' | 'revoked';
  created_at: string;
}

/** Raised as Postgres would raise it: PostgREST answers 400 with the message. */
export class Raise extends Error {}

const day = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const now = () => new Date().toISOString();
let n = 0;
/** A uuid-shaped id, starting with [kind] (one hex digit) so a test can tell them apart. */
const id = (kind: string) => {
  n += 1;
  return `${kind}0000000-0000-4000-8000-${String(n + Math.floor(Math.random() * 1e6) * 100).padStart(12, '0').slice(-12)}`;
};
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PUBLIC = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com', 'aol.com', 'proton.me', 'protonmail.com', 'ymail.com', 'mail.com', 'gmx.com'];

export class MockInstitutions {
  institutions: Inst[] = [];
  members: Member[] = [];
  classes: Klass[] = [];
  classMembers: { class_id: string; user_id: string; role: 'teacher' | 'student' }[] = [];
  invites: Invite[] = [];
  people: Person[] = [];
  staff = new Set<string>();
  /** Each account's answer to the age question (none: not asked yet). */
  age = new Map<string, 'adult' | 'guardian'>();
  invoices: MockInvoice[] = [];
  platforms: MockPlatform[] = [];
  pending: MockPending[] = [];
  /** Each class's themes as last made, and how many of its students asked Chip in 14 days. */
  themes = new Map<string, { generated_at: string; students: number; questions: number; themes: { title: string; detail: string; questions: number }[] }>();
  askers = new Map<string, number>();
  /** Invite codes: whose each is, and who said they came through one. */
  codes = new Map<string, string>();
  referrals: { user_id: string; referrer: string; rewarded: boolean; created_at: string }[] = [];
  reps = new Map<string, { name: string; since: string }>();
  /** The account is older than 14 days (too late to say who invited it). */
  oldAccount = false;

  constructor(private me: () => Person) {}

  // ── Seeding, for the tests ──────────────────────────────────────────

  /** An institution, approved and in its pilot unless [fields] say otherwise, with the account
   * in it as [role] (or not in it, with null). */
  seed(fields: Partial<Inst> = {}, role: Role | null = 'admin'): Inst {
    const inst: Inst = {
      id: id('1'),
      name: 'Lagos Bay University',
      country: 'NG',
      kind: 'university',
      website: 'https://lagosbay.edu.ng',
      domain_requested: 'lagosbay.edu.ng',
      email_domain: null,
      contact_name: 'Ada Lovelace',
      contact_role: 'Head of digital learning',
      students_estimate: 1200,
      minors_consent: false,
      status: 'approved',
      plan: 'pilot',
      seats: 50,
      pilot_ends: day(60),
      paid_until: null,
      review_note: '',
      reviewed_at: now(),
      created_by: role === 'admin' ? this.me().id : 'someone-else',
      created_at: now(),
      ...fields,
    };
    this.institutions.push(inst);
    if (role) this.join(inst.id, this.me().id, role);
    return inst;
  }

  /** A university with three students, a teacher and a class (Biology 101, code K7Q2MD); the
   * account is its admin. */
  seedSchool() {
    const inst = this.seed({}, 'admin');
    const grace = this.person('Grace Hopper', 'grace@lagosbay.edu.ng');
    const alan = this.person('Alan Turing', 'alan@lagosbay.edu.ng');
    const kate = this.person('Katherine Johnson', 'kate@lagosbay.edu.ng');
    const tunde = this.person('Tunde Bello', 'tunde@lagosbay.edu.ng');
    for (const p of [grace, alan, kate]) this.join(inst.id, p.id, 'student');
    this.join(inst.id, tunde.id, 'teacher');
    const bio = this.klass(inst.id, 'Biology 101', 'K7Q2MD');
    this.inClass(bio.id, grace.id, 'student');
    this.inClass(bio.id, alan.id, 'student');
    this.inClass(bio.id, tunde.id, 'teacher');
    return { inst, grace, alan, kate, tunde, bio };
  }

  person(name: string, email: string): Person {
    const p = { id: id('2'), name, email };
    this.people.push(p);
    return p;
  }

  join(institutionId: string, userId: string, role: Role, consented = true) {
    this.members.push({ institution_id: institutionId, user_id: userId, role, joined_at: now(), consented });
  }

  klass(institutionId: string, name: string, code?: string): Klass {
    const c: Klass = { id: id('3'), institution_id: institutionId, name, code: code ?? this.newCode(), archived: false, created_at: now(), help_level: 'guide', course_brief: '', tutor_notes: '' };
    this.classes.push(c);
    return c;
  }

  inClass(classId: string, userId: string, role: 'teacher' | 'student') {
    this.classMembers.push({ class_id: classId, user_id: userId, role });
  }

  invite(institutionId: string, email: string, role: Role, classId: string | null = null, state: Invite['state'] = 'open', token = `${id('7').replace(/-/g, '')}${id('7').replace(/-/g, '')}`): Invite {
    const inv = { token, institution_id: institutionId, email, role, class_id: classId, state, created_at: now() };
    this.invites.push(inv);
    return inv;
  }

  // ── Rules, as the SQL has them ──────────────────────────────────────

  active(i: Inst | undefined): boolean {
    if (!i || i.status !== 'approved') return false;
    return i.plan === 'paid' ? !i.paid_until || i.paid_until >= day() : !i.pilot_ends || i.pilot_ends >= day();
  }

  roleOf(institutionId: string, userId: string): Role | null {
    return this.members.find((m) => m.institution_id === institutionId && m.user_id === userId)?.role ?? null;
  }

  /** Whether the account has Pro through an active institution. */
  proFor(userId: string): boolean {
    return this.members.some((m) => m.user_id === userId && this.active(this.inst(m.institution_id)));
  }

  private inst(id: string) {
    return this.institutions.find((i) => i.id === id);
  }

  private who(userId: string): Person {
    return userId === this.me().id ? this.me() : (this.people.find((p) => p.id === userId) ?? { id: userId, name: 'Someone', email: 'someone@example.test' });
  }

  private studentsCount(institutionId: string) {
    return this.members.filter((m) => m.institution_id === institutionId && m.role === 'student').length;
  }

  private visible(institutionId: string, viewer: string): string[] {
    const role = this.roleOf(institutionId, viewer);
    return this.members
      .filter((m) => m.institution_id === institutionId && m.role === 'student')
      .filter((m) => {
        if (role === 'admin') return true;
        if (role !== 'teacher') return false;
        return this.classMembers.some((s) => {
          if (s.user_id !== m.user_id || s.role !== 'student') return false;
          const c = this.classes.find((k) => k.id === s.class_id);
          return !!c && c.institution_id === institutionId && !c.archived && this.classMembers.some((t) => t.class_id === s.class_id && t.user_id === viewer && t.role === 'teacher');
        });
      })
      .map((m) => m.user_id);
  }

  private addStudent(institutionId: string, userId: string) {
    if (this.roleOf(institutionId, userId)) return;
    const i = this.inst(institutionId);
    if (!this.active(i)) throw new Raise('institution not active');
    if (this.age.get(userId) === 'guardian' && !i!.minors_consent) throw new Raise('under 18 not allowed here');
    if (this.studentsCount(institutionId) >= i!.seats) throw new Raise('no seats left');
    this.join(institutionId, userId, 'student');
  }

  private newCode() {
    for (;;) {
      const code = Array.from({ length: 6 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
      if (!this.classes.some((c) => c.code === code)) return code;
    }
  }

  private staffOrRaise() {
    if (!this.staff.has(this.me().id)) throw new Raise('not allowed');
  }

  private details(i: Inst) {
    return {
      id: i.id,
      name: i.name,
      kind: i.kind,
      country: i.country,
      website: i.website,
      status: i.status,
      plan: i.plan,
      active: this.active(i),
      seats: i.seats,
      pilot_ends: i.pilot_ends,
      paid_until: i.paid_until,
      email_domain: i.email_domain,
      domain_requested: i.domain_requested,
      contact_name: i.contact_name,
      contact_role: i.contact_role,
      review_note: i.review_note,
      created_at: i.created_at,
    };
  }

  /** [user]'s invite code, made the first time. */
  codeOf(user: string): string {
    let code = this.codes.get(user);
    if (!code) {
      code = Array.from({ length: 8 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
      this.codes.set(user, code);
    }
    return code;
  }

  /** An admin of the class's institution, or one of its teachers. */
  private runs(c: Klass, user: string): boolean {
    return this.roleOf(c.institution_id, user) === 'admin' || this.classMembers.some((t) => t.class_id === c.id && t.user_id === user && t.role === 'teacher');
  }

  /** The chip-study function's "class_themes": themes once 5 or more students asked. */
  makeThemes(classId: string) {
    const c = this.classes.find((x) => x.id === classId);
    if (!c || !this.runs(c, this.me().id)) return { status: 403, body: { error: 'Only whoever runs this class can see its themes.' } };
    const students = this.askers.get(classId) ?? 0;
    if (students < 5) return { status: 200, body: { enough: false, students } };
    const saved = {
      generated_at: now(),
      students,
      questions: students * 6,
      themes: [
        { title: 'Reading the brief', detail: 'Many students aren’t sure what “critically evaluate” asks of them, and want examples of the difference from describing.', questions: 14 },
        { title: 'Choosing sources', detail: 'Students ask how many sources are enough and whether textbooks count as academic sources.', questions: 9 },
        { title: 'The second law', detail: 'Questions show confusion between heat and temperature when applying it.', questions: 7 },
      ],
    };
    this.themes.set(classId, saved);
    return { status: 200, body: { enough: true, class_id: classId, ...saved } };
  }

  /** web-pay's "invoice" (the checkout link) and "confirm" for an invoice's reference. */
  invoiceCheckout(invoiceId: string): { status: number; body: unknown } {
    const v = this.invoices.find((x) => x.id === invoiceId);
    if (!v || this.roleOf(v.institution_id, this.me().id) !== 'admin') return { status: 400, body: { error: 'invoice' } };
    if (v.status !== 'open') return { status: 400, body: { error: 'paid' } };
    return { status: 200, body: { link: `https://checkout.flutterwave.test/pay/${v.ref}`, ref: v.ref } };
  }

  invoicePaid(ref: string): { status: 'paid'; product: 'institution'; until: string } | null {
    const v = this.invoices.find((x) => x.ref === ref);
    if (!v) return null;
    const i = this.inst(v.institution_id)!;
    if (v.status === 'open') {
      v.status = 'paid';
      v.paid_at = now();
      i.plan = 'paid';
      i.seats = Math.max(i.seats, v.seats);
      const until = new Date();
      until.setMonth(until.getMonth() + v.months);
      i.paid_until = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`;
    }
    return { status: 'paid', product: 'institution', until: i.paid_until! };
  }

  /** Deleting your study data (study_forget_me) also takes you out of the institutions you
   * joined as a student, and their classes. */
  forget(userId: string) {
    const studentOf = new Set(this.members.filter((m) => m.user_id === userId && m.role === 'student').map((m) => m.institution_id));
    this.classMembers = this.classMembers.filter((cm) => !(cm.user_id === userId && studentOf.has(this.classes.find((c) => c.id === cm.class_id)?.institution_id ?? '')));
    this.members = this.members.filter((m) => !(m.user_id === userId && m.role === 'student'));
  }

  // ── The functions ───────────────────────────────────────────────────

  handles(fn: string): boolean {
    return fn in this.fns;
  }

  call(fn: string, a: Record<string, unknown>): unknown {
    return this.fns[fn](a);
  }

  // Arguments arrive as JSON; each function reads the ones it takes, as the SQL does.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fns: Record<string, (a: Record<string, any>) => unknown> = {
    study_my_institutions: () => {
      const me = this.me();
      const domain = me.email.split('@')[1] ?? '';
      return {
        mine: this.members
          .filter((m) => m.user_id === me.id)
          .map((m) => {
            const i = this.inst(m.institution_id)!;
            return { id: i.id, name: i.name, kind: i.kind, country: i.country, status: i.status, role: m.role, plan: i.plan, active: this.active(i), seats: i.seats, students: this.studentsCount(i.id), pilot_ends: i.pilot_ends, paid_until: i.paid_until, joined_at: m.joined_at };
          }),
        suggested: this.institutions
          .filter((i) => domain && i.email_domain === domain && this.active(i) && !this.roleOf(i.id, me.id))
          .map((i) => ({ id: i.id, name: i.name, kind: i.kind, country: i.country })),
      };
    },

    study_institution_register: (a) => {
      const me = this.me();
      if (a.p_kind === 'school' && !a.p_minors_consent) throw new Raise('parental consent needed');
      if (this.institutions.filter((i) => i.created_by === me.id && i.status === 'pending').length >= 3) throw new Raise('too many waiting');
      const name = String(a.p_name ?? '').trim();
      if (name.length < 2 || !/^[A-Z]{2}$/.test(String(a.p_country ?? '').toUpperCase())) throw new Raise('new row violates check constraint');
      const inst = this.seed(
        {
          id: id('4'),
          name,
          country: String(a.p_country).toUpperCase(),
          kind: a.p_kind,
          website: String(a.p_website ?? '').trim(),
          domain_requested: String(a.p_email_domain ?? '').trim().toLowerCase(),
          contact_name: String(a.p_contact_name ?? '').trim(),
          contact_role: String(a.p_contact_role ?? '').trim(),
          students_estimate: a.p_students_estimate ?? null,
          minors_consent: !!a.p_minors_consent,
          status: 'pending',
          seats: 0,
          pilot_ends: null,
          reviewed_at: null,
          created_by: me.id,
        },
        'admin',
      );
      return inst.id;
    },

    study_institution_overview: (a) => {
      const me = this.me().id;
      const role = this.roleOf(a.p_inst, me);
      if (role !== 'admin' && role !== 'teacher') throw new Raise('not allowed');
      const i = this.inst(a.p_inst)!;
      const seen = this.visible(i.id, me).length;
      const minutes = [120, 240, 300, 180, 420, 360, 510, 615];
      return {
        role,
        institution: this.details(i),
        counts: {
          students: this.studentsCount(i.id),
          visible_students: seen,
          teachers: this.members.filter((m) => m.institution_id === i.id && m.role === 'teacher').length,
          admins: this.members.filter((m) => m.institution_id === i.id && m.role === 'admin').length,
          classes: this.classes.filter((c) => c.institution_id === i.id && !c.archived).length,
          invites_open: this.invites.filter((v) => v.institution_id === i.id && v.state === 'open').length,
        },
        week: seen
          ? { active_students: Math.min(seen, 2), focus_minutes: 615, practice_sessions: 9, practice_score: 78, chip_asks: 46, ai_records: 31 }
          : { active_students: 0, focus_minutes: 0, practice_sessions: 0, practice_score: null, chip_asks: 0, ai_records: 0 },
        weeks: minutes.map((m, g) => ({ week: day(-6 - 7 * (7 - g)), active: seen ? Math.min(seen, 1 + (g % 3)) : 0, minutes: seen ? m : 0 })),
      };
    },

    study_institution_students: (a) => {
      const me = this.me().id;
      const role = this.roleOf(a.p_inst, me);
      if (role !== 'admin' && role !== 'teacher') throw new Raise('not allowed');
      const seen = new Set(this.visible(a.p_inst, me));
      return this.members
        .filter((m) => m.institution_id === a.p_inst && (role === 'admin' || seen.has(m.user_id)))
        .filter((m) => !a.p_class || this.classMembers.some((c) => c.class_id === a.p_class && c.user_id === m.user_id))
        .map((m, k) => {
          const p = this.who(m.user_id);
          return {
            user_id: m.user_id,
            name: p.name,
            email: p.email,
            role: m.role,
            classes: this.classMembers
              .filter((c) => c.user_id === m.user_id)
              .map((c) => this.classes.find((x) => x.id === c.class_id))
              .filter((c) => c && c.institution_id === a.p_inst && !c.archived)
              .map((c) => c!.name)
              .sort(),
            joined_at: m.joined_at,
            last_active: m.role === 'student' ? new Date(Date.now() - (k + 1) * 3_600_000).toISOString() : null,
            minutes_30d: m.role === 'student' ? 95 + k * 40 : 0,
            practice_score_30d: m.role === 'student' ? 70 + k : null,
            asks_30d: m.role === 'student' ? 12 + k : 0,
            assignments: m.role === 'student' ? 2 : 0,
            ai_records: m.role === 'student' ? 5 + k : 0,
          };
        })
        .sort((x, y) => x.role.localeCompare(y.role) || x.name.localeCompare(y.name));
    },

    study_institution_student: (a) => {
      if (!this.visible(a.p_inst, this.me().id).includes(a.p_user)) throw new Raise('not allowed');
      const p = this.who(a.p_user);
      const m = this.members.find((x) => x.institution_id === a.p_inst && x.user_id === a.p_user)!;
      const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
      return {
        student: { user_id: p.id, name: p.name, email: p.email, joined_at: m.joined_at },
        assignments: [
          {
            id: 'as-1',
            title: 'Essay: Coastal erosion',
            course: 'GEO 201',
            kind: 'assignment',
            status: 'active',
            due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
            words: 1512,
            updated: at(2),
            focus_minutes: 190,
            practice: { sessions: 3, score: 84 },
            ai_use: [
              { action: 'explain', summary: 'Asked Chip to explain', words: 0, at: at(50) },
              { action: 'plan', summary: 'Asked Chip to plan', words: 0, at: at(49) },
              { action: 'inserted', summary: 'Put Chip’s words into the document', words: 46, at: at(30) },
              { action: 'check', summary: 'Asked Chip to check their work', words: 0, at: at(3) },
            ],
          },
          { id: 'as-2', title: 'Cell respiration', course: 'BIO 110', kind: 'topic', status: 'active', due_at: null, words: 420, updated: at(80), focus_minutes: 50, practice: { sessions: 0, score: null }, ai_use: [] },
        ],
      };
    },

    study_institution_invite: (a) => {
      const me = this.me().id;
      const role = this.roleOf(a.p_inst, me);
      if (!['admin', 'teacher', 'student'].includes(a.p_role)) throw new Raise('bad role');
      if (role === 'teacher') {
        if (a.p_role !== 'student' || !a.p_class || !this.classMembers.some((c) => c.class_id === a.p_class && c.user_id === me && c.role === 'teacher')) throw new Raise('not allowed');
      } else if (role !== 'admin') throw new Raise('not allowed');
      const i = this.inst(a.p_inst)!;
      if (i.status === 'rejected' || i.status === 'suspended') throw new Raise('institution not active');
      if (a.p_role === 'student' && !this.active(i)) throw new Raise('institution not active');
      if ((a.p_emails ?? []).length > 500) throw new Raise('too many');
      const out: { email: string; token: string | null; status: string }[] = [];
      for (const raw of a.p_emails ?? []) {
        const email = String(raw).trim().toLowerCase();
        if (!email) continue;
        if (!EMAIL.test(email)) {
          out.push({ email, token: null, status: 'invalid' });
          continue;
        }
        if (this.members.some((m) => m.institution_id === i.id && this.who(m.user_id).email === email)) {
          out.push({ email, token: null, status: 'member' });
          continue;
        }
        const open = this.invites.find((v) => v.institution_id === i.id && v.email === email && v.role === a.p_role && v.class_id === (a.p_class ?? null) && v.state === 'open');
        out.push({ email, token: (open ?? this.invite(i.id, email, a.p_role, a.p_class ?? null)).token, status: 'invited' });
      }
      return out;
    },

    study_invite_revoke: (a) => {
      const me = this.me().id;
      const v = this.invites.find((x) => x.token === a.p_token);
      const teaches = !!v?.class_id && this.classMembers.some((t) => t.class_id === v.class_id && t.user_id === me && t.role === 'teacher');
      if (!v || !(this.roleOf(v.institution_id, me) === 'admin' || teaches)) throw new Raise('not allowed');
      v.state = 'revoked';
      return null;
    },

    study_institution_invites_list: (a) => {
      const me = this.me().id;
      const role = this.roleOf(a.p_inst, me);
      if (role !== 'admin' && role !== 'teacher') throw new Raise('not allowed');
      return this.invites
        .filter((v) => v.institution_id === a.p_inst && v.state === 'open')
        .filter((v) => role === 'admin' || this.classMembers.some((t) => t.class_id === v.class_id && t.user_id === me && t.role === 'teacher'))
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((v) => ({
          email: v.email,
          role: v.role,
          token: v.token,
          class: this.classes.find((c) => c.id === v.class_id)?.name ?? null,
          class_id: v.class_id,
          created_at: v.created_at,
          expires_at: new Date(new Date(v.created_at).getTime() + 30 * 86_400_000).toISOString(),
        }));
    },

    study_invite_peek: (a) => {
      const v = this.invites.find((x) => x.token === a.p_token);
      if (!v) return { status: 'unknown' };
      return {
        status: v.state,
        institution: this.inst(v.institution_id)?.name,
        role: v.role,
        class: this.classes.find((c) => c.id === v.class_id)?.name ?? null,
        email_matches: v.email === this.me().email.toLowerCase(),
      };
    },

    study_invite_accept: (a) => {
      const me = this.me();
      const v = this.invites.find((x) => x.token === a.p_token);
      if (!v || v.state !== 'open') throw new Raise('invite not open');
      if (v.email !== me.email.toLowerCase()) throw new Raise('invite is for another email');
      const role = this.roleOf(v.institution_id, me.id);
      if (v.role === 'student') {
        if (role && role !== 'student') throw new Raise('already staff');
        this.addStudent(v.institution_id, me.id);
      } else if (!role) this.join(v.institution_id, me.id, v.role);
      else if (role === 'student' || (role === 'teacher' && v.role === 'admin')) this.members.find((m) => m.institution_id === v.institution_id && m.user_id === me.id)!.role = v.role;
      if (v.class_id && !this.classMembers.some((c) => c.class_id === v.class_id && c.user_id === me.id)) this.inClass(v.class_id, me.id, v.role === 'student' ? 'student' : 'teacher');
      v.state = 'used';
      return { institution_id: v.institution_id, name: this.inst(v.institution_id)!.name, role: this.roleOf(v.institution_id, me.id) };
    },

    study_institution_join_by_email: (a) => {
      const me = this.me();
      const i = this.inst(a.p_inst);
      if (!i || i.email_domain !== me.email.split('@')[1]) throw new Raise('not allowed');
      this.addStudent(i.id, me.id);
      return { institution_id: i.id, name: i.name };
    },

    study_class_create: (a) => {
      const me = this.me().id;
      const role = this.roleOf(a.p_inst, me);
      if (role !== 'admin' && role !== 'teacher') throw new Raise('not allowed');
      const i = this.inst(a.p_inst)!;
      if (i.status === 'rejected' || i.status === 'suspended') throw new Raise('institution not active');
      const c = this.klass(i.id, String(a.p_name).trim());
      if (role === 'teacher') this.inClass(c.id, me, 'teacher');
      return { id: c.id, name: c.name, code: c.code };
    },

    study_classes_list: (a) => {
      const me = this.me().id;
      const role = this.roleOf(a.p_inst, me);
      if (role !== 'admin' && role !== 'teacher') throw new Raise('not allowed');
      return this.classes
        .filter((c) => c.institution_id === a.p_inst && (role === 'admin' || this.classMembers.some((t) => t.class_id === c.id && t.user_id === me && t.role === 'teacher')))
        .sort((x, y) => Number(x.archived) - Number(y.archived) || x.name.localeCompare(y.name))
        .map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          archived: c.archived,
          created_at: c.created_at,
          teachers: this.classMembers.filter((t) => t.class_id === c.id && t.role === 'teacher').map((t) => ({ user_id: t.user_id, name: this.who(t.user_id).name })),
          students: this.classMembers.filter((t) => t.class_id === c.id && t.role === 'student').length,
        }));
    },

    study_class_update: (a) => {
      const c = this.classes.find((x) => x.id === a.p_class);
      const me = this.me().id;
      if (!c || !(this.roleOf(c.institution_id, me) === 'admin' || this.classMembers.some((t) => t.class_id === c.id && t.user_id === me && t.role === 'teacher'))) throw new Raise('not allowed');
      if (a.p_name && String(a.p_name).trim()) c.name = String(a.p_name).trim();
      if (typeof a.p_archived === 'boolean') c.archived = a.p_archived;
      return null;
    },

    study_class_member_set: (a) => {
      const c = this.classes.find((x) => x.id === a.p_class);
      const me = this.me().id;
      const admin = !!c && this.roleOf(c.institution_id, me) === 'admin';
      if (!c || !(admin || this.classMembers.some((t) => t.class_id === c.id && t.user_id === me && t.role === 'teacher'))) throw new Raise('not allowed');
      const theirs = this.roleOf(c.institution_id, a.p_user);
      if (!theirs) throw new Raise('not a member');
      this.classMembers = this.classMembers.filter((x) => !(x.class_id === c.id && x.user_id === a.p_user));
      if (a.p_role === null) return null;
      if (a.p_role === 'teacher' && (!admin || theirs === 'student')) throw new Raise('not allowed');
      if (a.p_role === 'student' && theirs !== 'student') throw new Raise('not allowed');
      this.inClass(c.id, a.p_user, a.p_role);
      return null;
    },

    study_class_peek: (a) => {
      const c = this.classes.find((x) => x.code === String(a.p_code ?? '').trim().toUpperCase() && !x.archived);
      if (!c) return { found: false };
      return { found: true, class: c.name, institution: this.inst(c.institution_id)!.name, active: this.active(this.inst(c.institution_id)), member: this.roleOf(c.institution_id, this.me().id) };
    },

    study_my_classes: () => {
      const me = this.me().id;
      return this.classMembers
        .filter((m) => m.user_id === me && m.role === 'student')
        .map((m) => this.classes.find((c) => c.id === m.class_id)!)
        .filter((c) => c && !c.archived && this.active(this.inst(c.institution_id)))
        .map((c) => ({ id: c.id, name: c.name, institution: this.inst(c.institution_id)!.name, help_level: c.help_level }))
        .sort((x, y) => x.institution.localeCompare(y.institution) || x.name.localeCompare(y.name));
    },

    study_class_join: (a) => {
      const me = this.me().id;
      const c = this.classes.find((x) => x.code === String(a.p_code).trim().toUpperCase() && !x.archived);
      if (!c) throw new Raise('no such class');
      const role = this.roleOf(c.institution_id, me);
      if (role && role !== 'student') throw new Raise('already staff');
      this.addStudent(c.institution_id, me);
      if (!this.classMembers.some((x) => x.class_id === c.id && x.user_id === me)) this.inClass(c.id, me, 'student');
      return { institution_id: c.institution_id, class: c.name, name: this.inst(c.institution_id)!.name };
    },

    study_institution_update: (a) => {
      if (this.roleOf(a.p_inst, this.me().id) !== 'admin') throw new Raise('not allowed');
      const i = this.inst(a.p_inst)!;
      if (a.p_name && String(a.p_name).trim()) i.name = String(a.p_name).trim();
      if (a.p_website !== null && a.p_website !== undefined) i.website = String(a.p_website).trim();
      if (a.p_contact_name !== null && a.p_contact_name !== undefined) i.contact_name = String(a.p_contact_name).trim();
      if (a.p_contact_role !== null && a.p_contact_role !== undefined) i.contact_role = String(a.p_contact_role).trim();
      if (a.p_domain_requested !== null && a.p_domain_requested !== undefined) i.domain_requested = String(a.p_domain_requested).trim().toLowerCase();
      return null;
    },

    study_institution_member_set: (a) => {
      if (this.roleOf(a.p_inst, this.me().id) !== 'admin') throw new Raise('not allowed');
      const m = this.members.find((x) => x.institution_id === a.p_inst && x.user_id === a.p_user);
      if (!m) throw new Raise('not a member');
      const admins = this.members.filter((x) => x.institution_id === a.p_inst && x.role === 'admin').length;
      if (m.role === 'admin' && a.p_role !== 'admin' && admins <= 1) throw new Raise('last admin');
      const inHere = (classId: string) => this.classes.find((c) => c.id === classId)?.institution_id === a.p_inst;
      if (a.p_role === null) {
        this.classMembers = this.classMembers.filter((x) => !(x.user_id === a.p_user && inHere(x.class_id)));
        this.members = this.members.filter((x) => x !== m);
        return null;
      }
      if (a.p_role === 'student' && m.role !== 'student' && this.studentsCount(a.p_inst) >= this.inst(a.p_inst)!.seats) throw new Raise('no seats left');
      m.role = a.p_role;
      for (const x of this.classMembers) if (x.user_id === a.p_user && inHere(x.class_id)) x.role = a.p_role === 'student' ? 'student' : 'teacher';
      return null;
    },

    study_institution_leave: (a) => {
      const me = this.me().id;
      const role = this.roleOf(a.p_inst, me);
      if (!role) throw new Raise('not a member');
      if (role === 'admin' && this.members.filter((x) => x.institution_id === a.p_inst && x.role === 'admin').length <= 1) throw new Raise('last admin');
      const inHere = (classId: string) => this.classes.find((c) => c.id === classId)?.institution_id === a.p_inst;
      this.classMembers = this.classMembers.filter((x) => !(x.user_id === me && inHere(x.class_id)));
      this.members = this.members.filter((x) => !(x.institution_id === a.p_inst && x.user_id === me));
      return null;
    },

    // ── 20261107180000_study_growth.sql ──────────────────────────────

    study_age_get: () => this.age.get(this.me().id) ?? null,

    study_age_confirm: (a) => {
      if (!['adult', 'guardian'].includes(a.p_answer)) throw new Raise('bad answer');
      this.age.set(this.me().id, a.p_answer);
      return null;
    },

    study_my_referral: () => {
      const me = this.me().id;
      const code = this.codeOf(me);
      const mine = this.referrals.filter((r) => r.referrer === me);
      const by = this.referrals.find((r) => r.user_id === me);
      return {
        code,
        rep: this.reps.get(me)?.name ?? null,
        invited: mine.length,
        active: mine.filter((r) => r.rewarded).length,
        weeks_this_year: Math.min(12, mine.filter((r) => r.rewarded).length),
        cap: 12,
        referred_by: by ? this.who(by.referrer).name : null,
        my_week: by ? (by.rewarded ? 'given' : 'waiting') : null,
        weeks: Array.from({ length: 8 }, (_, g) => ({ week: day(-6 - 7 * (7 - g)), joined: g === 7 ? mine.length : 0 })),
      };
    },

    study_referral_redeem: (a) => {
      const me = this.me().id;
      const code = String(a.p_code ?? '').trim().toUpperCase();
      const owner = [...this.codes.entries()].find(([, c]) => c === code)?.[0];
      if (!owner) throw new Raise('no such code');
      if (owner === me) throw new Raise('your own code');
      if (this.referrals.some((r) => r.user_id === me)) throw new Raise('already referred');
      if (this.oldAccount) throw new Raise('too late');
      this.referrals.push({ user_id: me, referrer: owner, rewarded: false, created_at: now() });
      return { referrer: this.who(owner).name };
    },

    study_staff_reps: () => {
      this.staffOrRaise();
      return [...this.reps.entries()].map(([user, r]) => {
        const theirs = this.referrals.filter((x) => x.referrer === user);
        return { user_id: user, name: r.name, code: this.codeOf(user), since: r.since, email: this.who(user).email, signups: theirs.length, signups_7d: theirs.length, signups_30d: theirs.length, active: theirs.filter((x) => x.rewarded).length };
      });
    },

    study_staff_set_rep: (a) => {
      this.staffOrRaise();
      const who = String(a.p_who ?? '').trim().toLowerCase();
      const person = [this.me(), ...this.people].find((p) => p.id === a.p_who || p.email.toLowerCase() === who);
      if (!person) throw new Raise('no such account');
      const name = String(a.p_name ?? '').trim();
      if (name) this.reps.set(person.id, { name, since: this.reps.get(person.id)?.since ?? now() });
      else this.reps.delete(person.id);
      return { user_id: person.id, code: this.codeOf(person.id) };
    },

    study_class_tutor_get: (a) => {
      const c = this.classes.find((x) => x.id === a.p_class);
      const me = this.me().id;
      if (!c || !(this.runs(c, me) || this.classMembers.some((m) => m.class_id === c.id && m.user_id === me))) throw new Raise('not allowed');
      return { id: c.id, name: c.name, institution: this.inst(c.institution_id)!.name, course_brief: c.course_brief, help_level: c.help_level, tutor_notes: c.tutor_notes };
    },

    study_class_tutor_set: (a) => {
      const c = this.classes.find((x) => x.id === a.p_class);
      if (!c || !this.runs(c, this.me().id)) throw new Raise('not allowed');
      c.course_brief = String(a.p_course_brief ?? '').trim();
      c.help_level = a.p_help_level ?? c.help_level;
      c.tutor_notes = String(a.p_tutor_notes ?? '').trim();
      return null;
    },

    study_class_themes_get: (a) => {
      const c = this.classes.find((x) => x.id === a.p_class);
      if (!c || !this.runs(c, this.me().id)) throw new Raise('not allowed');
      return this.themes.get(c.id) ?? null;
    },

    // ── 20261107190000_study_institution_invoices.sql ────────────────

    study_staff_invoice_create: (a) => {
      this.staffOrRaise();
      if (this.inst(a.p_inst)?.status !== 'approved') throw new Raise('institution not approved');
      const v: MockInvoice = {
        id: id('5'),
        institution_id: a.p_inst,
        ref: `kaivon-inv-${id('6').replace(/-/g, '').slice(0, 24)}`,
        label: String(a.p_label).trim(),
        seats: a.p_seats,
        months: a.p_months,
        currency: String(a.p_currency).toUpperCase() as 'USD' | 'NGN',
        amount: Math.round(Number(a.p_amount) * 100) / 100,
        status: 'open',
        created_at: now(),
        paid_at: null,
      };
      this.invoices.push(v);
      return v;
    },

    study_staff_invoice_void: (a) => {
      this.staffOrRaise();
      const v = this.invoices.find((x) => x.id === a.p_invoice && x.status === 'open');
      if (!v) throw new Raise('not open');
      v.status = 'void';
      return null;
    },

    study_institution_invoices: (a) => {
      if (this.roleOf(a.p_inst, this.me().id) !== 'admin' && !this.staff.has(this.me().id)) throw new Raise('not allowed');
      return this.invoices
        .filter((v) => v.institution_id === a.p_inst)
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map(({ id: vid, label, seats, months, currency, amount, status, created_at, paid_at }) => ({ id: vid, label, seats, months, currency, amount, status, created_at, paid_at }));
    },

    // ── 20261107200000_study_lti.sql ─────────────────────────────────

    study_lti_platform_set: (a) => {
      if (this.roleOf(a.p_inst, this.me().id) !== 'admin' && !this.staff.has(this.me().id)) throw new Raise('not allowed');
      if (!this.active(this.inst(a.p_inst))) throw new Raise('institution not active');
      for (const k of ['p_issuer', 'p_auth_url', 'p_jwks_url']) if (!/^https:\/\//.test(String(a[k]))) throw new Raise('new row violates check constraint');
      const issuer = String(a.p_issuer).trim().replace(/\/+$/, '');
      const same = this.platforms.find((p) => p.issuer === issuer && p.client_id === a.p_client_id && p.deployment_id === a.p_deployment_id);
      if (same && same.institution_id !== a.p_inst) throw new Raise('registered to another institution');
      if (same) Object.assign(same, { name: a.p_name, auth_url: a.p_auth_url, jwks_url: a.p_jwks_url });
      else this.platforms.push({ id: id('8'), institution_id: a.p_inst, name: String(a.p_name ?? '').trim(), issuer, client_id: a.p_client_id, deployment_id: a.p_deployment_id, auth_url: a.p_auth_url, jwks_url: a.p_jwks_url, created_at: now(), courses: 0 });
      return (same ?? this.platforms.at(-1)!).id;
    },

    study_lti_platforms: (a) => {
      if (this.roleOf(a.p_inst, this.me().id) !== 'admin' && !this.staff.has(this.me().id)) throw new Raise('not allowed');
      return this.platforms.filter((p) => p.institution_id === a.p_inst).map(({ institution_id: _i, ...p }) => p);
    },

    study_lti_platform_remove: (a) => {
      const p = this.platforms.find((x) => x.id === a.p_platform);
      if (!p || (this.roleOf(p.institution_id, this.me().id) !== 'admin' && !this.staff.has(this.me().id))) throw new Raise('not allowed');
      this.platforms = this.platforms.filter((x) => x !== p);
      return null;
    },

    study_lti_pending_peek: (a) => {
      const l = this.pending.find((x) => x.token === a.p_token);
      if (!l) return { found: false };
      const p = this.platforms.find((x) => x.id === l.platform_id)!;
      return { found: true, institution: this.inst(p.institution_id)!.name, platform: p.name, course: l.course, email: l.email, teacher: l.teacher };
    },

    study_lti_link: (a) => {
      const me = this.me().id;
      const l = this.pending.find((x) => x.token === a.p_token);
      if (!l) throw new Raise('link expired');
      if (l.owner && l.owner !== me) throw new Raise('linked to another account');
      const p = this.platforms.find((x) => x.id === l.platform_id)!;
      const instId = p.institution_id;
      if (!this.active(this.inst(instId))) throw new Raise('institution not active');
      if (!this.roleOf(instId, me)) {
        if (l.teacher) this.join(instId, me, 'teacher');
        else {
          this.addStudent(instId, me);
          this.members.find((m) => m.institution_id === instId && m.user_id === me)!.consented = false;
        }
      }
      let classId: string | null = null;
      if (l.course) {
        const c = this.classes.find((x) => x.institution_id === instId && x.name === l.course) ?? this.klass(instId, l.course);
        classId = c.id;
        if (!this.classMembers.some((m) => m.class_id === c.id && m.user_id === me)) this.inClass(c.id, me, this.roleOf(instId, me) === 'student' ? 'student' : 'teacher');
        p.courses = new Set([...this.classes.filter((x) => x.institution_id === instId).map((x) => x.id)]).size;
      }
      this.pending = this.pending.filter((x) => x !== l);
      return { institution_id: instId, role: this.roleOf(instId, me), class_id: classId };
    },

    study_consent_pending: () =>
      this.members.filter((m) => m.user_id === this.me().id && !m.consented).map((m) => ({ id: m.institution_id, name: this.inst(m.institution_id)!.name })),

    study_consent_accept: (a) => {
      const m = this.members.find((x) => x.institution_id === a.p_inst && x.user_id === this.me().id);
      if (m) m.consented = true;
      return null;
    },

    // ── 20261107220000_study_class_new_code.sql, 20261107235000_study_minors.sql ──

    study_class_new_code: (a) => {
      const c = this.classes.find((x) => x.id === a.p_class);
      if (!c || !this.runs(c, this.me().id)) throw new Raise('not allowed');
      c.code = this.newCode();
      return c.code;
    },

    study_institution_minors: (a) => {
      if (this.roleOf(a.p_inst, this.me().id) !== 'admin') throw new Raise('not allowed');
      const i = this.inst(a.p_inst)!;
      if (!a.p_minors_consent && i.kind === 'school') throw new Raise('schools need it');
      i.minors_consent = !!a.p_minors_consent;
      return null;
    },

    study_am_staff: () => this.staff.has(this.me().id),

    // ── 20261108010000_study_institution_price.sql ───────────────────

    study_institution_prices: () => ({
      GBP: { per_student_year: 36, min_students: 50 },
      USD: { per_student_year: 45, min_students: 50 },
      EUR: { per_student_year: 42, min_students: 50 },
      NGN: { per_student_year: 45000, min_students: 50 },
    }),

    study_staff_institutions: (a) => {
      this.staffOrRaise();
      return this.institutions
        .filter((i) => a.p_status === 'all' || i.status === a.p_status)
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((i) => ({
          ...this.details(i),
          contact_email: i.created_by === this.me().id ? this.me().email : 'registrar@lagosbay.edu.ng',
          students_estimate: i.students_estimate,
          students: this.studentsCount(i.id),
          reviewed_at: i.reviewed_at,
          minors_consent: i.minors_consent,
        }));
    },

    study_staff_review: (a) => {
      this.staffOrRaise();
      if (!['approved', 'rejected', 'suspended', 'pending'].includes(a.p_status)) throw new Raise('bad status');
      const domain = String(a.p_email_domain ?? '').trim().toLowerCase() || null;
      if (domain && PUBLIC.includes(domain)) throw new Raise('public email domain');
      const i = this.inst(a.p_inst);
      if (!i) throw new Raise('no such institution');
      if (domain && this.institutions.some((x) => x !== i && x.status === 'approved' && x.email_domain === domain)) throw new Raise('duplicate key value violates unique constraint "study_institutions_domain"');
      i.status = a.p_status;
      i.seats = a.p_seats ?? (a.p_status === 'approved' && i.seats === 0 ? 50 : i.seats);
      i.pilot_ends = a.p_pilot_days != null ? day(a.p_pilot_days) : a.p_status === 'approved' && !i.pilot_ends ? day(90) : i.pilot_ends;
      i.email_domain = a.p_clear_domain ? null : (domain ?? i.email_domain);
      i.plan = a.p_plan ?? i.plan;
      i.paid_until = a.p_paid_until ?? i.paid_until;
      i.review_note = a.p_note ?? i.review_note;
      i.reviewed_at = now();
      return null;
    },
  };
}
