/** The room server's two ways into Utopia's Supabase project:
 *  - study_room_access, called with the person's own sign-in: may they be in the room;
 *  - the study-rooms function, called with the shared room-server secret: save, close, roster. */
import type { EditMode, Role } from '../shared/rooms.ts';
import type { Refusal } from './rules.ts';
import { refuse } from './rules.ts';
import type { SaveBatch } from './save.ts';
import type { Access, Member } from './store.ts';
import { UUID } from './ydoc.ts';

type Fetch = typeof fetch;
const TIMEOUT_MS = 10_000;
const ROLES = new Set<Role>(['host', 'cohost', 'member']);
const STATES = new Set(['in', 'waiting', 'removed']);
const MODES = new Set<EditMode>(['everyone', 'chosen']);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A name as the room shows it: the database already never uses an email; this only bounds it. */
const cleanName = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : 'Student');

const toMs = (v: unknown): number | null => {
  if (typeof v !== 'string' || !v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/** study_room_access's answer, checked and in the room's terms; null if it isn't one. */
export function parseAccess(raw: unknown, roomId: string, checkedAt = Date.now()): Access | null {
  if (!isObject(raw)) return null;
  const { user_id, role, state, max_people, edit_mode } = raw;
  if (typeof raw.room_id !== 'string' || raw.room_id.toLowerCase() !== roomId) return null;
  if (typeof user_id !== 'string' || !UUID.test(user_id)) return null;
  if (!ROLES.has(role as Role) || !STATES.has(state as string) || !MODES.has(edit_mode as EditMode)) return null;
  if (typeof max_people !== 'number' || !Number.isInteger(max_people) || max_people < 1) return null;
  return {
    roomId,
    userId: user_id.toLowerCase(),
    name: cleanName(raw.name),
    role: role as Role,
    state: state as Access['state'],
    canEdit: raw.can_edit === true,
    live: raw.live === true,
    maxPeople: max_people,
    endsAt: toMs(raw.ends_at),
    editMode: edit_mode as EditMode,
    classRoom: raw.class_room === true,
    checkedAt,
  };
}

/** Asks the database, as the person, whether they may use the room now. Refuses unless they are
 * in it (state 'in') and it is live. */
export async function checkAccess(
  env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string },
  roomId: string,
  token: string,
  f: Fetch = fetch,
): Promise<{ ok: true; access: Access } | Refusal> {
  const checkedAt = Date.now(); // before asking: the answer is true at least as of now
  let res: Response;
  try {
    res = await f(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/study_room_access`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_room: roomId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return refuse(502, 'upstream', 'the database could not be reached');
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) return refuse(401, 'unauthorized');
  if (!res.ok) {
    // The function raises 'not a member' (PostgREST answers 400 with the message).
    const message = isObject(body) && typeof body.message === 'string' ? body.message : '';
    if (res.status === 400 && /not a member/i.test(message)) return refuse(403, 'not_in_room');
    if (/jwt|token/i.test(message)) return refuse(401, 'unauthorized');
    return refuse(502, 'upstream', `study_room_access answered ${res.status}`);
  }
  const access = parseAccess(body, roomId, checkedAt);
  if (!access) return refuse(502, 'upstream', 'study_room_access answered something unexpected');
  if (!access.live) return refuse(410, 'ended');
  if (access.state !== 'in') return { ...refuse(403, 'not_in_room'), state: access.state };
  return { ok: true, access };
}

export interface Roster {
  live: boolean;
  endsAt: number | null;
  maxPeople: number;
  editMode: EditMode;
  members: Record<string, Member>;
}

export function parseRoster(raw: unknown): Roster | null {
  if (!isObject(raw) || !Array.isArray(raw.members) || !MODES.has(raw.edit_mode as EditMode)) return null;
  if (typeof raw.max_people !== 'number' || !Number.isInteger(raw.max_people) || raw.max_people < 1) return null;
  const members: Record<string, Member> = {};
  for (const m of raw.members) {
    if (!isObject(m) || typeof m.user_id !== 'string' || !UUID.test(m.user_id)) return null;
    if (!ROLES.has(m.role as Role) || !STATES.has(m.state as string)) return null;
    members[m.user_id.toLowerCase()] = { name: cleanName(m.name), role: m.role as Role, state: m.state as Member['state'], canEdit: m.can_edit === true };
  }
  return { live: raw.live === true, endsAt: toMs(raw.ends_at), maxPeople: raw.max_people, editMode: raw.edit_mode as EditMode, members };
}

/** The study-rooms function, authorised by the room server's shared secret (never a person). */
export class RoomService {
  constructor(
    private readonly url: string,
    private readonly secret: string,
    // fetch must not be called as a method of this object (Workers: illegal invocation)
    private readonly f: Fetch = (input, init) => fetch(input, init),
  ) {}

  private async call(body: Record<string, unknown>): Promise<unknown> {
    const res = await this.f(this.url, {
      method: 'POST',
      headers: { 'x-room-secret': this.secret, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const why = isObject(json) && typeof json.error === 'string' ? json.error : '';
      throw new Error(`study-rooms ${String(body.action)} answered ${res.status}${why ? ` (${why})` : ''}`);
    }
    return json;
  }

  async save(roomId: string, batch: SaveBatch): Promise<void> {
    await this.call({ action: 'save', room_id: roomId, ...batch });
  }

  async close(roomId: string): Promise<void> {
    await this.call({ action: 'close', room_id: roomId });
  }

  async roster(roomId: string): Promise<Roster> {
    const roster = parseRoster(await this.call({ action: 'roster', room_id: roomId }));
    if (!roster) throw new Error('study-rooms roster answered something unexpected');
    return roster;
  }
}
