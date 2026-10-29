import { supabase } from './supabase.ts';
import type {
  Assignment,
  Card,
  DocKind,
  FocusSession,
  LogEntry,
  Me,
  Message,
  Note,
  Practice,
  Source,
  SourceData,
  SourceKind,
  StudyDocument,
  Task,
  Thread,
} from './types.ts';

/** Everything Chip Study reads and writes, in one place. Rows are the student's own (row level
 * security); Chip's side comes from the chip-study function. */

class ApiError extends Error {}

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

export async function payStatus(): Promise<{ on: boolean; test: boolean }> {
  try {
    const { data, error } = await supabase.functions.invoke('web-pay', { body: { action: 'status' } });
    if (error || !data) return { on: false, test: false };
    return { on: !!data.on, test: !!data.test };
  } catch {
    return { on: false, test: false };
  }
}

/** Starts paying for Pro, or for the student plan (Pro at the student price, for a school email),
 * and answers the checkout link. */
export async function subscribePro(plan: 'pro' | 'student' = 'pro'): Promise<string> {
  const { data, error } = await supabase.functions.invoke('web-pay', {
    body: { action: 'subscribe', plan: plan === 'student' ? 'study.pro.student.monthly' : 'study.pro.monthly', currency: 'USD', app: 'study' },
  });
  const link = (data as { link?: string } | null)?.link;
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
  return link;
}

export async function confirmPayment(ref: string, transactionId: string): Promise<{ status: string; until: string | null }> {
  const { data, error } = await supabase.functions.invoke('web-pay', { body: { action: 'confirm', ref, transaction_id: transactionId } });
  if (error || !data) return { status: 'error', until: null };
  return { status: String(data.status), until: typeof data.until === 'string' ? data.until : null };
}

export async function cancelPro(): Promise<{ status: string; until: string | null }> {
  const { data, error } = await supabase.functions.invoke('web-pay', { body: { action: 'cancel', product: 'study_pro' } });
  if (error || !data) throw new ApiError('Couldn’t cancel just now. Try again.');
  return { status: String(data.status), until: typeof data.until === 'string' ? data.until : null };
}
