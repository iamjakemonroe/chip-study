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
}
