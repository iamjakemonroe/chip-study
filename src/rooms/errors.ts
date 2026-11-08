import type { ApiError as RoomApiErrorBody, ApiErrorCode } from '../../shared/rooms.ts';

/** A refusal from the room server: its HTTP status and code (docs/rooms.md, "Errors"). Kept apart
 * from api.ts so the media client and the socket don't need the Supabase client. */
export class RoomServerError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode | 'network',
    public body: Partial<RoomApiErrorBody> = {},
  ) {
    super(`${status} ${code}${body.detail ? `: ${body.detail}` : ''}`);
  }
}
