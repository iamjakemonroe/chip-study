/** The Worker for study.kaivon.app: the room server's API under /api/rooms/:roomId/..., and
 * everything else from the built app (dist) exactly as before.
 *
 * Every HTTP call carries the person's Supabase access token. The Worker checks it by calling
 * study_room_access as them, refuses unless they are in the room and it is live, and passes only
 * that verified access on to the room's Durable Object. The room socket can't carry a header, so
 * it uses a ticket from POST /ticket instead. The contract is docs/rooms.md. */
import { ROOM, type ApiError, type ApiErrorCode, type TicketAnswer } from '../shared/rooms.ts';
import { configured, type Env } from './env.ts';
import type { Answer, RtcOp } from './room.ts';
import { REALTIME_API, SfuError, turnCredentials } from './sfu.ts';
import { checkAccess } from './supabase.ts';
import { readTicket, signTicket } from './tickets.ts';

export { StudyRoom } from './room.ts';

const ROUTE = /^\/api\/rooms\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/(ticket|ws|turn|rtc\/(?:session|publish|receive|renegotiate|layer|close))$/;

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

const error = (status: number, code: ApiErrorCode, more: Omit<ApiError, 'error'> = {}, extra: Record<string, string> = {}): Response =>
  json(status, { error: code, ...more } satisfies ApiError, extra);

const fromAnswer = (a: Answer): Response => new Response(a.body, { status: a.status, headers: HEADERS });

function bearer(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return m && m[1].length <= 8192 ? m[1] : null;
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > ROOM.maxBodyBytes) return { ok: false, response: error(413, 'too_big') };
  const text = await request.text();
  if (text.length > ROOM.maxBodyBytes) return { ok: false, response: error(413, 'too_big') };
  try {
    return { ok: true, value: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, response: error(400, 'bad_request', { detail: 'the body must be JSON' }) };
  }
}

async function turn(env: Env): Promise<Response> {
  if (!configured(env.TURN_KEY_ID) || !configured(env.TURN_KEY_API_TOKEN)) return error(503, 'not_configured', { detail: 'TURN is not set up yet' });
  try {
    const iceServers = await turnCredentials(env.TURN_API_BASE || REALTIME_API, env.TURN_KEY_ID, env.TURN_KEY_API_TOKEN, ROOM.turnTtlSeconds);
    return json(200, { iceServers });
  } catch (e) {
    const code = e instanceof SfuError ? e.code : 'unknown';
    console.error('turn credentials', e instanceof Error ? e.message : e);
    return error(502, 'sfu_error', { code });
  }
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const m = ROUTE.exec(url.pathname);
  if (!m) return error(404, 'not_found');
  const roomId = m[1].toLowerCase(); // one room, one Durable Object, however the id is written
  const route = m[2];
  const method = route === 'ws' || route === 'turn' ? 'GET' : 'POST';
  if (request.method !== method) return error(405, 'method_not_allowed', {}, { allow: method });
  if (!configured(env.SUPABASE_URL) || !configured(env.SUPABASE_ANON_KEY) || !configured(env.ROOM_SERVER_SECRET)) {
    return error(503, 'not_configured', { detail: 'the room server is not set up yet' });
  }
  const room = () => env.ROOMS.get(env.ROOMS.idFromName(roomId));

  if (route === 'ws') {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return error(426, 'bad_request', { detail: 'expected a WebSocket upgrade' }, { upgrade: 'websocket' });
    // A made-up or stale ticket never reaches (or wakes) a room.
    const nonce = await readTicket(env.ROOM_SERVER_SECRET, roomId, url.searchParams.get('ticket') ?? '', Date.now());
    if (!nonce) return error(401, 'unauthorized', { detail: 'the ticket is not valid; get a new one' });
    return room().fetch(new Request(`https://room/ws?n=${encodeURIComponent(nonce)}`, { headers: { upgrade: 'websocket' } }));
  }

  const token = bearer(request);
  if (!token) return error(401, 'unauthorized');
  const checked = await checkAccess({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY }, roomId, token);
  if (!checked.ok) return error(checked.status, checked.error, { ...(checked.detail ? { detail: checked.detail } : {}), ...(checked.state ? { state: checked.state } : {}) });
  const access = checked.access;

  if (route === 'turn') return turn(env);
  if (route === 'ticket') {
    const a = await room().ticket(roomId, access);
    if (a.status !== 200) return fromAnswer(a);
    const { nonce, expiresAt } = JSON.parse(a.body) as { nonce: string; expiresAt: number };
    return json(200, { ticket: await signTicket(env.ROOM_SERVER_SECRET, roomId, nonce, expiresAt) } satisfies TicketAnswer);
  }
  const body = await readJson(request);
  if (!body.ok) return body.response;
  return fromAnswer(await room().rtc(route.slice('rtc/'.length) as RtcOp, roomId, access, body.value));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (e) {
        console.error('room api', url.pathname, e instanceof Error ? e.message : e);
        return error(500, 'internal');
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
