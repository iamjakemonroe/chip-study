import type {
  ApiError as RoomApiErrorBody,
  ApiErrorCode,
  CloseAnswer,
  CloseRequest,
  EditMode,
  LayerAnswer,
  LayerRequest,
  PublishAnswer,
  PublishRequest,
  ReceiveAnswer,
  ReceiveRequest,
  RenegotiateRequest,
  Role,
  SessionAnswer,
  SessionPurpose,
  TicketAnswer,
  TurnAnswer,
} from '../../shared/rooms.ts';
import { ApiError } from '../lib/api.ts';
import { RoomServerError } from './errors.ts';
import { supabase } from '../lib/supabase.ts';
import type { HelpLevel } from '../lib/types.ts';

/** Rooms: the database side (study_room_* functions, as the signed-in person) and the room
 * server's HTTP side (/api/rooms/:roomId/...). The contract is docs/rooms.md. */

// ── The database ──────────────────────────────────────────────────────

export type Admission = 'link' | 'ask' | 'invited';
export type MemberState = 'in' | 'waiting' | 'removed';
export type JoinReason = 'ended' | 'removed' | 'not_invited' | 'age_unknown' | 'adults_only';

export interface RoomMember {
  user_id: string;
  name: string;
  role: Role;
  state: MemberState;
  can_edit: boolean;
  joined_at: string;
}

/** A room as its hosts and co-hosts see it (study_room_get). */
export interface RoomInfo {
  id: string;
  assignment_id: string;
  title: string;
  token: string;
  institution_id: string | null;
  edit_mode: EditMode;
  admission: Admission;
  max_people: number;
  ends_at: string | null;
  live: boolean;
  members: RoomMember[];
  invited_classes: { id: string; name: string }[];
  invited_people: { user_id: string; name: string }[];
}

/** What a room link is, before joining (study_room_peek). */
export interface RoomPeek {
  found: boolean;
  title?: string;
  host?: string;
  institution?: string | null;
  class_room?: boolean;
  admission?: Admission;
  ends_at?: string | null;
  state?: MemberState | null;
  can_join?: boolean;
  reason?: JoinReason | null;
}

export interface JoinResult {
  room_id: string;
  role: Role;
  state: 'in' | 'waiting';
  can_edit: boolean;
}

export interface WorkspaceDocument {
  id: string;
  kind: string;
  title: string;
  content: Record<string, unknown> | null;
  version: number;
  sort: number;
}

/** The shared work as it was when the room opened (study_room_workspace). */
export interface RoomWorkspace {
  assignment: {
    id: string;
    title: string;
    course: string;
    brief: string;
    rubric: string;
    due_at: string | null;
    word_target: number | null;
    style: string;
    kind: 'topic' | 'assignment';
    color: string;
  };
  documents: WorkspaceDocument[];
  sources: { id: string; kind: string; data: Record<string, unknown>; note: string; file_name: string | null }[];
  notes: { id: string; body: string; pinned: boolean }[];
  tasks: { id: string; title: string; due_on: string | null; done: boolean }[];
}

/** A room running now that you're in, host, or are invited to (study_rooms_mine). */
export interface MyRoom {
  id: string;
  token: string;
  title: string;
  host: string;
  institution: string | null;
  mine: boolean;
  ends_at: string | null;
  created_at: string;
}

export interface RoomTutor {
  class: string;
  institution: string;
  course_brief: string;
  help_level: HelpLevel;
  tutor_notes: string;
}

const REASONS: JoinReason[] = ['ended', 'removed', 'not_invited', 'age_unknown', 'adults_only'];

/** A join the database refused, with why ([reason]), as a sentence for people. */
export class RoomRefused extends ApiError {
  constructor(
    message: string,
    public reason: JoinReason | 'not_found',
  ) {
    super(message, reason);
  }
}

/** The database's reasons, said kindly. */
export function reasonText(reason: JoinReason | 'not_found', who = 'the host'): { title: string; body: string } {
  switch (reason) {
    case 'ended':
      return { title: 'This room has ended', body: `Everything written in it is saved to ${who}’s assignment. Ask them to open a new room if you’d like to carry on together.` };
    case 'removed':
      return { title: 'You can’t rejoin this room', body: 'A host took you out of this room, so this link doesn’t work for you any more. If you think that’s a mistake, ask them.' };
    case 'not_invited':
      return { title: 'This room is for invited classes', body: 'Only the classes and students the teacher invited can join. If you should be in it, ask your teacher to invite you or your class.' };
    case 'age_unknown':
      return { title: 'One question first', body: 'Tell us your age to join.' };
    case 'adults_only':
      return {
        title: 'This room is for adults',
        body: 'Personal study rooms are for people 18 and over, because they have live video with people you may not know. You can still join rooms your school, college or university opens for your class.',
      };
    case 'not_found':
      return { title: 'This link doesn’t work', body: 'It may have been cut short when it was copied, or the host made a new link. Check you have all of it, or ask for the link again.' };
  }
}

function friendly(raw: string, fallback: string): string {
  if (/fetch|network|Failed to fetch|Load failed/i.test(raw)) return 'You seem to be offline. Try again in a moment.';
  if (/adults only/.test(raw)) return 'Personal study rooms are for people 18 and over.';
  if (/a room is already open/.test(raw)) return 'A room is already open on this. Join it from your desk, or end it first.';
  if (/institution not active/.test(raw)) return 'Your institution isn’t active on Chip Study just now, so it can’t open class rooms.';
  if (/room ended/.test(raw)) return 'This room has ended.';
  if (/not your class/.test(raw)) return 'You can invite only classes you teach.';
  if (/not your student/.test(raw)) return 'You can invite only students in your classes.';
  if (/not in the institution/.test(raw)) return 'That person isn’t part of your institution.';
  if (/not allowed/.test(raw)) return 'Only the room’s hosts can do that.';
  if (/no such assignment/.test(raw)) return 'That assignment isn’t here any more.';
  return fallback;
}

function rpc<T>(result: { data: unknown; error: { message: string } | null }, fallback: string): T {
  if (result.error) {
    console.warn(fallback, result.error.message);
    const reason = REASONS.find((r) => result.error!.message === r || result.error!.message.endsWith(r));
    if (reason) throw new RoomRefused(reasonText(reason).title, reason);
    if (/no such room/.test(result.error.message)) throw new RoomRefused(reasonText('not_found').title, 'not_found');
    throw new ApiError(friendly(result.error.message, fallback), result.error.message);
  }
  return result.data as T;
}

const room = (r: RoomInfo): RoomInfo => ({ ...r, members: r.members ?? [], invited_classes: r.invited_classes ?? [], invited_people: r.invited_people ?? [] });

export async function openRoom(assignmentId: string, institutionId: string | null = null): Promise<RoomInfo> {
  return room(rpc<RoomInfo>(await supabase.rpc('study_room_open', { p_assignment: assignmentId, p_institution: institutionId }), 'Couldn’t open a room just now. Try again.'));
}

export async function getRoom(roomId: string): Promise<RoomInfo> {
  return room(rpc<RoomInfo>(await supabase.rpc('study_room_get', { p_room: roomId }), 'Couldn’t load the room just now.'));
}

export async function inviteToRoom(roomId: string, classes: string[], people: string[]): Promise<RoomInfo> {
  return room(rpc<RoomInfo>(await supabase.rpc('study_room_invite', { p_room: roomId, p_classes: classes, p_people: people }), 'Couldn’t invite them just now.'));
}

export async function uninviteFromRoom(roomId: string, what: { classId?: string; userId?: string }): Promise<RoomInfo> {
  return room(rpc<RoomInfo>(await supabase.rpc('study_room_uninvite', { p_room: roomId, p_class: what.classId ?? null, p_person: what.userId ?? null }), 'Couldn’t change that just now.'));
}

export async function peekRoom(token: string): Promise<RoomPeek> {
  return rpc<RoomPeek>(await supabase.rpc('study_room_peek', { p_token: token }), 'Couldn’t open that room just now.') ?? { found: false };
}

export async function joinRoom(token: string): Promise<JoinResult> {
  return rpc<JoinResult>(await supabase.rpc('study_room_join', { p_token: token }), 'Couldn’t join just now. Try again.');
}

export async function roomWorkspace(roomId: string): Promise<RoomWorkspace> {
  const w = rpc<RoomWorkspace>(await supabase.rpc('study_room_workspace', { p_room: roomId }), 'Couldn’t load the shared work just now.');
  return { ...w, documents: w.documents ?? [], sources: w.sources ?? [], notes: w.notes ?? [], tasks: w.tasks ?? [] };
}

export async function roomSettings(roomId: string, s: { editMode?: EditMode; admission?: 'link' | 'ask' }): Promise<RoomInfo> {
  return room(rpc<RoomInfo>(await supabase.rpc('study_room_settings', { p_room: roomId, p_edit_mode: s.editMode ?? null, p_admission: s.admission ?? null }), 'Couldn’t save that just now.'));
}

export async function setRoomMember(roomId: string, userId: string, s: { state?: 'in' | 'removed'; canEdit?: boolean }): Promise<RoomInfo> {
  return room(
    rpc<RoomInfo>(await supabase.rpc('study_room_member_set', { p_room: roomId, p_user: userId, p_state: s.state ?? null, p_can_edit: s.canEdit ?? null }), 'Couldn’t change that just now.'),
  );
}

export async function newRoomLink(roomId: string): Promise<RoomInfo> {
  return room(rpc<RoomInfo>(await supabase.rpc('study_room_new_link', { p_room: roomId }), 'Couldn’t make a new link just now.'));
}

export async function endRoom(roomId: string): Promise<void> {
  rpc(await supabase.rpc('study_room_end', { p_room: roomId }), 'Couldn’t end the room just now.');
}

export async function myRooms(): Promise<MyRoom[]> {
  return rpc<MyRoom[] | null>(await supabase.rpc('study_rooms_mine'), 'Couldn’t load your rooms just now.') ?? [];
}

export async function roomTutor(roomId: string): Promise<RoomTutor | null> {
  return rpc<RoomTutor | null>(await supabase.rpc('study_room_tutor', { p_room: roomId }), 'Couldn’t load the course guidance just now.') ?? null;
}

export async function roomLogUse(roomId: string, action: 'inserted' | 'replaced' | 'added_tasks' | 'added_sources', messageId: string | null, words: number, excerpt: string): Promise<void> {
  rpc(await supabase.rpc('study_room_log_use', { p_room: roomId, p_action: action, p_message: messageId, p_words: words, p_excerpt: excerpt.slice(0, 4000) }), 'Couldn’t note that in the record.');
}

// ── The room server ───────────────────────────────────────────────────

export { RoomServerError };

/** Where the room server is: this site, unless a build says otherwise. */
export const ROOMS_BASE = (import.meta.env.VITE_ROOMS_URL as string | undefined) ?? '';

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new RoomServerError(401, 'unauthorized');
  return token;
}

/** How long a call to the room server may take before it counts as lost. */
export const CALL_TIMEOUT_MS = 20_000;

/** The room server's HTTP API for one room, as the signed-in person. [fetcher] is for tests. */
export function roomServer(roomId: string, fetcher: typeof fetch = (...a) => fetch(...a)) {
  const call = async <T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> => {
    let res: Response;
    // A call with no answer counts as failed on the way (media then starts again, as Cloudflare
    // advises for a lost tracks call).
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), CALL_TIMEOUT_MS);
    try {
      res = await fetcher(`${ROOMS_BASE}/api/rooms/${roomId}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${await accessToken()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timeout.signal,
      });
    } catch (e) {
      if (e instanceof RoomServerError) throw e;
      throw new RoomServerError(0, 'network');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      const b = json as Partial<RoomApiErrorBody>;
      throw new RoomServerError(res.status, (b.error ?? 'internal') as ApiErrorCode, b);
    }
    return json as T;
  };
  return {
    ticket: () => call<TicketAnswer>('ticket', 'POST').then((a) => a.ticket),
    turn: () => call<TurnAnswer>('turn', 'GET').then((a) => a.iceServers),
    session: (purpose: SessionPurpose) => call<SessionAnswer>('rtc/session', 'POST', { purpose }).then((a) => a.sessionId),
    publish: (req: PublishRequest) => call<PublishAnswer>('rtc/publish', 'POST', req),
    receive: (req: ReceiveRequest) => call<ReceiveAnswer>('rtc/receive', 'POST', req),
    renegotiate: (req: RenegotiateRequest) => call<Record<string, never>>('rtc/renegotiate', 'POST', req),
    layer: (req: LayerRequest) => call<LayerAnswer>('rtc/layer', 'POST', req),
    close: (req: CloseRequest) => call<CloseAnswer>('rtc/close', 'POST', req),
  };
}

export type RoomServer = ReturnType<typeof roomServer>;

/** The room socket's address for [ticket]. */
export function socketUrl(roomId: string, ticket: string): string {
  const base = ROOMS_BASE || location.origin;
  return `${base.replace(/^http/, 'ws')}/api/rooms/${roomId}/ws?ticket=${encodeURIComponent(ticket)}`;
}

/** The link someone joins a room with. */
export const roomLink = (token: string) => `${location.origin}/room/${token}`;
