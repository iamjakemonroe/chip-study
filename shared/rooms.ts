/** Chip Study rooms: what the room server (worker/) and the room screens (src/rooms/) agree on.
 *
 * The contract in words is docs/rooms.md; this is the same contract as types and numbers. It
 * imports nothing and uses no Worker or browser types, so both sides can import it. */

export type Role = 'host' | 'cohost' | 'member';
export type EditMode = 'everyone' | 'chosen';
export type TrackKind = 'audio' | 'video' | 'screen' | 'screen-audio';
export type SessionPurpose = 'publish' | 'receive';

export const TRACK_KINDS: readonly TrackKind[] = ['audio', 'video', 'screen', 'screen-audio'];
/** Kinds that may be sent with simulcast layers. */
export const LAYERED_KINDS: readonly TrackKind[] = ['video', 'screen'];
/** Simulcast layers, best first: full, half and quarter size. The SFU falls back alphabetically. */
export const RIDS = ['f', 'h', 'q'] as const;
export type Rid = (typeof RIDS)[number];

/** A publication's name: `<userId>:<kind>`. The server refuses any other name. */
export const trackNameFor = (userId: string, kind: TrackKind): string => `${userId}:${kind}`;

/** Limits and timings. Times are in milliseconds unless the name says otherwise. */
export const ROOM = {
  /** A ticket is good for one socket, for this long. */
  ticketMs: 60_000,
  chatChars: 2_000,
  chatKept: 200,
  chipKept: 50,
  chipQuestionChars: 4_000,
  chipAnswerChars: 40_000,
  /** Chip chunks closer together than this are dropped (each chunk is the whole answer so far). */
  chipChunkGapMs: 250,
  /** While there are changes, the shared work is saved about this often. */
  saveEveryMs: 20_000,
  /** Someone's publications are dropped this long after their last socket closes. */
  pubGraceMs: 30_000,
  /** A room everyone has left is saved and closed after this long. */
  emptyCloseMs: 30 * 60_000,
  /** A free room is warned this long before its end. */
  endingWarnMs: 5 * 60_000,
  /** If the person asked to seed hasn't seeded by then, the next editor is asked. */
  seedWaitMs: 60_000,
  turnTtlSeconds: 86_400,
  /** Largest binary (Yjs) frame a socket may send. The room's whole first filling (seeding) is
   * one frame, so it must fit. (Cloudflare takes up to 32 MiB.) */
  maxBinaryBytes: 16 << 20,
  /** Largest text (JSON) frame a socket may send. */
  maxTextBytes: 256 * 1024,
  /** Largest HTTP body the API reads (SDP offers and answers). */
  maxBodyBytes: 256 * 1024,
  /** Tracks in one publish call, and in one receive, layer or close call. */
  maxPublishTracks: 4,
  maxTracksPerCall: 64,
} as const;

/** The first varUint of a binary frame. */
export const FRAME = { sync: 0, awareness: 1 } as const;

/** Where things live in the room's Y.Doc. */
export const YDOC = {
  /** Y.Map: `seeded: true` once the room has been filled. */
  room: 'room',
  /** Y.Map: id → Y.Map{kind, title, sort, lang?, stdin?, header?}. */
  documents: 'documents',
  /** Y.Array<Y.Map{id, body, pinned}>. */
  notes: 'notes',
  /** Y.Array<Y.Map{id, title, due_on, done}>. */
  tasks: 'tasks',
  /** Y.XmlFragment: a TipTap document. */
  doc: (id: string) => `doc/${id}`,
  /** Y.Text: a code document's text. */
  code: (id: string) => `code/${id}`,
  /** Y.Array<Y.Array<string>>: a sheet's rows of cells. */
  sheet: (id: string) => `sheet/${id}`,
} as const;

/** WebSocket close codes the server uses. */
export const CLOSE = {
  normal: 1000,
  tooBig: 1009,
  /** The ticket was missing, used or out of date: get a new one. */
  badTicket: 4001,
  /** A host took this person out of the room. */
  removed: 4003,
  /** The room already has max_people people. */
  full: 4009,
  /** The room has ended. */
  ended: 4010,
  /** The socket sent something that isn't the room protocol. */
  protocol: 4400,
} as const;

// ── People and what the room shows ──────────────────────────────────────

export interface PersonRef {
  userId: string;
  name: string;
}

export interface Person extends PersonRef {
  role: Role;
  canEdit: boolean;
  hand: boolean;
  connected: boolean;
}

export interface Publication {
  userId: string;
  sessionId: string;
  trackName: string;
  kind: TrackKind;
  /** Simulcast layers it was published with ([] for audio). */
  rids: Rid[];
}

export interface ChatMessage {
  id: string;
  from: PersonRef;
  text: string;
  /** Epoch milliseconds. */
  at: number;
}

/** One question to Chip and its answer, as the asker's screen relays it. */
export interface ChipEntry {
  id: string;
  from: PersonRef;
  question: string;
  /** The answer so far (the whole of it, not a piece). */
  answer: string;
  done: boolean;
  /** The asker left before Chip finished. */
  stopped?: boolean;
  at: number;
}

/** What a client puts in its awareness state. The server overwrites `id` and `name` with the
 * verified person before relaying it, so `user.id` can be trusted to find them in `people`. */
export interface AwarenessUser {
  id: string;
  name: string;
  color: string;
}

// ── The room socket ─────────────────────────────────────────────────────

export type EndedWhy = 'host' | 'time' | 'removed';

export type SocketErrorCode =
  | 'bad_message' // not JSON, or not a message the server knows
  | 'bad_frame' // a binary frame that isn't sync or awareness
  | 'too_long' // chat over 2,000 characters, or a frame over the limit
  | 'rate_limited'
  | 'not_allowed' // a host-only message from someone else
  | 'not_yours' // a chip-chunk or chip-done for someone else's question
  | 'not_seeded' // {t: "seeded"} before room.seeded is true
  | 'already_seeded' // an update filled a room that was already filled: dropped; start a fresh Y.Doc
  | 'still_live' // {t: "end"} while the database says the room is live (call study_room_end first)
  | 'perm_failed' // the roster couldn't be read; try again
  | 'bad_ticket'
  | 'room_full'
  | 'removed'
  | 'ended';

export type ServerMessage =
  | {
      t: 'hello';
      you: { userId: string; name: string; role: Role; canEdit: boolean };
      people: Person[];
      publications: Publication[];
      chat: ChatMessage[];
      chip: ChipEntry[];
      hands: string[];
      /** Epoch milliseconds, or null when the room has no time limit. */
      endsAt: number | null;
      editMode: EditMode;
      seeded: boolean;
    }
  | { t: 'people'; people: Person[] }
  | { t: 'you'; canEdit: boolean; role: Role }
  | { t: 'pubs'; publications: Publication[] }
  | ({ t: 'chat' } & ChatMessage)
  | { t: 'hand'; userId: string; up: boolean }
  | ({ t: 'chip' } & ChipEntry)
  | { t: 'mute-request'; by: string }
  | { t: 'readonly' }
  | { t: 'seed' }
  | { t: 'ending'; at: number }
  | { t: 'ended'; why: EndedWhy }
  | { t: 'error'; code: SocketErrorCode };

export type ClientMessage =
  | { t: 'chat'; text: string }
  | { t: 'hand'; up: boolean }
  | { t: 'perm' }
  | { t: 'mute-all' }
  | { t: 'end' }
  | { t: 'seeded' }
  | { t: 'chip-ask'; id: string; text: string }
  | { t: 'chip-chunk'; id: string; text: string }
  | { t: 'chip-done'; id: string; text: string };

/** A chip message id: what the asker's screen makes up for a question. */
export const CHIP_ID = /^[A-Za-z0-9_-]{1,64}$/;

// ── The HTTP API (/api/rooms/:roomId/...) ───────────────────────────────

export type ApiErrorCode =
  | 'unauthorized' // 401: no sign-in, or it has expired
  | 'not_in_room' // 403: not a member, waiting to be let in, or removed (see `state`)
  | 'ended' // 410: the room has ended
  | 'room_full' // 409
  | 'not_found' // 404: no such route, or a room id that isn't a UUID
  | 'bad_request' // 400 (see `detail`)
  | 'method_not_allowed' // 405
  | 'too_big' // 413
  | 'rate_limited' // 429
  | 'not_your_session' // 403: an SFU session that isn't the caller's (or doesn't exist)
  | 'not_your_track' // 403: publishing a track name that isn't <your user id>:<kind>
  | 'not_connected' // 409: open the room socket before making SFU sessions, publishing or receiving
  | 'unknown_publication' // 404: a publication that isn't in this room (any more)
  | 'unknown_track' // 404: a received track (mid) the server doesn't know on that session
  | 'sfu_rejected' // 409: the SFU refused the request (see `code`)
  | 'sfu_error' // 502: the SFU failed or couldn't be reached
  | 'upstream' // 502: the database couldn't be reached
  | 'not_configured' // 503: the room server's settings aren't filled in yet
  | 'internal'; // 500

export interface ApiError {
  error: ApiErrorCode;
  detail?: string;
  /** For not_in_room: the caller's state in the room ('waiting' or 'removed'). */
  state?: string;
  /** For sfu_rejected and sfu_error: the SFU's errorCode. */
  code?: string;
}

export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface TicketAnswer {
  ticket: string;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface TurnAnswer {
  iceServers: IceServer[];
}

export interface SessionRequest {
  purpose: SessionPurpose;
}

export interface SessionAnswer {
  sessionId: string;
}

export interface PublishTrack {
  mid: string;
  trackName: string;
  kind: TrackKind;
  rids?: Rid[];
}

export interface PublishRequest {
  sessionId: string;
  offer: SessionDescription;
  tracks: PublishTrack[];
}

/** One track's result: no errorCode means it worked. */
export interface TrackResult {
  mid?: string;
  trackName?: string;
  errorCode?: string;
  errorDescription?: string;
}

export interface PublishAnswer {
  answer: SessionDescription;
  tracks: TrackResult[];
}

export interface ReceiveTrack {
  publisherSessionId: string;
  trackName: string;
  /** For a layered publication: the layer wanted (default `q`). */
  rid?: Rid;
}

export interface ReceiveRequest {
  sessionId: string;
  tracks: ReceiveTrack[];
}

export interface ReceiveResult extends TrackResult {
  publisherSessionId: string;
  trackName: string;
}

export interface ReceiveAnswer {
  offer?: SessionDescription;
  requiresImmediateRenegotiation: boolean;
  tracks: ReceiveResult[];
}

export interface RenegotiateRequest {
  sessionId: string;
  answer: SessionDescription;
}

export interface LayerRequest {
  sessionId: string;
  tracks: { mid: string; rid: Rid }[];
}

export interface LayerAnswer {
  tracks: TrackResult[];
}

export interface CloseRequest {
  sessionId: string;
  offer: SessionDescription;
  tracks: { mid: string }[];
}

export interface CloseAnswer {
  answer: SessionDescription;
  tracks: TrackResult[];
}
