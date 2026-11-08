import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import * as Y from 'yjs';
import { YDOC, type ChipEntry, type Role, type ServerMessage, type TrackKind } from '../../shared/rooms.ts';
import { modelFor } from '../lib/allowance.ts';
import { askChip, ChipRefused } from '../lib/chip.ts';
import { supabase } from '../lib/supabase.ts';
import type { Assignment, Mode, Note, Source, StudyDocument, Task } from '../lib/types.ts';
import { useAuth } from '../store/auth.ts';
import { usePrefs } from '../store/prefs.ts';
import { toast } from '../store/toast.ts';
import { extensions } from '../workspace/extensions.ts';
import { editors, useWorkspace } from '../workspace/store.ts';
import { endRoom, getRoom, roomServer, roomTutor, roomWorkspace, socketUrl, type RoomWorkspace } from './api.ts';
import { getCamera, getMic, getScreen, levelMeter, problemOf, problemText, saveChoice, type DeviceChoice } from './devices.ts';
import { MediaClient } from './media.ts';
import { isManager } from './people.ts';
import { ChipRelay, newChipId } from './relay.ts';
import { isSeeded, seedRoom } from './seed.ts';
import { RoomSocket } from './socket.ts';
import { useRoom, type RoomEnd, type ShownChip } from './store.ts';
import { YRoom } from './ysync.ts';

/** One visit to a room: the socket, the shared document, media, the shared Chip and the people,
 * kept in the room store for the screens. Made when someone enters, stopped when they leave. */

export interface StartOptions {
  roomId: string;
  token: string;
  title: string;
  hostName: string;
  classRoom: boolean;
  me: { id: string; name: string };
  role: Role;
  canEdit: boolean;
  mic: MediaStreamTrack | null;
  micOn: boolean;
  cam: MediaStreamTrack | null;
  camOn: boolean;
  devices: DeviceChoice;
}

let current: RoomSession | null = null;
/** The room this screen is in now, if any. */
export const roomSession = (): RoomSession | null => current;

let schema: Schema | null = null;
const editorSchema = () => (schema ??= getSchema(extensions({ onMath: () => {}, shared: true })));

const SPEAKING = 0.035;
const LOCAL_SPEAKING = 0.09;
const HOLD_MS = 700;

export class RoomSession {
  readonly socket: RoomSocket;
  readonly y: YRoom;
  readonly media: MediaClient;
  readonly relay: ChipRelay;
  workspace: RoomWorkspace | null = null;
  devices: DeviceChoice;

  private helloSeeded = false;
  private started = false;
  private mediaStarted = false;
  private stopped = false;
  private seeding = false;
  private unwatch: (() => void)[] = [];
  private manageTimer: ReturnType<typeof setInterval> | null = null;
  private speakTimer: ReturnType<typeof setInterval> | null = null;
  private meter: { level: () => number; stop: () => void } | null = null;
  private heard = new Map<string, number>();
  private asking = new Map<string, AbortController>();
  private permTries = 0;
  private endTries = 0;
  private waitingSeen = new Set<string>();
  private screenTracks: { video: MediaStreamTrack; audio: MediaStreamTrack | null } | null = null;

  constructor(private o: StartOptions) {
    this.devices = o.devices;
    const server = roomServer(o.roomId);
    this.socket = new RoomSocket({
      ticket: server.ticket,
      url: (t) => socketUrl(o.roomId, t),
      refreshSignIn: async () => !!(await supabase.auth.refreshSession()).data.session,
    });
    this.y = new YRoom((bytes) => this.socket.sendBytes(bytes), { id: o.me.id, name: o.me.name, color: '#6457f0' }, o.canEdit);
    this.media = new MediaClient(server, o.me.id);
    this.relay = new ChipRelay((m) => this.socket.send(m));
    useRoom.setState({
      roomId: o.roomId,
      token: o.token,
      title: o.title,
      hostName: o.hostName,
      classRoom: o.classRoom,
      you: { userId: o.me.id, name: o.me.name, role: o.role, canEdit: o.canEdit },
      connection: 'connecting',
      mic: o.micOn && !!o.mic,
      cam: o.camOn && !!o.cam,
      localAudio: o.mic,
      localVideo: o.camOn ? o.cam : null,
    });
    if (o.mic) o.mic.enabled = o.micOn;
    if (o.cam && !o.camOn) o.cam.stop();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // The room this screen is in, for the screens to reach.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    current = this;
    this.socket.onOpen = (away) => {
      this.y.opened();
      this.media.socketBack(away);
    };
    this.socket.onBinary = (bytes) => {
      this.y.receive(bytes);
      if (this.y.freshOnSocket >= 3) this.socket.reconnect();
    };
    this.socket.onMessage = (m) => this.onMessage(m);
    this.socket.onEnd = (why) => this.finish(why === 'ended' ? this.endedWhy() : why);
    this.socket.onState = (s) => {
      if (s !== 'open') this.y.closed();
      useRoom.setState({ connection: s === 'open' ? 'live' : s === 'connecting' ? 'connecting' : 'reconnecting' });
    };

    this.y.onReset = () => {
      this.watchDoc();
      useRoom.setState((s) => ({ docGeneration: s.docGeneration + 1 }));
    };
    this.watchDoc();

    this.media.onState = (state) => useRoom.setState({ media: state });
    this.media.onTrack = () => useRoom.setState((s) => ({ trackVersion: s.trackVersion + 1 }));
    this.media.onTrackFailed = () => useRoom.setState((s) => ({ trackVersion: s.trackVersion + 1 }));
    this.media.onPublishFailed = (kind) => {
      if (this.stopped) return;
      toast(
        kind === 'audio'
          ? 'Your microphone couldn’t connect. Trying again helps.'
          : kind === 'video'
            ? 'Your camera couldn’t connect. Try turning it off and on.'
            : 'Your screen couldn’t be shared. Try again.',
        'warn',
      );
    };

    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOnline);
    this.speakTimer = setInterval(() => this.listen(), 250);
    if (useRoom.getState().mic && this.o.mic) this.meter = levelMeter(this.o.mic);
    this.socket.start();
  }

  private onOnline = () => useRoom.setState({ online: navigator.onLine !== false });

  private endedWhy(): RoomEnd {
    const s = useRoom.getState();
    if (s.ended) return s.ended;
    return s.endsAt !== null && s.endsAt <= Date.now() + 5000 ? 'time' : 'host';
  }

  // ── The room socket ───────────────────────────────────────────────────

  private onMessage(m: ServerMessage): void {
    const s = useRoom.getState();
    switch (m.t) {
      case 'hello': {
        this.helloSeeded = m.seeded;
        useRoom.setState({
          you: m.you,
          people: m.people,
          pubs: m.publications,
          chat: m.chat,
          chip: this.mergeChip(m.chip),
          hands: m.hands,
          endsAt: m.endsAt,
          ending: m.endsAt !== null && m.endsAt - Date.now() <= 5 * 60_000,
          editMode: m.editMode,
          seeded: m.seeded || isSeeded(this.y.doc),
        });
        this.y.setUser({ id: m.you.userId, name: m.you.name, color: '#6457f0' });
        this.y.setCanEdit(m.you.canEdit);
        // Also notices a session the server has forgotten (after a sleep, say).
        this.media.hello(m.publications);
        void this.firstHello();
        return;
      }
      case 'people':
        useRoom.setState({ people: m.people });
        return;
      case 'you': {
        const was = s.you;
        useRoom.setState({ you: s.you ? { ...s.you, canEdit: m.canEdit, role: m.role } : s.you });
        if (was && was.canEdit !== m.canEdit) toast(m.canEdit ? 'You can edit the work now.' : 'A host stopped your editing. You can still follow along.', 'info');
        if (was && was.role !== m.role && m.role === 'cohost') toast('You’re a co-host now.', 'good');
        this.y.setCanEdit(m.canEdit);
        if (isManager(m.role)) this.startManaging();
        else this.stopManaging();
        return;
      }
      case 'pubs': {
        const sharing = m.publications.find((p) => p.kind === 'screen' && p.userId !== s.you?.userId);
        const before = s.pubs.find((p) => p.kind === 'screen' && p.userId !== s.you?.userId);
        useRoom.setState({ pubs: m.publications, ...(sharing && !before ? { view: 'stage' as const } : {}) });
        if (sharing && !before) toast(`${this.nameOf(sharing.userId) ?? 'Someone'} is sharing their screen.`, 'info');
        this.media.setPubs(m.publications);
        return;
      }
      case 'chat': {
        if (s.chat.some((c) => c.id === m.id)) return;
        const { t: _t, ...msg } = m;
        const mine = m.from.userId === s.you?.userId;
        useRoom.setState({ chat: [...s.chat, msg].slice(-200), unreadChat: s.panel === 'chat' || mine ? s.unreadChat : s.unreadChat + 1 });
        return;
      }
      case 'hand':
        useRoom.setState({ hands: m.up ? [...new Set([...s.hands, m.userId])] : s.hands.filter((h) => h !== m.userId) });
        if (m.up && m.userId !== s.you?.userId && isManager(s.you?.role)) toast(`${this.nameOf(m.userId) ?? 'Someone'} raised their hand.`, 'info');
        return;
      case 'chip': {
        const { t: _t, ...entry } = m;
        const had = s.chip.find((c) => c.id === entry.id);
        // The asker's own screen has the newer text while it streams.
        if (had?.local && !entry.done) return;
        const next = had ? s.chip.map((c) => (c.id === entry.id ? { ...c, ...entry, local: false } : c)) : [...s.chip, entry];
        const newQuestion = !had && entry.from.userId !== s.you?.userId;
        useRoom.setState({ chip: next.slice(-50), unreadChip: newQuestion && s.panel !== 'chip' ? s.unreadChip + 1 : s.unreadChip });
        return;
      }
      case 'mute-request':
        if (useRoom.getState().mic) {
          void this.setMic(false);
          toast(`${this.nameOf(m.by) ?? 'A host'} muted everyone. Unmute when you want to speak.`, 'info');
        }
        return;
      case 'readonly':
        this.y.fresh();
        useRoom.setState({ readonlyNotice: true });
        return;
      case 'seed':
        void this.seed();
        return;
      case 'ending':
        useRoom.setState({ ending: true, endsAt: m.at });
        return;
      case 'ended':
        this.finish(m.why);
        return;
      case 'error':
        this.onError(m.code);
        return;
    }
  }

  private onError(code: Extract<ServerMessage, { t: 'error' }>['code']) {
    switch (code) {
      case 'already_seeded':
        this.y.fresh();
        return;
      case 'rate_limited':
        toast('That’s a lot at once. Give it a moment.', 'info');
        return;
      case 'too_long':
        toast('That’s too long to send.', 'warn');
        return;
      case 'perm_failed':
        if (this.permTries++ < 3) setTimeout(() => this.socket.send({ t: 'perm' }), 1500 * this.permTries);
        else toast('The room couldn’t take that change just now. Try again.', 'warn');
        return;
      case 'still_live':
        if (this.endTries++ < 3) setTimeout(() => this.socket.send({ t: 'end' }), 800 * this.endTries);
        return;
      default:
        return;
    }
  }

  private mergeChip(entries: ChipEntry[]): ShownChip[] {
    const local = useRoom.getState().chip.filter((c) => c.local);
    const out: ShownChip[] = entries.map((e) => local.find((l) => l.id === e.id && !e.done) ?? e);
    for (const l of local) if (!out.some((e) => e.id === l.id)) out.push(l);
    return out;
  }

  nameOf(userId: string): string | undefined {
    const s = useRoom.getState();
    return s.people.find((p) => p.userId === userId)?.name ?? (s.you?.userId === userId ? s.you.name : undefined);
  }

  /** The first hello: the shared work's details, the course's guidance, and media. */
  private async firstHello() {
    if (this.mediaStarted) return;
    this.mediaStarted = true;
    const s = useRoom.getState();
    if (isManager(s.you?.role)) this.startManaging();
    void roomTutor(this.o.roomId)
      .then((tutor) => useRoom.setState({ tutor }))
      .catch(() => undefined);
    void this.loadWorkspace();
    try {
      await this.media.start();
    } catch {
      // Media says why in its state; the room works without it.
    }
    const now = useRoom.getState();
    if (now.mic && this.o.mic) await this.media.publish('audio', this.o.mic);
    if (now.cam && now.localVideo) await this.media.publish('video', now.localVideo);
  }

  private async loadWorkspace(): Promise<RoomWorkspace | null> {
    if (this.workspace) return this.workspace;
    try {
      const w = await roomWorkspace(this.o.roomId);
      this.workspace = w;
      const a = w.assignment;
      const assignment: Assignment = {
        id: a.id,
        user_id: '',
        title: a.title,
        course: a.course ?? '',
        brief: a.brief ?? '',
        rubric: a.rubric ?? '',
        due_at: a.due_at,
        word_target: a.word_target,
        style: (a.style === 'harvard' ? 'harvard' : 'apa') as Assignment['style'],
        status: 'active',
        color: (a.color || 'sky') as Assignment['color'],
        kind: a.kind === 'topic' ? 'topic' : 'assignment',
        words: 0,
        focus_minutes: 0,
        class_id: null,
        created_at: '',
        updated_at: '',
      };
      const sources = w.sources.map(
        (x) => ({ id: x.id, assignment_id: a.id, kind: x.kind, data: x.data, note: x.note ?? '', content: '', file_name: x.file_name, created_by: 'me', created_at: '' }) as Source,
      );
      useWorkspace.setState({ assignment, sources, room: this.o.roomId });
      document.title = `${a.title} · Study room · Chip Study`;
      return w;
    } catch {
      return null;
    }
  }

  /** Asked to fill the empty room (docs/rooms.md, "Seeding"). */
  private async seed() {
    if (!this.y.editable || this.seeding) return;
    this.seeding = true;
    try {
      const w = await this.loadWorkspace();
      if (!w) throw new Error('no workspace');
      // Someone asked earlier may have finished meanwhile: seedRoom checks room.seeded first.
      if (seedRoom(this.y.doc, w, editorSchema())) this.socket.send({ t: 'seeded' });
    } catch {
      toast('Couldn’t load the shared work just now. Someone else will be asked.', 'warn');
    } finally {
      this.seeding = false;
    }
  }

  // ── The shared document, mirrored into the workspace ───────────────────

  private watchDoc() {
    for (const stop of this.unwatch) stop();
    this.unwatch = [];
    const doc = this.y.doc;
    const documents = doc.getMap(YDOC.documents);
    const notes = doc.getArray<Y.Map<unknown>>(YDOC.notes);
    const tasks = doc.getArray<Y.Map<unknown>>(YDOC.tasks);
    const room = doc.getMap(YDOC.room);
    const assignmentId = () => useWorkspace.getState().assignment?.id ?? '';

    const showDocs = () => {
      const list: StudyDocument[] = [];
      documents.forEach((m, id) => {
        if (!(m instanceof Y.Map)) return;
        const kind = m.get('kind');
        if (kind !== 'doc' && kind !== 'code' && kind !== 'sheet') return;
        list.push({
          id,
          assignment_id: assignmentId(),
          user_id: '',
          kind,
          title: String(m.get('title') ?? ''),
          content: kind === 'code' ? { lang: m.get('lang'), stdin: m.get('stdin') } : kind === 'sheet' ? { header: m.get('header') } : {},
          text: '',
          words: 0,
          chip_words: 0,
          version: 0,
          sort: Number(m.get('sort') ?? 0),
          created_at: '',
          updated_at: '',
        });
      });
      list.sort((x, z) => x.sort - z.sort || x.id.localeCompare(z.id));
      const ws = useWorkspace.getState();
      const active = list.some((d) => d.id === ws.activeDoc) ? ws.activeDoc : ((list.find((d) => d.kind === 'doc') ?? list[0])?.id ?? null);
      useWorkspace.setState({ docs: list, activeDoc: active });
    };
    const showNotes = () =>
      useWorkspace.setState({
        notes: notes
          .toArray()
          .filter((m): m is Y.Map<unknown> => m instanceof Y.Map)
          .map(
            (m) =>
              ({ id: String(m.get('id') ?? ''), assignment_id: assignmentId(), body: String(m.get('body') ?? ''), pinned: m.get('pinned') === true, created_at: '', updated_at: '' }) satisfies Note,
          ),
      });
    const showTasks = () =>
      useWorkspace.setState({
        tasks: tasks
          .toArray()
          .filter((m): m is Y.Map<unknown> => m instanceof Y.Map)
          .map(
            (m, i) =>
              ({
                id: String(m.get('id') ?? ''),
                assignment_id: assignmentId(),
                title: String(m.get('title') ?? ''),
                due_on: (m.get('due_on') as string | null) ?? null,
                done: m.get('done') === true,
                done_at: null,
                sort: i,
                created_by: 'me',
                created_at: '',
              }) satisfies Task,
          ),
      });
    const showSeeded = () => useRoom.setState({ seeded: this.helloSeeded || isSeeded(doc) });

    documents.observeDeep(showDocs);
    notes.observeDeep(showNotes);
    tasks.observeDeep(showTasks);
    room.observe(showSeeded);
    this.unwatch.push(
      () => documents.unobserveDeep(showDocs),
      () => notes.unobserveDeep(showNotes),
      () => tasks.unobserveDeep(showTasks),
      () => room.unobserve(showSeeded),
    );
    showDocs();
    showNotes();
    showTasks();
    showSeeded();
  }

  /** Adds a document tab to the shared work (editors only). */
  addDocument(kind: 'doc' | 'code' | 'sheet', title: string, lang?: string, code = ''): string | null {
    if (!this.y.editable) return null;
    const doc = this.y.doc;
    const id = crypto.randomUUID();
    const documents = doc.getMap(YDOC.documents);
    const sort = Math.max(-1, ...[...documents.values()].map((m) => (m instanceof Y.Map ? Number(m.get('sort') ?? 0) : 0))) + 1;
    doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('kind', kind);
      m.set('title', title);
      m.set('sort', sort);
      if (kind === 'code' && lang) m.set('lang', lang);
      if (kind === 'code' && code) doc.getText(YDOC.code(id)).insert(0, code);
      if (kind === 'sheet') {
        m.set('header', true);
        const rows = doc.getArray<Y.Array<string>>(YDOC.sheet(id));
        for (let r = 0; r < 8; r++) {
          const row = new Y.Array<string>();
          row.push(['', '', '', '', '']);
          rows.push([row]);
        }
      }
      if (kind === 'doc') {
        const p = new Y.XmlElement('paragraph');
        doc.getXmlFragment(YDOC.doc(id)).insert(0, [p]);
      }
      documents.set(id, m);
    });
    useWorkspace.setState({ activeDoc: id, selection: '' });
    return id;
  }

  // ── Your microphone, camera and screen ────────────────────────────────

  async setMic(on: boolean): Promise<boolean> {
    if (on) {
      let track = this.o.mic && this.o.mic.readyState === 'live' ? this.o.mic : null;
      if (!track) {
        try {
          track = await getMic(this.devices.mic);
        } catch (e) {
          if (this.stopped) return false;
          const p = problemText(problemOf(e), 'microphone');
          toast(`${p.title}. ${p.body}`, 'warn');
          return false;
        }
        // Left while the browser was asking: the microphone goes straight off again.
        if (this.stopped) {
          track.stop();
          return false;
        }
        this.o.mic = track;
      }
      track.enabled = true;
      this.meter?.stop();
      this.meter = levelMeter(track);
      useRoom.setState({ mic: true, localAudio: track });
      await this.media.publish('audio', track);
      return true;
    }
    if (this.o.mic) this.o.mic.enabled = false;
    useRoom.setState({ mic: false });
    await this.media.unpublish('audio');
    return true;
  }

  async setCam(on: boolean): Promise<boolean> {
    if (on) {
      let track: MediaStreamTrack;
      try {
        track = await getCamera(this.devices.camera);
      } catch (e) {
        if (this.stopped) return false;
        const p = problemText(problemOf(e), 'camera');
        toast(`${p.title}. ${p.body}`, 'warn');
        return false;
      }
      if (this.stopped) {
        track.stop();
        return false;
      }
      this.o.cam = track;
      useRoom.setState({ cam: true, localVideo: track });
      await this.media.publish('video', track);
      return true;
    }
    const track = useRoom.getState().localVideo;
    useRoom.setState({ cam: false, localVideo: null });
    await this.media.unpublish('video');
    track?.stop();
    return true;
  }

  async setScreen(on: boolean): Promise<void> {
    if (on) {
      let got: { video: MediaStreamTrack; audio: MediaStreamTrack | null };
      try {
        got = await getScreen();
      } catch (e) {
        if (!this.stopped && problemOf(e) !== 'denied') toast('Your screen couldn’t be shared. Try again.', 'warn');
        return;
      }
      if (this.stopped) {
        got.video.stop();
        got.audio?.stop();
        return;
      }
      this.screenTracks = got;
      got.video.addEventListener('ended', () => void this.setScreen(false));
      useRoom.setState({ screen: true, view: 'stage', pinned: null });
      await this.media.publish('screen', got.video);
      if (got.audio) await this.media.publish('screen-audio', got.audio);
      return;
    }
    const t = this.screenTracks;
    this.screenTracks = null;
    useRoom.setState({ screen: false });
    await this.media.unpublish('screen');
    await this.media.unpublish('screen-audio');
    t?.video.stop();
    t?.audio?.stop();
  }

  /** Your own screen share, to show you what everyone sees. */
  screenTrack(): MediaStreamTrack | null {
    return this.screenTracks?.video ?? null;
  }

  async setDevice(kind: 'camera' | 'mic' | 'speaker', deviceId: string): Promise<void> {
    this.devices = { ...this.devices, [kind]: deviceId };
    saveChoice(this.devices);
    if (kind === 'speaker') {
      useRoom.setState({ speaker: deviceId });
      return;
    }
    const s = useRoom.getState();
    try {
      if (kind === 'mic') {
        const track = await getMic(deviceId);
        if (this.stopped) return track.stop();
        const old = this.o.mic;
        track.enabled = s.mic;
        this.o.mic = track;
        useRoom.setState({ localAudio: track });
        if (s.mic) {
          this.meter?.stop();
          this.meter = levelMeter(track);
          await this.media.publish('audio', track);
        }
        old?.stop();
      } else if (s.cam) {
        const track = await getCamera(deviceId);
        if (this.stopped) return track.stop();
        const old = s.localVideo;
        this.o.cam = track;
        useRoom.setState({ localVideo: track });
        await this.media.publish('video', track);
        old?.stop();
      }
    } catch (e) {
      const p = problemText(problemOf(e), kind === 'mic' ? 'microphone' : 'camera');
      toast(`${p.title}. ${p.body}`, 'warn');
    }
  }

  /** Who's speaking: received audio levels, and your microphone's. */
  private listen() {
    const s = useRoom.getState();
    const now = Date.now();
    for (const { trackName, receiver } of this.media.receivers()) {
      if (!trackName.endsWith(':audio')) continue;
      const level = (receiver as RTCRtpReceiver & { getSynchronizationSources?: () => { audioLevel?: number }[] }).getSynchronizationSources?.()[0]?.audioLevel ?? 0;
      if (level > SPEAKING) this.heard.set(trackName.split(':')[0], now);
    }
    if (s.mic && this.meter && s.you && this.meter.level() > LOCAL_SPEAKING) this.heard.set(s.you.userId, now);
    const speaking = [...this.heard]
      .filter(([, at]) => now - at < HOLD_MS)
      .map(([id]) => id)
      .sort();
    const loudest = speaking.filter((id) => id !== s.you?.userId).sort((a, b) => (this.heard.get(b) ?? 0) - (this.heard.get(a) ?? 0))[0] ?? s.activeSpeaker;
    if (speaking.join() !== s.speaking.join() || loudest !== s.activeSpeaker) useRoom.setState({ speaking, activeSpeaker: loudest });
  }

  // ── Talking ───────────────────────────────────────────────────────────

  sendChat(text: string): boolean {
    const t = text.trim();
    if (!t) return false;
    if (!this.socket.send({ t: 'chat', text: t.slice(0, 2000) })) {
      toast('Reconnecting… try again in a moment.', 'info');
      return false;
    }
    return true;
  }

  setHand(up: boolean): void {
    if (!this.socket.send({ t: 'hand', up })) toast('Reconnecting… try again in a moment.', 'info');
  }

  muteAll(): void {
    if (this.socket.send({ t: 'mute-all' })) toast('Everyone else is muted. They can unmute themselves.', 'info');
  }

  // ── The shared Chip ───────────────────────────────────────────────────

  /** Asks the room's Chip: the answer streams here from the chip-study function and is relayed
   * to everyone on the socket (docs/rooms.md, "Chip in a room"). */
  async askChip(mode: Mode, text: string, selection?: string): Promise<void> {
    const s = useRoom.getState();
    const q = text.trim();
    if (!q || !s.you) return;
    if (!this.socket.open) {
      toast('Reconnecting… ask again in a moment.', 'info');
      return;
    }
    if ([...this.asking.keys()].length) {
      toast('Chip is still answering your last question.', 'info');
      return;
    }
    const id = newChipId();
    const me = useAuth.getState().me;
    const model = modelFor(me, usePrefs.getState().model);
    const entry: ShownChip = { id, from: { userId: s.you.userId, name: s.you.name }, question: q.slice(0, 4000), answer: '', done: false, at: Date.now(), local: true };
    useRoom.setState((st) => ({ chip: [...st.chip, entry].slice(-50), panel: st.panel ?? 'chip' }));
    this.relay.ask(id, entry.question);
    const abort = new AbortController();
    this.asking.set(id, abort);
    let answer = '';
    let messageId: string | null = null;
    let problem = '';
    let frame = 0;
    const show = () => {
      frame = 0;
      useRoom.setState((st) => ({ chip: st.chip.map((c) => (c.id === id ? { ...c, answer } : c)) }));
    };
    try {
      await askChip(
        { room: this.o.roomId, mode, text: entry.question, selection: selection || undefined, doc: editors.text().slice(-120000), model },
        (e) => {
          if (e.t === 'text') {
            answer += e.text;
            this.relay.chunk(id, answer);
            if (!frame) frame = requestAnimationFrame(show);
          } else if (e.t === 'done') messageId = e.message;
          else if (e.t === 'refusal') problem = 'Chip can’t help with that one. Try asking another way.';
          else if (e.t === 'error') problem = e.error;
        },
        abort.signal,
      );
    } catch (err) {
      if (!abort.signal.aborted) problem = err instanceof ChipRefused ? err.message : (err as Error).message || 'Chip couldn’t think just now.';
    } finally {
      if (frame) cancelAnimationFrame(frame);
      this.asking.delete(id);
      const stopped = abort.signal.aborted;
      const final = answer || (problem ? 'Chip couldn’t answer this one.' : '');
      this.relay.done(id, final);
      useRoom.setState((st) => ({
        chip: st.chip.map((c) => (c.id === id ? { ...c, answer: final, done: true, local: false, messageId, problem: problem || undefined, stopped: stopped || undefined } : c)),
      }));
      void useAuth.getState().refresh();
    }
  }

  stopChip(): void {
    for (const a of this.asking.values()) a.abort();
  }

  // ── Running the room (hosts and co-hosts) ─────────────────────────────

  private startManaging() {
    if (this.manageTimer) return;
    void this.refreshManage();
    this.manageTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void this.refreshManage();
    }, 6000);
  }

  private stopManaging() {
    if (this.manageTimer) clearInterval(this.manageTimer);
    this.manageTimer = null;
    useRoom.setState({ manage: null });
  }

  async refreshManage(): Promise<void> {
    try {
      const info = await getRoom(this.o.roomId);
      if (this.stopped) return;
      useRoom.setState({ manage: info });
      for (const m of info.members) {
        if (m.state !== 'waiting' || this.waitingSeen.has(m.user_id)) continue;
        this.waitingSeen.add(m.user_id);
        toast(`${m.name} is waiting to join.`, 'info', { label: 'See', run: () => useRoom.setState({ panel: 'people' }) });
      }
    } catch {
      // Tried again shortly.
    }
  }

  /** After any change to settings or members: the server reads the roster again. */
  afterChange(): void {
    this.permTries = 0;
    this.socket.send({ t: 'perm' });
    void this.refreshManage();
  }

  async endForEveryone(): Promise<void> {
    await endRoom(this.o.roomId);
    this.endTries = 0;
    if (!this.socket.send({ t: 'end' })) this.finish('host');
  }

  // ── Leaving ───────────────────────────────────────────────────────────

  private finish(why: RoomEnd) {
    if (useRoom.getState().ended && why !== 'left') return;
    useRoom.setState({ ended: why });
    this.stop();
  }

  leave(): void {
    useRoom.setState({ ended: 'left' });
    this.stop();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopChip();
    this.relay.stop();
    this.socket.stop();
    this.media.stop();
    this.stopManaging();
    if (this.speakTimer) clearInterval(this.speakTimer);
    this.meter?.stop();
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOnline);
    for (const stop of this.unwatch) stop();
    this.unwatch = [];
    this.o.mic?.stop();
    useRoom.getState().localVideo?.stop();
    this.o.cam?.stop();
    this.screenTracks?.video.stop();
    this.screenTracks?.audio?.stop();
    useRoom.setState({ mic: false, cam: false, screen: false, localVideo: null, localAudio: null, speaking: [] });
    this.y.destroy();
    if (current === this) current = null;
  }
}

/** Tracks that belong to a person, by kind. */
export const trackOf = (userId: string, kind: TrackKind) => `${userId}:${kind}`;
