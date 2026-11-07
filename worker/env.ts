/** The Worker's bindings and settings (wrangler.jsonc vars, plus secrets set with
 * `wrangler secret put`). See docs/rooms.md, "Secrets and settings". */
import type { StudyRoom } from './room.ts';

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<StudyRoom>;
  SUPABASE_URL: string;
  /** Secret (public value, kept as a secret so deploys never reset it): the publishable key. */
  SUPABASE_ANON_KEY?: string;
  /** The study-rooms function: `<SUPABASE_URL>/functions/v1/study-rooms`. */
  ROOM_SERVICE_URL: string;
  /** Secret: shared with the study-rooms function; also signs room tickets. */
  ROOM_SERVER_SECRET?: string;
  /** Secret. */
  REALTIME_APP_ID?: string;
  /** Secret. */
  REALTIME_APP_SECRET?: string;
  /** Secret. */
  TURN_KEY_ID?: string;
  /** Secret. */
  TURN_KEY_API_TOKEN?: string;
  /** For tests: where the SFU and TURN APIs are (default Cloudflare's). */
  REALTIME_API_BASE?: string;
  TURN_API_BASE?: string;
}

/** A setting that has been filled in: present, and not one of wrangler.jsonc's REPLACE_ placeholders. */
export const configured = (v: string | undefined): v is string => typeof v === 'string' && v.length > 0 && !v.startsWith('REPLACE_');
