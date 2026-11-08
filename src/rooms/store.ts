import { create } from 'zustand';
import type { ChatMessage, ChipEntry, EditMode, EndedWhy, Person, Publication, Role } from '../../shared/rooms.ts';
import type { RoomInfo, RoomTutor } from './api.ts';
import type { MediaState } from './media.ts';

/** What a room screen shows, kept as the room socket and media tell it. */

export type RoomPanel = 'people' | 'chat' | 'chip' | 'tasks' | 'notes' | 'brief';
export type Connection = 'connecting' | 'live' | 'reconnecting';
/** Why someone is no longer in the room. */
export type RoomEnd = EndedWhy | 'full' | 'unavailable' | 'signed_out' | 'not_in_room' | 'waiting' | 'left';

export interface You {
  userId: string;
  name: string;
  role: Role;
  canEdit: boolean;
}

/** A Chip entry as this screen shows it: the asker's own screen also knows the database's id for
 * Chip's message (for the AI-use record) and why Chip couldn't answer. */
export interface ShownChip extends ChipEntry {
  messageId?: string | null;
  problem?: string;
  /** Still streaming on this screen (the asker's). */
  local?: boolean;
}

interface RoomState {
  roomId: string | null;
  token: string;
  title: string;
  hostName: string;
  classRoom: boolean;
  connection: Connection;
  online: boolean;
  you: You | null;
  people: Person[];
  hands: string[];
  pubs: Publication[];
  chat: ChatMessage[];
  unreadChat: number;
  chip: ShownChip[];
  unreadChip: number;
  endsAt: number | null;
  /** The five-minute warning has come. */
  ending: boolean;
  editMode: EditMode;
  seeded: boolean;
  /** A change of yours was dropped (you can't edit): said once. */
  readonlyNotice: boolean;
  ended: RoomEnd | null;
  panel: RoomPanel | null;
  /** What fills the middle when someone's on the stage. */
  view: 'work' | 'stage';
  /** Someone pinned to the stage on this screen. */
  pinned: string | null;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  /** Your camera and microphone tracks, for your own tile. */
  localVideo: MediaStreamTrack | null;
  localAudio: MediaStreamTrack | null;
  media: MediaState;
  /** Received tracks changed (tiles look again). */
  trackVersion: number;
  /** Who is speaking now (user IDs), and who spoke last. */
  speaking: string[];
  activeSpeaker: string | null;
  /** The shared document was started afresh this many times (editors are made again). */
  docGeneration: number;
  /** For hosts and co-hosts: the room as the database has it (settings, who's waiting). */
  manage: RoomInfo | null;
  tutor: RoomTutor | null;
  speaker: string | null;
  /** The browser wouldn't play the room's sound without a tap (Safari, mostly). */
  audioBlocked: boolean;
}

const initial: RoomState = {
  roomId: null,
  token: '',
  title: '',
  hostName: '',
  classRoom: false,
  connection: 'connecting',
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  you: null,
  people: [],
  hands: [],
  pubs: [],
  chat: [],
  unreadChat: 0,
  chip: [],
  unreadChip: 0,
  endsAt: null,
  ending: false,
  editMode: 'everyone',
  seeded: false,
  readonlyNotice: false,
  ended: null,
  panel: null,
  view: 'work',
  pinned: null,
  mic: false,
  cam: false,
  screen: false,
  localVideo: null,
  localAudio: null,
  media: 'idle',
  trackVersion: 0,
  speaking: [],
  activeSpeaker: null,
  docGeneration: 0,
  manage: null,
  tutor: null,
  speaker: null,
  audioBlocked: false,
};

export const useRoom = create<RoomState & { reset: () => void }>((set) => ({
  ...initial,
  reset: () => set(initial),
}));

/** Opens [panel], or closes it if it's open; reading a panel clears its unread count. */
export function togglePanel(panel: RoomPanel) {
  const s = useRoom.getState();
  const next = s.panel === panel ? null : panel;
  useRoom.setState({ panel: next, ...(next === 'chat' ? { unreadChat: 0 } : {}), ...(next === 'chip' ? { unreadChip: 0 } : {}) });
}

export function openPanel(panel: RoomPanel | null) {
  useRoom.setState({ panel, ...(panel === 'chat' ? { unreadChat: 0 } : {}), ...(panel === 'chip' ? { unreadChip: 0 } : {}) });
}
