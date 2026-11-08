import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { FRAME, type AwarenessUser } from '../../shared/rooms.ts';

/** The room's shared document on this screen (docs/rooms.md, "How a screen syncs"): a Y.Doc and its
 * awareness (cursors), kept in step with the room over y-protocols.
 *
 * - On every open: sync step 1 (the room answers with all of it), and this screen's cursor.
 * - The room's own step 1 (sent to editors) is answered with step 2: anything it missed.
 * - Local changes go up as updates, only while this screen can edit. A viewer's change would be
 *   dropped anyway, and it would stay in the local copy, so it's never sent; if one is made, the
 *   copy counts as spoiled and is started afresh before editing is allowed.
 * - `fresh()` starts a new Y.Doc (after {t:"readonly"}, `already_seeded`, or losing edit rights),
 *   and the screens built on the old one are made again. */

export const FROM_ROOM = Symbol('from-room');

export class YRoom {
  doc: Y.Doc;
  awareness: Awareness;
  /** Goes up by one each time the document is started afresh. */
  generation = 0;
  /** Fresh documents on this socket (the server takes at most four awareness ids per socket). */
  freshOnSocket = 0;
  onReset?: () => void;
  /** The document has changed (from anyone). */
  onChange?: () => void;

  private connected = false;
  private canEdit: boolean;
  private spoiled = false;

  constructor(
    private send: (bytes: Uint8Array) => void,
    private user: AwarenessUser,
    canEdit: boolean,
  ) {
    this.canEdit = canEdit;
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.wire();
  }

  get editable(): boolean {
    return this.canEdit;
  }

  private wire() {
    const doc = this.doc;
    const awareness = this.awareness;
    awareness.setLocalStateField('user', this.user);
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (doc !== this.doc) return;
      this.onChange?.();
      if (origin === FROM_ROOM) return;
      if (!this.canEdit) {
        this.spoiled = true;
        return;
      }
      if (!this.connected) return; // the room's step 1 asks for it when the socket is back
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, FRAME.sync);
      syncProtocol.writeUpdate(enc, update);
      this.send(encoding.toUint8Array(enc));
    });
    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (awareness !== this.awareness || origin === FROM_ROOM || !this.connected) return;
      const mine = [...added, ...updated, ...removed].filter((id) => id === doc.clientID);
      if (mine.length) this.sendAwareness(mine);
    });
  }

  private sendAwareness(clients: number[]) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, FRAME.awareness);
    encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(this.awareness, clients));
    this.send(encoding.toUint8Array(enc));
  }

  private step1() {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, FRAME.sync);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.send(encoding.toUint8Array(enc));
  }

  /** The socket has (re)opened. */
  opened(): void {
    this.connected = true;
    this.freshOnSocket = 0;
    this.step1();
    if (this.awareness.getLocalState()) this.sendAwareness([this.doc.clientID]);
  }

  /** The socket has closed: other people's cursors are out of date until it's back. */
  closed(): void {
    this.connected = false;
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    if (others.length) removeAwarenessStates(this.awareness, others, FROM_ROOM);
  }

  /** A binary frame from the room. */
  receive(bytes: Uint8Array): void {
    const d = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(d);
    if (type === FRAME.sync) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, FRAME.sync);
      const kind = syncProtocol.readSyncMessage(d, enc, this.doc, FROM_ROOM);
      // Step 1 from the room: answer with step 2 (only editors are asked; a viewer has nothing to add).
      if (kind === syncProtocol.messageYjsSyncStep1 && this.canEdit && encoding.length(enc) > 1) this.send(encoding.toUint8Array(enc));
    } else if (type === FRAME.awareness) {
      applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(d), FROM_ROOM);
    }
  }

  /** What this screen may do changed. Losing edit rights, or gaining them with a spoiled copy,
   * starts a fresh document. */
  setCanEdit(can: boolean): void {
    if (can === this.canEdit) return;
    this.canEdit = can;
    if (!can || this.spoiled) this.fresh();
    else this.onReset?.();
  }

  setUser(user: AwarenessUser): void {
    this.user = user;
    this.awareness.setLocalStateField('user', user);
  }

  /** A new Y.Doc: the old one holds changes the room doesn't have. */
  fresh(): void {
    const old = this.awareness;
    const oldDoc = this.doc;
    // The room forgets the old cursor (the update handler sends it).
    old.setLocalState(null);
    old.destroy();
    // Destroyed once the screens built on it have gone.
    setTimeout(() => oldDoc.destroy(), 1000);
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.generation++;
    this.freshOnSocket++;
    this.spoiled = false;
    this.wire();
    if (this.connected) {
      this.step1();
      this.sendAwareness([this.doc.clientID]);
    }
    this.onReset?.();
  }

  destroy(): void {
    this.connected = false;
    this.awareness.destroy();
    this.doc.destroy();
  }
}
