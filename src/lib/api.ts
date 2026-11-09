import { supabase } from './supabase.ts';
import type { Currency } from './currency.ts';
import { institutionError } from './institutions.ts';
import type { InstitutionPrices } from './institutionPrice.ts';
import type { ConfirmAnswer } from './payment.ts';
import type {
  Assignment,
  Card,
  DocKind,
  FocusSession,
  InstitutionDetails,
  InstitutionKind,
  InstitutionMember,
  InstitutionOverview,
  InstitutionRole,
  InstitutionStatus,
  InvitePeek,
  InviteResult,
  LogEntry,
  Me,
  Message,
  AgeAnswer,
  ClassPeek,
  ClassThemes,
  ClassTutor,
  HelpLevel,
  Invoice,
  LtiPending,
  LtiPlatform,
  MyClass,
  MyReferral,
  MyInstitution,
  Note,
  OpenInvite,
  Practice,
  Source,
  SourceData,
  SourceKind,
  StaffInstitution,
  StaffRep,
  StudentDetail,
  StudyClass,
  StudyDocument,
  SuggestedInstitution,
  Task,
  Thread,
} from './types.ts';

/** Everything Chip Study reads and writes, in one place. Rows are the student's own (row level
 * security); Chip's side comes from the chip-study function. */

/** A request that didn't work: [message] is for people, [raw] is what the server said. */
export class ApiError extends Error {
  constructor(
    message: string,
    public raw = '',
  ) {
    super(message);
  }
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) {
    console.warn(what, result.error.message);
    throw new ApiError(friendly(result.error.message, what));
  }
  return result.data;
}

function friendly(message: string, what: string): string {
  if (/fetch|network|Failed to fetch|Load failed/i.test(message)) return 'You seem to be offline. Try again in a moment.';
  if (/reading too long/.test(message)) return 'That reading is too long for your plan.';
  if (/readings limit/.test(message)) return 'That’s today’s readings. Try again tomorrow, or go Pro for more.';
  return `Couldn’t ${what} just now. Try again.`;
}

// ── You ───────────────────────────────────────────────────────────────

export async function getMe(): Promise<Me> {
  return check(await supabase.rpc('study_me'), 'load your account') as Me;
}

export async function forgetMe(): Promise<void> {
  check(await supabase.rpc('study_forget_me'), 'remove your study data');
}

// ── Assignments ───────────────────────────────────────────────────────

export async function listAssignments(): Promise<Assignment[]> {
  return check(
    await supabase.from('study_assignments').select('*').order('updated_at', { ascending: false }),
    'load your assignments',
  ) as Assignment[];
}

export async function getAssignment(id: string): Promise<Assignment | null> {
  return check(await supabase.from('study_assignments').select('*').eq('id', id).maybeSingle(), 'open that assignment') as Assignment | null;
}

export type NewAssignment = Pick<Assignment, 'title' | 'course' | 'brief' | 'rubric' | 'due_at' | 'word_target' | 'style' | 'color' | 'kind'>;

/** A new study space (something to learn, or an assignment) with its first document, and any
 * tasks to start with. */
export async function createAssignment(fields: NewAssignment, tasks: { title: string; due: string | null }[] = []): Promise<Assignment> {
  const a = check(await supabase.from('study_assignments').insert(fields).select('*').single(), 'make that') as Assignment;
  check(
    await supabase.from('study_documents').insert({ assignment_id: a.id, kind: 'doc', title: fields.kind === 'topic' ? 'My notes' : 'Draft' }).select('id').single(),
    'make its document',
  );
  if (tasks.length) await addTasks(a.id, tasks, 'chip');
  return a;
}

export async function updateAssignment(id: string, patch: Partial<Omit<NewAssignment, 'kind'> & Pick<Assignment, 'status'>>): Promise<Assignment> {
  return check(await supabase.from('study_assignments').update(patch).eq('id', id).select('*').single(), 'save that') as Assignment;
}

export async function deleteAssignment(id: string): Promise<void> {
  check(await supabase.from('study_assignments').delete().eq('id', id), 'delete that assignment');
}

// ── Documents ─────────────────────────────────────────────────────────

export async function listDocuments(assignmentId: string): Promise<StudyDocument[]> {
  return check(
    await supabase.from('study_documents').select('*').eq('assignment_id', assignmentId).order('sort').order('created_at'),
    'load your documents',
  ) as StudyDocument[];
}

export async function createDocument(assignmentId: string, kind: DocKind, title: string, sort: number, content: Record<string, unknown> = {}): Promise<StudyDocument> {
  return check(
    await supabase.from('study_documents').insert({ assignment_id: assignmentId, kind, title, sort, content }).select('*').single(),
    'add that',
  ) as StudyDocument;
}

export async function renameDocument(id: string, title: string): Promise<void> {
  check(await supabase.from('study_documents').update({ title }).eq('id', id), 'rename that');
}

export async function deleteDocument(id: string): Promise<void> {
  check(await supabase.from('study_documents').delete().eq('id', id), 'delete that');
}

export interface DocSnapshot {
  content: Record<string, unknown>;
  text: string;
  words: number;
  chipWords: number;
}

/** Saves over [version]: {ok, version}. Throws when it can't reach the server (autosave tries
 * again). */
export async function saveDocument(id: string, version: number, s: DocSnapshot): Promise<{ ok: boolean; version: number }> {
  const { data, error } = await supabase.rpc('study_save_doc', {
    p_doc: id,
    p_version: version,
    p_content: s.content,
    p_text: s.text,
    p_words: s.words,
    p_chip_words: s.chipWords,
    p_title: null,
  });
  if (error) throw new ApiError(error.message);
  const d = data as { ok: boolean; version: number };
  return { ok: !!d.ok, version: Number(d.version) };
}

// ── Tasks ─────────────────────────────────────────────────────────────

export async function listTasks(assignmentId?: string): Promise<Task[]> {
  let q = supabase.from('study_tasks').select('*');
  if (assignmentId) q = q.eq('assignment_id', assignmentId);
  return check(await q.order('sort').order('created_at'), 'load your tasks') as Task[];
}

export async function addTasks(assignmentId: string, tasks: { title: string; due: string | null }[], by: 'me' | 'chip' = 'me', from = 0): Promise<Task[]> {
  if (!tasks.length) return [];
  return check(
    await supabase
      .from('study_tasks')
      .insert(tasks.map((t, i) => ({ assignment_id: assignmentId, title: t.title, due_on: t.due, created_by: by, sort: from + i })))
      .select('*'),
    'add those tasks',
  ) as Task[];
}

export async function updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'due_on' | 'done' | 'sort'>>): Promise<Task> {
  return check(await supabase.from('study_tasks').update(patch).eq('id', id).select('*').single(), 'save that task') as Task;
}

export async function deleteTask(id: string): Promise<void> {
  check(await supabase.from('study_tasks').delete().eq('id', id), 'delete that task');
}

// ── Sources and notes ─────────────────────────────────────────────────

export async function listSources(assignmentId: string): Promise<Source[]> {
  return check(await supabase.from('study_sources').select('*').eq('assignment_id', assignmentId).order('created_at'), 'load your sources') as Source[];
}

export async function addSource(
  assignmentId: string,
  s: { kind: SourceKind; data: SourceData; note?: string; content?: string; file_name?: string | null; created_by?: 'me' | 'chip' },
): Promise<Source> {
  return check(
    await supabase
      .from('study_sources')
      .insert({ assignment_id: assignmentId, kind: s.kind, data: s.data, note: s.note ?? '', content: s.content ?? '', file_name: s.file_name ?? null, created_by: s.created_by ?? 'me' })
      .select('*')
      .single(),
    'add that source',
  ) as Source;
}

export async function updateSource(id: string, patch: Partial<Pick<Source, 'kind' | 'data' | 'note'>>): Promise<Source> {
  return check(await supabase.from('study_sources').update(patch).eq('id', id).select('*').single(), 'save that source') as Source;
}

export async function deleteSource(id: string): Promise<void> {
  check(await supabase.from('study_sources').delete().eq('id', id), 'delete that source');
}

export async function listNotes(assignmentId: string): Promise<Note[]> {
  return check(await supabase.from('study_notes').select('*').eq('assignment_id', assignmentId).order('created_at', { ascending: false }), 'load your notes') as Note[];
}

export async function addNote(assignmentId: string, body: string): Promise<Note> {
  return check(await supabase.from('study_notes').insert({ assignment_id: assignmentId, body }).select('*').single(), 'add that note') as Note;
}

export async function updateNote(id: string, patch: Partial<Pick<Note, 'body' | 'pinned'>>): Promise<void> {
  check(await supabase.from('study_notes').update(patch).eq('id', id), 'save that note');
}

export async function deleteNote(id: string): Promise<void> {
  check(await supabase.from('study_notes').delete().eq('id', id), 'delete that note');
}

// ── Focus ─────────────────────────────────────────────────────────────

export async function addFocus(minutes: number, assignmentId: string | null, startedAt: Date): Promise<void> {
  check(
    await supabase.from('study_focus').insert({ minutes, assignment_id: assignmentId, started_at: startedAt.toISOString() }),
    'keep that focus session',
  );
}

export async function listFocusSince(since: Date): Promise<FocusSession[]> {
  return check(
    await supabase.from('study_focus').select('id, assignment_id, started_at, minutes').gte('started_at', since.toISOString()).order('started_at'),
    'load your focus time',
  ) as FocusSession[];
}

// ── The review deck and practice ──────────────────────────────────────

export async function listCards(): Promise<Card[]> {
  return check(await supabase.from('study_cards').select('*').order('due_at'), 'load your review deck') as Card[];
}

/** Cards due now (just enough to count them). */
export async function listDueCards(): Promise<Pick<Card, 'id' | 'due_at'>[]> {
  return check(await supabase.from('study_cards').select('id, due_at').lte('due_at', new Date().toISOString()), 'load your review deck') as Pick<Card, 'id' | 'due_at'>[];
}

export async function addCards(cards: { front: string; back: string }[], assignmentId: string | null, by: 'me' | 'chip'): Promise<Card[]> {
  if (!cards.length) return [];
  return check(
    await supabase
      .from('study_cards')
      .insert(cards.map((c) => ({ front: c.front.slice(0, 600), back: c.back.slice(0, 2000), assignment_id: assignmentId, created_by: by })))
      .select('*'),
    'save those cards',
  ) as Card[];
}

export async function updateCard(id: string, patch: Partial<Pick<Card, 'front' | 'back' | 'ease' | 'interval_days' | 'reps' | 'lapses' | 'due_at' | 'reviewed_at'>>): Promise<void> {
  check(await supabase.from('study_cards').update(patch).eq('id', id), 'save that card');
}

export async function deleteCard(id: string): Promise<void> {
  check(await supabase.from('study_cards').delete().eq('id', id), 'delete that card');
}

export async function addPractice(kind: 'quiz' | 'review', correct: number, total: number, assignmentId: string | null): Promise<void> {
  check(await supabase.from('study_practice').insert({ kind, correct, total, assignment_id: assignmentId }), 'keep that result');
}

export async function listPracticeSince(since: Date): Promise<Practice[]> {
  return check(await supabase.from('study_practice').select('*').gte('at', since.toISOString()).order('at'), 'load your practice') as Practice[];
}

// ── Chip's side ───────────────────────────────────────────────────────

export async function listThreads(assignmentId: string): Promise<Thread[]> {
  return check(
    await supabase.from('study_threads').select('*').eq('assignment_id', assignmentId).order('updated_at', { ascending: false }),
    'load your chats',
  ) as Thread[];
}

export async function listMessages(threadId: string): Promise<Message[]> {
  return check(
    await supabase.from('study_messages').select('*').eq('thread_id', threadId).order('created_at'),
    'load that chat',
  ) as Message[];
}

export async function deleteThread(id: string): Promise<void> {
  check(await supabase.from('study_threads').delete().eq('id', id), 'clear that chat');
}

export async function listLog(assignmentId: string): Promise<LogEntry[]> {
  return check(await supabase.from('study_ai_log').select('*').eq('assignment_id', assignmentId).order('at'), 'load the AI-use record') as LogEntry[];
}

export async function logUse(
  assignmentId: string,
  action: 'inserted' | 'replaced' | 'added_tasks' | 'added_sources',
  messageId: string | null,
  words: number,
  excerpt: string,
): Promise<void> {
  check(
    await supabase.rpc('study_log_use', { p_assignment: assignmentId, p_action: action, p_message: messageId, p_words: words, p_excerpt: excerpt.slice(0, 4000) }),
    'note that in your record',
  );
}

// ── Payments (the web-pay function, Flutterwave) ──────────────────────

/** Whether Pro can be bought (live Flutterwave keys), and whether the keys are test ones. */
export interface PayStatus {
  on: boolean;
  test: boolean;
}

/** The longest the check for whether Pro can be bought takes: no answer by then counts as not open
 * yet, so the plan page never waits on it for long. */
export const PAY_WAIT = 4500;

let payAsked: Promise<PayStatus> | null = null;
let payKnown: PayStatus | null = null;

/** Whether Pro can be bought, asked once a session (as the app opens, so the plan page has it
 * ready) and kept. A check that failed or ran out of time counts as not open, and is asked again
 * the next time. */
export function payStatus(): Promise<PayStatus> {
  payAsked ??= askPayStatus().then((status) => {
    if (status) {
      payKnown = status;
      return status;
    }
    payAsked = null;
    return { on: false, test: false };
  });
  return payAsked;
}

/** payStatus's answer once it's in, to show straight away rather than wait a moment for it. */
export function knownPayStatus(): PayStatus | null {
  return payKnown;
}

async function askPayStatus(): Promise<PayStatus | null> {
  try {
    const { data, error } = await supabase.functions.invoke('web-pay', { body: { action: 'status' }, timeout: PAY_WAIT });
    if (error || !data) return null;
    return { on: !!data.on, test: !!data.test };
  } catch {
    return null;
  }
}

/** Starts paying for Pro, or for the student plan (Pro at the student price, for a school email),
 * in [currency], the one its price was shown in, and answers the checkout link and the payment's
 * reference. */
export async function subscribePro(plan: 'pro' | 'student', currency: Currency): Promise<{ link: string; ref: string }> {
  const { data, error } = await supabase.functions.invoke('web-pay', {
    body: { action: 'subscribe', plan: plan === 'student' ? 'study.pro.student.monthly' : 'study.pro.monthly', currency, app: 'study' },
  });
  const link = (data as { link?: string } | null)?.link;
  const ref = String((data as { ref?: string } | null)?.ref ?? '');
  if (error || !link || !link.startsWith('https://')) {
    let why = '';
    try {
      why = (await (error as { context?: Response })?.context?.json())?.error ?? '';
    } catch {
      // No reason given.
    }
    throw new ApiError(
      why === 'member'
        ? 'You’re already on Pro.'
        : why === 'off'
          ? 'Pro isn’t open yet.'
          : why === 'account'
            ? 'Save your account first.'
            : why === 'school'
              ? 'The student price is for an account made with a school email.'
              : 'Couldn’t start the payment. Try again.',
    );
  }
  return { link, ref };
}

/** Back from checkout: web-pay asks Flutterwave about the payment (and pays it out, once). A call
 * that didn't get through is "unreachable"; one refused for want of a sign-in is "signin". */
export async function confirmPayment(ref: string, transactionId: string): Promise<ConfirmAnswer> {
  try {
    const { data, error } = await supabase.functions.invoke('web-pay', { body: { action: 'confirm', ref, transaction_id: transactionId } });
    if (error || !data) {
      const status = (error as { context?: Response } | null)?.context?.status;
      return { status: status === 401 ? 'signin' : 'unreachable', until: null };
    }
    const d = data as { status?: unknown; until?: unknown; amount?: unknown; currency?: unknown };
    return {
      status: String(d.status ?? 'unknown'),
      until: typeof d.until === 'string' ? d.until : null,
      amount: typeof d.amount === 'number' || typeof d.amount === 'string' ? Number(d.amount) : null,
      currency: typeof d.currency === 'string' ? d.currency : null,
    };
  } catch {
    return { status: 'unreachable', until: null };
  }
}

export async function cancelPro(): Promise<{ status: string; until: string | null }> {
  const { data, error } = await supabase.functions.invoke('web-pay', { body: { action: 'cancel', product: 'study_pro' } });
  if (error || !data) throw new ApiError('Couldn’t cancel just now. Try again.');
  return { status: String(data.status), until: typeof data.until === 'string' ? data.until : null };
}

// ── Institutions ──────────────────────────────────────────────────────
// Schools, colleges and universities. Everything goes through the study_institution* and
// study_class* functions (the tables can't be read directly), and their errors are sentences.

function inst<T>(result: { data: unknown; error: { message: string } | null }, fallback: string): T {
  if (result.error) {
    console.warn(fallback, result.error.message);
    throw new ApiError(institutionError(result.error.message, fallback), result.error.message);
  }
  return result.data as T;
}

/** Whether [e] is the server saying this account may not do that. */
export function notAllowed(e: unknown): boolean {
  return e instanceof ApiError && /not allowed/.test(e.raw);
}

export async function myInstitutions(): Promise<{ mine: MyInstitution[]; suggested: SuggestedInstitution[] }> {
  const d = inst<{ mine?: MyInstitution[]; suggested?: SuggestedInstitution[] } | null>(await supabase.rpc('study_my_institutions'), 'Couldn’t load your institutions just now.');
  return { mine: d?.mine ?? [], suggested: d?.suggested ?? [] };
}

export interface NewInstitution {
  name: string;
  country: string;
  kind: InstitutionKind;
  website: string;
  domain: string;
  contactName: string;
  contactRole: string;
  students: number | null;
  /** Students under 18 will join, and it has their parents' or guardians' consent (a school must). */
  minorsConsent: boolean;
}

/** Registers an institution (it waits for Kaivon to check it), with you as its first admin. */
export async function registerInstitution(f: NewInstitution): Promise<string> {
  return inst<string>(
    await supabase.rpc('study_institution_register', {
      p_name: f.name,
      p_country: f.country,
      p_kind: f.kind,
      p_website: f.website,
      p_email_domain: f.domain,
      p_contact_name: f.contactName,
      p_contact_role: f.contactRole,
      p_students_estimate: f.students,
      p_minors_consent: f.minorsConsent,
    }),
    'Couldn’t send that just now. Try again.',
  );
}

export async function institutionOverview(id: string): Promise<InstitutionOverview> {
  return inst<InstitutionOverview>(await supabase.rpc('study_institution_overview', { p_inst: id }), 'Couldn’t load this institution just now.');
}

export async function institutionMembers(id: string, classId: string | null = null): Promise<InstitutionMember[]> {
  const rows = inst<InstitutionMember[] | null>(await supabase.rpc('study_institution_students', { p_inst: id, p_class: classId }), 'Couldn’t load the students just now.');
  return (rows ?? []).map((r) => ({ ...r, classes: r.classes ?? [] }));
}

export async function institutionStudent(id: string, userId: string): Promise<StudentDetail> {
  const d = inst<StudentDetail>(await supabase.rpc('study_institution_student', { p_inst: id, p_user: userId }), 'Couldn’t load that student just now.');
  return { student: d?.student ?? null, assignments: d?.assignments ?? [] };
}

/** Invite links for [emails] (up to 500 at a time): each email's link, or why there isn't one. */
export async function inviteToInstitution(id: string, emails: string[], role: InstitutionRole, classId: string | null): Promise<InviteResult[]> {
  return (
    inst<InviteResult[] | null>(
      await supabase.rpc('study_institution_invite', { p_inst: id, p_emails: emails, p_role: role, p_class: classId }),
      'Couldn’t make those links just now. Try again.',
    ) ?? []
  );
}

/** The invite links still waiting to be used: all of them for an admin, a teacher's own classes'. */
export async function openInvites(id: string): Promise<OpenInvite[]> {
  return inst<OpenInvite[] | null>(await supabase.rpc('study_institution_invites_list', { p_inst: id }), 'Couldn’t load the invites just now.') ?? [];
}

export async function revokeInvite(token: string): Promise<void> {
  inst(await supabase.rpc('study_invite_revoke', { p_token: token }), 'Couldn’t cancel that link just now.');
}

export async function peekInvite(token: string): Promise<InvitePeek> {
  return inst<InvitePeek>(await supabase.rpc('study_invite_peek', { p_token: token }), 'Couldn’t open that invite just now.');
}

export async function acceptInvite(token: string): Promise<{ institution_id: string; name: string; role: InstitutionRole }> {
  return inst(await supabase.rpc('study_invite_accept', { p_token: token }), 'Couldn’t join just now. Try again.');
}

/** Joins as a student by school email, once Kaivon has confirmed the institution's domain. */
export async function joinByEmail(id: string): Promise<{ institution_id: string; name: string }> {
  return inst(await supabase.rpc('study_institution_join_by_email', { p_inst: id }), 'Couldn’t join just now. Try again.');
}

export async function createClass(id: string, name: string): Promise<{ id: string; name: string; code: string }> {
  return inst(await supabase.rpc('study_class_create', { p_inst: id, p_name: name }), 'Couldn’t make that class just now.');
}

export async function listClasses(id: string): Promise<StudyClass[]> {
  const rows = inst<StudyClass[] | null>(await supabase.rpc('study_classes_list', { p_inst: id }), 'Couldn’t load the classes just now.');
  return (rows ?? []).map((c) => ({ ...c, teachers: c.teachers ?? [], students: Number(c.students ?? 0) }));
}

export async function updateClass(classId: string, patch: { name?: string; archived?: boolean }): Promise<void> {
  inst(await supabase.rpc('study_class_update', { p_class: classId, p_name: patch.name ?? null, p_archived: patch.archived ?? null }), 'Couldn’t save that class just now.');
}

/** Puts [userId] in a class as a teacher or a student, or takes them out (null). */
export async function setClassMember(classId: string, userId: string, role: 'teacher' | 'student' | null): Promise<void> {
  inst(await supabase.rpc('study_class_member_set', { p_class: classId, p_user: userId, p_role: role }), 'Couldn’t change that class just now.');
}

/** What a class code is (its class and institution), before joining it. */
export async function peekClass(code: string): Promise<ClassPeek> {
  return inst<ClassPeek>(await supabase.rpc('study_class_peek', { p_code: code }), 'Couldn’t check that code just now.');
}

/** The classes you study in (at active institutions). */
export async function myClasses(): Promise<MyClass[]> {
  return inst<MyClass[] | null>(await supabase.rpc('study_my_classes'), 'Couldn’t load your classes just now.') ?? [];
}

/** Joins a class (and its institution, as a student) with its code. */
export async function joinClass(code: string): Promise<{ institution_id: string; class: string; name: string }> {
  return inst(await supabase.rpc('study_class_join', { p_code: code }), 'Couldn’t join that class just now.');
}

export async function updateInstitution(
  id: string,
  patch: Partial<Pick<InstitutionDetails, 'name' | 'website' | 'contact_name' | 'contact_role' | 'domain_requested'>>,
): Promise<void> {
  inst(
    await supabase.rpc('study_institution_update', {
      p_inst: id,
      p_name: patch.name ?? null,
      p_website: patch.website ?? null,
      p_contact_name: patch.contact_name ?? null,
      p_contact_role: patch.contact_role ?? null,
      p_domain_requested: patch.domain_requested ?? null,
    }),
    'Couldn’t save that just now.',
  );
}

/** Changes a member's role, or takes them out of the institution (null). */
export async function setInstitutionMember(id: string, userId: string, role: InstitutionRole | null): Promise<void> {
  inst(await supabase.rpc('study_institution_member_set', { p_inst: id, p_user: userId, p_role: role }), 'Couldn’t change that just now.');
}

export async function leaveInstitution(id: string): Promise<void> {
  inst(await supabase.rpc('study_institution_leave', { p_inst: id }), 'Couldn’t leave just now. Try again.');
}

// Kaivon's review of institutions (staff only: everyone else is told 'not allowed').

/** Whether this account is Kaivon staff. */
export async function amStaff(): Promise<boolean> {
  return !!inst<boolean>(await supabase.rpc('study_am_staff'), 'Couldn’t check that just now.');
}

export async function staffInstitutions(status: InstitutionStatus | 'all'): Promise<StaffInstitution[]> {
  return inst<StaffInstitution[] | null>(await supabase.rpc('study_staff_institutions', { p_status: status }), 'Couldn’t load the institutions just now.') ?? [];
}

export interface Review {
  status: 'approved' | 'rejected' | 'suspended' | 'pending';
  seats?: number | null;
  pilotDays?: number | null;
  emailDomain?: string | null;
  note?: string | null;
  plan?: 'pilot' | 'paid' | null;
  paidUntil?: string | null;
  /** Takes the confirmed email domain away. */
  clearDomain?: boolean;
}

export async function staffReview(id: string, r: Review): Promise<void> {
  inst(
    await supabase.rpc('study_staff_review', {
      p_inst: id,
      p_status: r.status,
      p_seats: r.seats ?? null,
      p_pilot_days: r.pilotDays ?? null,
      p_email_domain: r.emailDomain ?? null,
      p_note: r.note ?? null,
      p_plan: r.plan ?? null,
      p_paid_until: r.paidUntil ?? null,
      p_clear_domain: !!r.clearDomain,
    }),
    'Couldn’t save that review just now.',
  );
}

// ── The age rule ──────────────────────────────────────────────────────

/** What this account said about its age, or null if it hasn't been asked. */
export async function ageGet(): Promise<AgeAnswer | null> {
  return inst<AgeAnswer | null>(await supabase.rpc('study_age_get'), 'Couldn’t load your account just now.') ?? null;
}

export async function ageConfirm(answer: AgeAnswer): Promise<void> {
  inst(await supabase.rpc('study_age_confirm', { p_answer: answer }), 'Couldn’t save that just now. Try again.');
}

/** An admin says whether students under 18 will join (with their parents' or guardians' consent). */
export async function setInstitutionMinors(id: string, minors: boolean): Promise<void> {
  inst(await supabase.rpc('study_institution_minors', { p_inst: id, p_minors_consent: minors }), 'Couldn’t save that just now.');
}

// ── Invite a friend, and campus reps ──────────────────────────────────

export async function myReferral(): Promise<MyReferral> {
  return inst<MyReferral>(await supabase.rpc('study_my_referral'), 'Couldn’t load your invite link just now.');
}

/** Says who brought this new account; answers the friend's name. */
export async function redeemReferral(code: string): Promise<{ referrer: string }> {
  return inst(await supabase.rpc('study_referral_redeem', { p_code: code }), 'Couldn’t use that invite code just now.');
}

export async function staffReps(): Promise<StaffRep[]> {
  return inst<StaffRep[] | null>(await supabase.rpc('study_staff_reps'), 'Couldn’t load the campus reps just now.') ?? [];
}

/** Makes someone a campus rep (by email, username or ID), or stops it (an empty name). */
export async function staffSetRep(who: string, name: string): Promise<{ user_id: string; code: string }> {
  return inst(await supabase.rpc('study_staff_set_rep', { p_who: who, p_name: name }), 'Couldn’t save that rep just now.');
}

// ── Course tutors and class themes ────────────────────────────────────

export async function classTutorGet(classId: string): Promise<ClassTutor> {
  return inst<ClassTutor>(await supabase.rpc('study_class_tutor_get', { p_class: classId }), 'Couldn’t load the course tutor just now.');
}

export async function classTutorSet(classId: string, t: { course_brief: string; help_level: HelpLevel; tutor_notes: string }): Promise<void> {
  inst(
    await supabase.rpc('study_class_tutor_set', { p_class: classId, p_course_brief: t.course_brief, p_help_level: t.help_level, p_tutor_notes: t.tutor_notes }),
    'Couldn’t save the course tutor just now.',
  );
}

/** Links your assignment to a class you study in, or unlinks it (null). */
export async function setAssignmentClass(assignmentId: string, classId: string | null): Promise<void> {
  inst(await supabase.rpc('study_assignment_set_class', { p_assignment: assignmentId, p_class: classId }), 'Couldn’t link that just now.');
}

/** The class's themes as last made, or null if they never have been. */
export async function classThemesGet(classId: string): Promise<ClassThemes | null> {
  return inst<ClassThemes | null>(await supabase.rpc('study_class_themes_get', { p_class: classId }), 'Couldn’t load the class’s themes just now.') ?? null;
}

/** A class gets a new code (the old one stops working); answers it. */
export async function classNewCode(classId: string): Promise<string> {
  return inst<string>(await supabase.rpc('study_class_new_code', { p_class: classId }), 'Couldn’t make a new code just now.');
}

// ── Invoices ──────────────────────────────────────────────────────────

export async function institutionInvoices(id: string): Promise<Invoice[]> {
  const rows = inst<Invoice[] | null>(await supabase.rpc('study_institution_invoices', { p_inst: id }), 'Couldn’t load the invoices just now.') ?? [];
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export async function staffInvoiceCreate(id: string, f: { label: string; seats: number; months: number; currency: Currency; amount: number }): Promise<Invoice> {
  return inst(
    await supabase.rpc('study_staff_invoice_create', { p_inst: id, p_label: f.label, p_seats: f.seats, p_months: f.months, p_currency: f.currency, p_amount: f.amount }),
    'Couldn’t make that invoice just now.',
  );
}

export async function staffInvoiceVoid(invoiceId: string): Promise<void> {
  inst(await supabase.rpc('study_staff_invoice_void', { p_invoice: invoiceId }), 'Couldn’t cancel that invoice just now.');
}

/** Starts paying an invoice (an admin of its institution), in the currency it was issued in:
 * answers the checkout link and the payment's reference. */
export async function payInvoice(invoiceId: string): Promise<{ link: string; ref: string }> {
  const { data, error } = await supabase.functions.invoke('web-pay', { body: { action: 'invoice', invoice_id: invoiceId } });
  const link = (data as { link?: string } | null)?.link;
  const ref = String((data as { ref?: string } | null)?.ref ?? '');
  if (error || !link || !link.startsWith('https://')) {
    let why = '';
    try {
      why = (await (error as { context?: Response })?.context?.json())?.error ?? '';
    } catch {
      // No reason given.
    }
    throw new ApiError(
      why === 'paid' ? 'That invoice is already paid or cancelled.' : why === 'off' ? 'Payments aren’t open yet. Write to support@kaivon.app.' : why === 'account' ? 'Your account needs an email to pay.' : 'Couldn’t start the payment. Try again.',
      why,
    );
  }
  return { link, ref };
}

// ── Learning platforms (LTI 1.3) ──────────────────────────────────────

export async function ltiPlatforms(id: string): Promise<LtiPlatform[]> {
  return inst<LtiPlatform[] | null>(await supabase.rpc('study_lti_platforms', { p_inst: id }), 'Couldn’t load your learning platforms just now.') ?? [];
}

export async function ltiPlatformSet(
  id: string,
  p: { name: string; issuer: string; client_id: string; deployment_id: string; auth_url: string; jwks_url: string },
): Promise<string> {
  return inst<string>(
    await supabase.rpc('study_lti_platform_set', {
      p_inst: id,
      p_name: p.name,
      p_issuer: p.issuer,
      p_client_id: p.client_id,
      p_deployment_id: p.deployment_id,
      p_auth_url: p.auth_url,
      p_jwks_url: p.jwks_url,
    }),
    'Couldn’t save that platform just now.',
  );
}

export async function ltiPlatformRemove(platformId: string): Promise<void> {
  inst(await supabase.rpc('study_lti_platform_remove', { p_platform: platformId }), 'Couldn’t remove that platform just now.');
}

/** What a launch waiting to be linked is for (works before signing in). */
export async function ltiPendingPeek(token: string): Promise<LtiPending> {
  return inst<LtiPending>(await supabase.rpc('study_lti_pending_peek', { p_token: token }), 'Couldn’t open that just now.') ?? { found: false };
}

/** Links a waiting launch to the signed-in account, and joins its institution and class. */
export async function ltiLink(token: string): Promise<{ institution_id: string; role: InstitutionRole; class_id: string | null }> {
  return inst(await supabase.rpc('study_lti_link', { p_token: token }), 'Couldn’t link your course just now.');
}

/** Institutions whose privacy terms you haven't seen yet (joined from a learning platform). */
export async function consentPending(): Promise<{ id: string; name: string }[]> {
  return inst<{ id: string; name: string }[] | null>(await supabase.rpc('study_consent_pending'), 'Couldn’t load that just now.') ?? [];
}

export async function consentAccept(id: string): Promise<void> {
  inst(await supabase.rpc('study_consent_accept', { p_inst: id }), 'Couldn’t save that just now.');
}

// ── The price for institutions ────────────────────────────────────────

/** Per student per year in each currency, and the fewest students it's for (anyone may ask). */
export async function institutionPrices(): Promise<InstitutionPrices> {
  return inst<InstitutionPrices | null>(await supabase.rpc('study_institution_prices'), 'Couldn’t load the price just now.') ?? {};
}
