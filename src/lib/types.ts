/** The rows Chip Study keeps (Utopia's Supabase project, the study_* tables). */

export type Color = 'sky' | 'lilac' | 'mint' | 'peach' | 'rose' | 'sand';
export type Style = 'apa' | 'harvard';
export type Mode = 'guide' | 'explain' | 'plan' | 'write' | 'check' | 'cite' | 'quiz';
export type ModelKind = 'best' | 'fast';

export interface Assignment {
  id: string;
  user_id: string;
  title: string;
  course: string;
  brief: string;
  rubric: string;
  due_at: string | null;
  word_target: number | null;
  style: Style;
  status: 'active' | 'submitted' | 'archived';
  color: Color;
  /** Something the student is learning, or an assignment to hand in. */
  kind: 'topic' | 'assignment';
  words: number;
  focus_minutes: number;
  created_at: string;
  updated_at: string;
}

export type DocKind = 'doc' | 'code' | 'sheet';

export interface StudyDocument {
  id: string;
  assignment_id: string;
  user_id: string;
  kind: DocKind;
  title: string;
  content: Record<string, unknown>;
  text: string;
  words: number;
  chip_words: number;
  version: number;
  sort: number;
  created_at: string;
  updated_at: string;
}

export type SourceKind = 'book' | 'chapter' | 'article' | 'web' | 'report' | 'video' | 'other';

export interface SourceData {
  authors?: string[];
  year?: string;
  title?: string;
  container?: string;
  publisher?: string;
  place?: string;
  edition?: string;
  editors?: string[];
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  accessed?: string;
}

export interface Source {
  id: string;
  assignment_id: string;
  kind: SourceKind;
  data: SourceData;
  note: string;
  content: string;
  file_name: string | null;
  created_by: 'me' | 'chip';
  created_at: string;
}

export interface Note {
  id: string;
  assignment_id: string;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  assignment_id: string;
  title: string;
  due_on: string | null;
  done: boolean;
  done_at: string | null;
  sort: number;
  created_by: 'me' | 'chip';
  created_at: string;
}

export interface FocusSession {
  id: string;
  assignment_id: string | null;
  started_at: string;
  minutes: number;
}

export interface Thread {
  id: string;
  assignment_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: 'user' | 'chip';
  mode: Mode;
  content: string;
  meta: { selection?: string; files?: string[]; model?: string; kind?: ModelKind; stopped?: boolean; cut?: boolean; searches?: number };
  created_at: string;
}

export type LogAction =
  | Mode
  | 'setup'
  | 'inserted'
  | 'replaced'
  | 'added_tasks'
  | 'added_sources';

export interface LogEntry {
  id: string;
  assignment_id: string;
  message_id: string | null;
  at: string;
  action: LogAction;
  summary: string;
  prompt: string;
  output: string;
  words: number;
  model: string;
}

export interface Card {
  id: string;
  assignment_id: string | null;
  front: string;
  back: string;
  created_by: 'me' | 'chip';
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due_at: string;
  reviewed_at: string | null;
  created_at: string;
}

export interface Practice {
  id: string;
  assignment_id: string | null;
  kind: 'quiz' | 'review';
  correct: number;
  total: number;
  at: string;
}

export interface Meter {
  used: number;
  cap: number;
  avg: number;
}

export interface Me {
  tier: 'free' | 'pro' | 'guest';
  /** Which Pro: full Pro, or the student plan (Pro at the student price). Null without Pro.
   * This and the student fields are missing from a server older than the student plan. */
  plan?: 'pro' | 'student' | null;
  name: string | null;
  pro_until: string | null;
  resets_at: string;
  fast: Meter;
  best: (Meter & { period_used: number; period_cap: number }) | null;
  uploads: { used: number; cap: number; max_mb: number };
  readings: { used: number; cap: number; max_chars: number };
  price: { amount: number; currency: string } | null;
  /** Whether this account's email is a school's (confirmed), which gets the student price. */
  student?: { eligible: boolean; domain: string | null };
  student_price?: { amount: number; currency: string } | null;
  /** Each plan's price in every currency it has one in. */
  prices?: Record<string, number> | null;
  student_prices?: Record<string, number> | null;
}

// ── Institutions (schools, colleges and universities) ────────────────────

export type InstitutionKind = 'university' | 'college' | 'school' | 'other';
export type InstitutionStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type InstitutionRole = 'admin' | 'teacher' | 'student';
export type InstitutionPlan = 'pilot' | 'paid';

/** An institution you're in (study_my_institutions().mine). */
export interface MyInstitution {
  id: string;
  name: string;
  kind: InstitutionKind;
  country: string;
  status: InstitutionStatus;
  role: InstitutionRole;
  plan: InstitutionPlan;
  /** Approved, and inside its pilot or paid period: its students have Pro. */
  active: boolean;
  seats: number;
  students: number;
  pilot_ends: string | null;
  paid_until: string | null;
  joined_at: string;
}

/** An active institution whose confirmed email domain is yours, that you aren't in yet. */
export interface SuggestedInstitution {
  id: string;
  name: string;
  kind: InstitutionKind;
  country: string;
}

export interface InstitutionDetails {
  id: string;
  name: string;
  kind: InstitutionKind;
  country: string;
  website: string;
  status: InstitutionStatus;
  plan: InstitutionPlan;
  active: boolean;
  seats: number;
  pilot_ends: string | null;
  paid_until: string | null;
  /** Set by Kaivon at review: anyone with this email domain can join as a student. */
  email_domain: string | null;
  domain_requested: string;
  contact_name: string;
  contact_role: string;
  review_note: string;
  created_at: string;
}

export interface InstitutionOverview {
  role: 'admin' | 'teacher';
  institution: InstitutionDetails;
  counts: { students: number; visible_students: number; teachers: number; admins: number; classes: number; invites_open: number };
  /** The last seven days, for the students this viewer can see. */
  week: { active_students: number; focus_minutes: number; practice_sessions: number; practice_score: number | null; chip_asks: number; ai_records: number };
  /** Eight weeks, oldest first. */
  weeks: { week: string; active: number; minutes: number }[];
}

/** A row of study_institution_students: a member, with the last 30 days in numbers. */
export interface InstitutionMember {
  user_id: string;
  name: string;
  email: string;
  role: InstitutionRole;
  classes: string[];
  joined_at: string;
  last_active: string | null;
  minutes_30d: number;
  practice_score_30d: number | null;
  asks_30d: number;
  assignments: number;
  ai_records: number;
}

/** One student, for their admin or teacher. Never chats, notes or documents. */
export interface StudentDetail {
  student: { user_id: string; name: string; email: string; joined_at: string } | null;
  assignments: {
    id: string;
    title: string;
    course: string;
    kind: 'topic' | 'assignment';
    status: 'active' | 'submitted' | 'archived';
    due_at: string | null;
    words: number;
    updated: string;
    focus_minutes: number;
    practice: { sessions: number; score: number | null };
    ai_use: { action: LogAction; summary: string; words: number; at: string }[];
  }[];
}

export interface InviteResult {
  email: string;
  token: string | null;
  status: 'invited' | 'invalid' | 'member';
}

export interface InvitePeek {
  status: 'open' | 'used' | 'expired' | 'revoked' | 'unknown';
  institution?: string;
  role?: InstitutionRole;
  class?: string | null;
  email_matches?: boolean;
}

export interface StudyClass {
  id: string;
  name: string;
  code: string;
  archived: boolean;
  created_at: string;
  teachers: { user_id: string; name: string }[];
  students: number;
}

/** An institution as Kaivon's staff see it, to review. */
export interface StaffInstitution {
  id: string;
  name: string;
  kind: InstitutionKind;
  country: string;
  website: string;
  domain_requested: string;
  email_domain: string | null;
  contact_name: string;
  contact_role: string;
  contact_email: string | null;
  students_estimate: number | null;
  status: InstitutionStatus;
  plan: InstitutionPlan;
  seats: number;
  students: number;
  pilot_ends: string | null;
  paid_until: string | null;
  review_note: string;
  created_at: string;
  reviewed_at: string | null;
}

/** What a class code is, before joining (study_class_peek). */
export interface ClassPeek {
  found: boolean;
  class?: string;
  institution?: string;
  /** Whether its institution is open to students now. */
  active?: boolean;
  /** Your role at its institution already, if any. */
  member?: InstitutionRole | null;
}

/** An invite link still waiting to be used (study_institution_invites_list). */
export interface OpenInvite {
  email: string;
  role: InstitutionRole;
  token: string;
  class: string | null;
  class_id: string | null;
  created_at: string;
  expires_at: string;
}

/** A class you study in (study_my_classes). */
export interface MyClass {
  id: string;
  name: string;
  institution: string;
  help_level: 'guide' | 'explain' | 'hints';
}
