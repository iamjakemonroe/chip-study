/** The rooms side of the pretend Supabase (e2e/mock.ts): study rooms, who's in them and what they may
 * do, following utopia's 20261107230000_study_rooms.sql and 20261108000000_study_room_roster.sql in
 * memory (the same rules, answers and errors). The room server itself is e2e/mock-room-server.ts. */
import { Raise } from './mock-institutions';

type Role = 'host' | 'cohost' | 'member';
type State = 'in' | 'waiting' | 'removed';

export interface MMember {
  user_id: string;
  name: string;
  role: Role;
  state: State;
  /** The member's own flag (editing also comes from the role and the room's edit mode). */
  can_edit: boolean;
  joined_at: string;
}

export interface MRoom {
  id: string;
  token: string;
  assignment_id: string;
  host_id: string;
  institution_id: string | null;
  title: string;
  edit_mode: 'everyone' | 'chosen';
  admission: 'link' | 'ask' | 'invited';
  max_people: number;
  ends_at: string | null;
  status: 'open' | 'ended';
  members: MMember[];
  invited_classes: { id: string; name: string }[];
  invited_people: { user_id: string; name: string }[];
  tutor: { class: string; institution: string; course_brief: string; help_level: 'guide' | 'explain' | 'hints'; tutor_notes: string } | null;
}

/** What the rest of the pretend backend gives the rooms. */
export interface RoomsHost {
  me(): { id: string; name: string };
  tier(): 'free' | 'pro';
  age(userId: string): 'adult' | 'guardian' | null;
  instRole(institutionId: string, userId: string): 'admin' | 'teacher' | 'student' | null;
  instName(institutionId: string): string | null;
  assignment(id: string): Record<string, unknown> | undefined;
  rows(table: 'study_documents' | 'study_notes' | 'study_tasks' | 'study_sources', assignmentId: string): Record<string, unknown>[];
  log(row: Record<string, unknown>): string;
}

let n = 0;
const uuid = (kind = 'r') => {
  n += 1;
  return `${kind.repeat(8).slice(0, 8)}-0000-4000-8000-${String(n + Math.floor(Math.random() * 1e6) * 100).padStart(12, '0').slice(-12)}`;
};
const now = () => new Date().toISOString();

export class MockRooms {
  rooms: MRoom[] = [];
  /** Every study_room_log_use, for checking. */
  uses: Record<string, unknown>[] = [];

  constructor(private h: RoomsHost) {}

  /** A room on [assignmentId]; the signed-in person is its host unless [host] says otherwise. */
  seed(assignmentId: string, f: Partial<MRoom> & { hostName?: string } = {}): MRoom {
    const me = this.h.me();
    const hostId = f.host_id ?? me.id;
    const r: MRoom = {
      id: uuid('a'),
      token: `room${uuid('b').replace(/-/g, '')}`,
      assignment_id: assignmentId,
      host_id: hostId,
      institution_id: null,
      title: String(this.h.assignment(assignmentId)?.title ?? 'Study room'),
      edit_mode: 'everyone',
      admission: 'link',
      max_people: 4,
      ends_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      status: 'open',
      members: [{ user_id: hostId, name: f.hostName ?? (hostId === me.id ? me.name : 'Grace Hopper'), role: 'host', state: 'in', can_edit: true, joined_at: now() }],
      invited_classes: [],
      invited_people: [],
      tutor: null,
      ...f,
    };
    this.rooms.push(r);
    return r;
  }

  /** Someone else in [room] (not connected: the room server says who's connected). */
  member(room: MRoom, name: string, f: Partial<MMember> = {}): MMember {
    const m: MMember = { user_id: uuid('c'), name, role: 'member', state: 'in', can_edit: false, joined_at: now(), ...f };
    room.members.push(m);
    return m;
  }

  live(r: MRoom) {
    return r.status === 'open' && (r.ends_at === null || Date.parse(r.ends_at) > Date.now());
  }

  canEdit(r: MRoom, m: MMember | undefined) {
    return !!m && m.state === 'in' && (m.role !== 'member' || r.edit_mode === 'everyone' || m.can_edit);
  }

  memberOf(r: MRoom, userId: string) {
    return r.members.find((m) => m.user_id === userId);
  }

  private manager(roomId: unknown): MRoom {
    const r = this.rooms.find((x) => x.id === roomId);
    const m = r && this.memberOf(r, this.h.me().id);
    if (!r || !m || m.state !== 'in' || (m.role !== 'host' && m.role !== 'cohost')) throw new Raise('not allowed');
    return r;
  }

  get(r: MRoom) {
    return {
      id: r.id,
      assignment_id: r.assignment_id,
      title: r.title,
      token: r.token,
      institution_id: r.institution_id,
      edit_mode: r.edit_mode,
      admission: r.admission,
      max_people: r.max_people,
      ends_at: r.ends_at,
      live: this.live(r),
      members: r.members.map((m) => ({ user_id: m.user_id, name: m.name, role: m.role, state: m.state, can_edit: this.canEdit(r, m), joined_at: m.joined_at })),
      invited_classes: r.invited_classes,
      invited_people: r.invited_people,
    };
  }

  private why(r: MRoom, userId: string): string | null {
    const m = this.memberOf(r, userId);
    if (!this.live(r)) return 'ended';
    if (m?.state === 'removed') return 'removed';
    if (m) return null;
    if (r.institution_id) {
      const role = this.h.instRole(r.institution_id, userId);
      const invited = r.invited_people.some((p) => p.user_id === userId) || (role !== null && r.invited_classes.length > 0);
      return role === 'admin' || role === 'teacher' || invited ? null : 'not_invited';
    }
    const age = this.h.age(userId);
    if (age === null) return 'age_unknown';
    if (age !== 'adult') return 'adults_only';
    return null;
  }

  handles(fn: string): boolean {
    return fn.startsWith('study_room') || fn === 'study_rooms_mine';
  }

  call(fn: string, a: Record<string, unknown>): unknown {
    const me = this.h.me();
    switch (fn) {
      case 'study_room_open': {
        const asg = this.h.assignment(String(a.p_assignment));
        if (!asg || asg.user_id !== me.id) throw new Raise('no such assignment');
        const open = this.rooms.find((r) => r.assignment_id === asg.id && r.status === 'open');
        if (open && !this.live(open)) open.status = 'ended';
        const existing = this.rooms.find((r) => r.assignment_id === asg.id && r.status === 'open');
        if (existing) {
          if ((existing.institution_id ?? null) !== (a.p_institution ?? null)) throw new Raise('a room is already open');
          return this.get(existing);
        }
        if (a.p_institution) {
          const role = this.h.instRole(String(a.p_institution), me.id);
          if (role !== 'admin' && role !== 'teacher') throw new Raise('not allowed');
          return this.get(this.seed(String(asg.id), { institution_id: String(a.p_institution), edit_mode: 'chosen', admission: 'invited', max_people: 50, ends_at: null }));
        }
        if (this.h.age(me.id) !== 'adult') throw new Raise('adults only');
        const pro = this.h.tier() === 'pro';
        return this.get(this.seed(String(asg.id), { max_people: pro ? 10 : 4, ends_at: pro ? null : new Date(Date.now() + 60 * 60_000).toISOString() }));
      }
      case 'study_room_get':
        return this.get(this.manager(a.p_room));
      case 'study_room_invite': {
        const r = this.manager(a.p_room);
        if (!r.institution_id) throw new Raise('personal rooms use their link');
        for (const id of (a.p_classes as string[]) ?? []) if (!r.invited_classes.some((c) => c.id === id)) r.invited_classes.push({ id, name: `Class ${id.slice(0, 4)}` });
        for (const id of (a.p_people as string[]) ?? []) if (!r.invited_people.some((p) => p.user_id === id)) r.invited_people.push({ user_id: id, name: `Student ${id.slice(0, 4)}` });
        return this.get(r);
      }
      case 'study_room_uninvite': {
        const r = this.manager(a.p_room);
        r.invited_classes = r.invited_classes.filter((c) => c.id !== a.p_class);
        r.invited_people = r.invited_people.filter((p) => p.user_id !== a.p_person);
        return this.get(r);
      }
      case 'study_room_peek': {
        const r = this.rooms.find((x) => x.token === a.p_token);
        if (!r) return { found: false };
        const m = this.memberOf(r, me.id);
        const why = this.why(r, me.id);
        const host = this.memberOf(r, r.host_id)?.name ?? 'Student';
        return { found: true, title: r.title, host, institution: r.institution_id ? this.h.instName(r.institution_id) : null, class_room: !!r.institution_id, admission: r.admission, ends_at: r.ends_at, state: m?.state ?? null, can_join: why === null, reason: why };
      }
      case 'study_room_join': {
        const r = this.rooms.find((x) => x.token === a.p_token);
        if (!r) throw new Raise('no such room');
        const why = this.why(r, me.id);
        if (why) throw new Raise(why);
        let m = this.memberOf(r, me.id);
        if (!m) {
          let role: Role = 'member';
          if (r.institution_id) {
            const ir = this.h.instRole(r.institution_id, me.id);
            role = ir === 'admin' || ir === 'teacher' ? 'cohost' : 'member';
          }
          m = { user_id: me.id, name: me.name, role, state: r.admission === 'ask' && role === 'member' ? 'waiting' : 'in', can_edit: false, joined_at: now() };
          r.members.push(m);
        }
        return { room_id: r.id, role: m.role, state: m.state, can_edit: this.canEdit(r, m) };
      }
      case 'study_room_workspace': {
        const r = this.rooms.find((x) => x.id === a.p_room);
        const m = r && this.memberOf(r, me.id);
        if (!r || !this.live(r) || m?.state !== 'in') throw new Raise('not allowed');
        const asg = this.h.assignment(r.assignment_id)!;
        return {
          assignment: { id: asg.id, title: asg.title, course: asg.course, brief: asg.brief, rubric: asg.rubric, due_at: asg.due_at, word_target: asg.word_target, style: asg.style, kind: asg.kind, color: asg.color },
          documents: this.h.rows('study_documents', r.assignment_id).map((d) => ({ id: d.id, kind: d.kind, title: d.title, content: d.content, version: d.version, sort: d.sort })),
          sources: this.h.rows('study_sources', r.assignment_id).map((s) => ({ id: s.id, kind: s.kind, data: s.data, note: s.note, file_name: s.file_name })),
          notes: this.h.rows('study_notes', r.assignment_id).map((x) => ({ id: x.id, body: x.body, pinned: x.pinned })),
          tasks: this.h.rows('study_tasks', r.assignment_id).map((t) => ({ id: t.id, title: t.title, due_on: t.due_on, done: t.done })),
        };
      }
      case 'study_room_settings': {
        const r = this.manager(a.p_room);
        if (a.p_edit_mode && !['everyone', 'chosen'].includes(String(a.p_edit_mode))) throw new Raise('bad edit mode');
        if (a.p_admission && (r.institution_id || !['link', 'ask'].includes(String(a.p_admission)))) throw new Raise('bad admission');
        if (a.p_edit_mode) r.edit_mode = a.p_edit_mode as MRoom['edit_mode'];
        if (a.p_admission) r.admission = a.p_admission as MRoom['admission'];
        return this.get(r);
      }
      case 'study_room_member_set': {
        const r = this.manager(a.p_room);
        const m = this.memberOf(r, String(a.p_user));
        if (!m) throw new Raise('not a member');
        if (m.role === 'host' || (m.role === 'cohost' && me.id !== r.host_id)) throw new Raise('not allowed');
        if (a.p_state) m.state = a.p_state as State;
        if (typeof a.p_can_edit === 'boolean') m.can_edit = a.p_can_edit;
        return this.get(r);
      }
      case 'study_room_new_link': {
        const r = this.manager(a.p_room);
        r.token = `room${uuid('d').replace(/-/g, '')}`;
        return this.get(r);
      }
      case 'study_room_end': {
        const r = this.manager(a.p_room);
        r.status = 'ended';
        return null;
      }
      case 'study_rooms_mine':
        return this.rooms
          .filter((r) => this.live(r) && r.members.some((m) => m.user_id === me.id && m.state !== 'removed'))
          .map((r) => ({ id: r.id, token: r.token, title: r.title, host: this.memberOf(r, r.host_id)?.name ?? 'Student', institution: r.institution_id ? this.h.instName(r.institution_id) : null, mine: r.host_id === me.id, ends_at: r.ends_at, created_at: now() }));
      case 'study_room_tutor': {
        const r = this.rooms.find((x) => x.id === a.p_room);
        return r?.tutor ?? null;
      }
      case 'study_room_log_use': {
        const r = this.rooms.find((x) => x.id === a.p_room);
        const m = r && this.memberOf(r, me.id);
        if (!r || !m || !this.live(r) || !this.canEdit(r, m)) throw new Raise('not allowed');
        this.uses.push({ room: r.id, ...a });
        return this.h.log({ assignment_id: r.assignment_id, message_id: a.p_message ?? null, action: a.p_action, summary: 'Put Chip’s words into the document (in a study room)', output: String(a.p_excerpt ?? ''), words: Number(a.p_words ?? 0), room_id: r.id });
      }
      default:
        throw new Raise(`unknown function ${fn}`);
    }
  }
}
