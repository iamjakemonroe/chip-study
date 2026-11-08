// The room socket's protocol, with real Yjs documents and the real y-protocols encoders a
// client uses: editors' changes are applied, viewers' are dropped, and awareness is relayed
// without anyone speaking for someone else.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FRAME } from '../../shared/rooms';
import { AwarenessRelay, decodeAwareness, encodeAwareness, FrameError, frameType, handleSync, parseClientMessage, setsSeedFlag, syncStep1, updateFrame } from '../../worker/protocol';
import { YDOC } from '../../shared/rooms';

/** What a client sends for a local change. */
function clientUpdate(update: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, FRAME.sync);
  syncProtocol.writeUpdate(e, update);
  return encoding.toUint8Array(e);
}

/** A client's answer to the server's sync step 1: its step 2. */
function clientStep2(client: Y.Doc, serverStep1: Uint8Array): Uint8Array {
  const d = decoding.createDecoder(serverStep1);
  expect(decoding.readVarUint(d)).toBe(FRAME.sync);
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, FRAME.sync);
  syncProtocol.readSyncMessage(d, e, client, 'server');
  return encoding.toUint8Array(e);
}

/** A client's sync step 1. */
function clientStep1(client: Y.Doc): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, FRAME.sync);
  syncProtocol.writeSyncStep1(e, client);
  return encoding.toUint8Array(e);
}

/** Applies a server frame (step 2 or update) to a client document. */
function applyServerFrame(client: Y.Doc, frame: Uint8Array): void {
  const d = decoding.createDecoder(frame);
  expect(decoding.readVarUint(d)).toBe(FRAME.sync);
  syncProtocol.readSyncMessage(d, encoding.createEncoder(), client, 'server');
}

/** A server room with some text, some of it deleted (so its delete set isn't empty). */
function serverDoc(): Y.Doc {
  const doc = new Y.Doc();
  const t = doc.getText('code/x');
  t.insert(0, 'hello world, and more');
  t.delete(5, 6);
  return doc;
}

/** A client that has synced everything from the server. */
function syncedClient(server: Y.Doc): Y.Doc {
  const client = new Y.Doc();
  const reply = handleSync(server, clientStep1(client), false, 'viewer');
  expect(reply.kind).toBe('reply');
  applyServerFrame(client, (reply as { reply: Uint8Array }).reply);
  return client;
}

describe('sync: editors change the document, viewers can’t', () => {
  it('applies an editor’s update', () => {
    const server = serverDoc();
    const editor = syncedClient(server);
    const updates: Uint8Array[] = [];
    editor.on('update', (u: Uint8Array) => updates.push(u));
    editor.getText('code/x').insert(0, '>> ');
    expect(handleSync(server, clientUpdate(updates[0]), true, 'editor')).toEqual({ kind: 'applied' });
    expect(server.getText('code/x').toString()).toBe('>> hello, and more');
  });

  it('drops a viewer’s update and says so, leaving the room as it was', () => {
    const server = serverDoc();
    const before = Y.encodeStateAsUpdate(server);
    const viewer = syncedClient(server);
    const updates: Uint8Array[] = [];
    viewer.on('update', (u: Uint8Array) => updates.push(u));
    viewer.getText('code/x').insert(0, 'sneaky ');
    expect(handleSync(server, clientUpdate(updates[0]), false, 'viewer')).toEqual({ kind: 'refused' });
    expect(server.getText('code/x').toString()).toBe('hello, and more');
    expect(Y.encodeStateAsUpdate(server)).toEqual(before);
  });

  it('drops a viewer’s deletion too', () => {
    const server = serverDoc();
    const viewer = syncedClient(server);
    const updates: Uint8Array[] = [];
    viewer.on('update', (u: Uint8Array) => updates.push(u));
    viewer.getText('code/x').delete(0, 5);
    expect(handleSync(server, clientUpdate(updates[0]), false, 'viewer')).toEqual({ kind: 'refused' });
    expect(server.getText('code/x').toString()).toBe('hello, and more');
  });

  it('quietly ignores a viewer’s step 2 that adds nothing (its whole delete set included)', () => {
    const server = serverDoc();
    const viewer = syncedClient(server);
    const step2 = clientStep2(viewer, syncStep1(server));
    expect(step2.length).toBeGreaterThan(4); // it carries the delete set, so it isn't "empty" bytes
    expect(handleSync(server, step2, false, 'viewer')).toEqual({ kind: 'ignored' });
  });

  it('refuses a viewer’s step 2 that carries local edits', () => {
    const server = serverDoc();
    const viewer = syncedClient(server);
    viewer.getText('code/x').insert(0, 'offline edit ');
    expect(handleSync(server, clientStep2(viewer, syncStep1(server)), false, 'viewer')).toEqual({ kind: 'refused' });
    expect(server.getText('code/x').toString()).toBe('hello, and more');
  });

  it('applies an editor’s step 2 (what the room missed while restarting)', () => {
    const server = serverDoc();
    const editor = syncedClient(server);
    editor.getText('code/x').insert(0, 'kept: ');
    expect(handleSync(server, clientStep2(editor, syncStep1(server)), true, 'editor')).toEqual({ kind: 'applied' });
    expect(server.getText('code/x').toString()).toBe('kept: hello, and more');
  });

  it('answers anyone’s step 1 with what they’re missing', () => {
    const server = serverDoc();
    const fresh = new Y.Doc();
    const result = handleSync(server, clientStep1(fresh), false, 'viewer');
    expect(result.kind).toBe('reply');
    applyServerFrame(fresh, (result as { reply: Uint8Array }).reply);
    expect(fresh.getText('code/x').toString()).toBe('hello, and more');
  });

  it('passes updates on in the sync format clients read', () => {
    const server = serverDoc();
    const client = syncedClient(server);
    const updates: Uint8Array[] = [];
    server.on('update', (u: Uint8Array) => updates.push(u));
    server.getText('code/x').insert(0, '!');
    applyServerFrame(client, updateFrame(updates[0]));
    expect(client.getText('code/x').toString()).toBe('!hello, and more');
  });

  it('never lets a second filling land on a room that is already filled', () => {
    // Two editors were both asked to seed (the first one's filling was slow): the second filling
    // arriving at a filled room is dropped, so nothing is doubled.
    const server = new Y.Doc();
    const first = new Y.Doc();
    const second = new Y.Doc();
    const fill = (doc: Y.Doc) => {
      const updates: Uint8Array[] = [];
      doc.on('update', (u: Uint8Array) => updates.push(u));
      doc.transact(() => {
        doc.getText('code/x').insert(0, 'print(1)\n');
        doc.getMap(YDOC.room).set('seeded', true);
      });
      return updates[0];
    };
    const one = fill(first);
    const two = fill(second);
    expect(setsSeedFlag(server, one)).toBe(true);
    expect(handleSync(server, clientUpdate(one), true, 'first', false)).toEqual({ kind: 'applied' });
    expect(handleSync(server, clientUpdate(two), true, 'second', true)).toEqual({ kind: 'refilled' });
    expect(server.getText('code/x').toString()).toBe('print(1)\n');
    // The same filling arriving again (a retry) changes nothing and isn't a refilling.
    expect(setsSeedFlag(server, one)).toBe(false);
    expect(handleSync(server, clientUpdate(one), true, 'first', true)).toEqual({ kind: 'applied' });
    // Nor from someone who synced the filled room and fills it again (their write to room.seeded
    // goes over the existing one, so the update names the old value rather than the map).
    const late = syncedClient(server);
    const lateUpdates: Uint8Array[] = [];
    late.on('update', (u: Uint8Array) => lateUpdates.push(u));
    late.transact(() => {
      late.getText('code/x').insert(0, 'again\n');
      late.getMap(YDOC.room).set('seeded', true);
    });
    expect(handleSync(server, clientUpdate(lateUpdates[0]), true, 'late', true)).toEqual({ kind: 'refilled' });
    expect(server.getText('code/x').toString()).toBe('print(1)\n');
    // Ordinary edits after seeding are fine.
    const editor = syncedClient(server);
    const updates: Uint8Array[] = [];
    editor.on('update', (u: Uint8Array) => updates.push(u));
    editor.getText('code/x').insert(0, '# ');
    expect(handleSync(server, clientUpdate(updates[0]), true, 'editor', true)).toEqual({ kind: 'applied' });
    expect(server.getText('code/x').toString()).toBe('# print(1)\n');
  });

  it('turns away frames that aren’t the protocol', () => {
    const server = serverDoc();
    expect(() => frameType(new Uint8Array())).toThrow(FrameError);
    expect(() => handleSync(server, new Uint8Array([FRAME.sync]), true, 'x')).toThrow(FrameError);
    expect(() => handleSync(server, new Uint8Array([FRAME.sync, 9]), true, 'x')).toThrow(FrameError);
    expect(() => handleSync(server, new Uint8Array([FRAME.sync, 2, 5, 1, 2]), true, 'x')).toThrow(FrameError);
    expect(() => handleSync(server, new Uint8Array([FRAME.sync, 2, 3, 0xff, 0xff, 0xff]), true, 'x')).toThrow(FrameError);
    expect(frameType(new Uint8Array([FRAME.awareness, 0]))).toBe(FRAME.awareness);
  });
});

describe('awareness relay', () => {
  const docs: Y.Doc[] = [];
  const awarenesses: Awareness[] = [];
  afterEach(() => {
    awarenesses.splice(0).forEach((a) => a.destroy());
    docs.splice(0).forEach((d) => d.destroy());
  });

  /** A client's awareness frame, as y-protocols encodes it. */
  function clientAwareness(state: Record<string, unknown> | null): { frame: Uint8Array; awareness: Awareness } {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    docs.push(doc);
    awarenesses.push(awareness);
    awareness.setLocalState(state);
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, FRAME.awareness);
    encoding.writeVarUint8Array(e, encodeAwarenessUpdate(awareness, [doc.clientID]));
    return { frame: encoding.toUint8Array(e), awareness };
  }

  /** Applies a relayed frame to a watching client's Awareness. */
  function watch(frame: Uint8Array): Awareness {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    docs.push(doc);
    awarenesses.push(awareness);
    const d = decoding.createDecoder(frame);
    expect(decoding.readVarUint(d)).toBe(FRAME.awareness);
    applyAwarenessUpdate(awareness, decoding.readVarUint8Array(d), 'server');
    return awareness;
  }

  it('stamps every state with the verified person, so user.id can be trusted', () => {
    const relay = new AwarenessRelay();
    const { frame, awareness } = clientAwareness({ user: { id: 'someone-else', name: 'The Teacher', color: '#f00' }, cursor: { anchor: 1 } });
    const out = relay.accept('conn-a', { id: 'user-a', name: 'Ada' }, frame, []);
    expect(out.owned).toEqual([awareness.clientID]);
    const seen = watch(out.frame!).getStates().get(awareness.clientID);
    expect(seen).toEqual({ user: { id: 'user-a', name: 'Ada', color: '#f00' }, cursor: { anchor: 1 } });
  });

  it('won’t let one socket speak for another’s client', () => {
    const relay = new AwarenessRelay();
    const { frame } = clientAwareness({ user: { color: '#0f0' } });
    relay.accept('conn-a', { id: 'user-a', name: 'Ada' }, frame, []);
    const hijack = relay.accept('conn-b', { id: 'user-b', name: 'Bo' }, frame, []);
    expect(hijack.frame).toBeNull();
    expect(hijack.owned).toEqual([]);
  });

  it('lets a socket speak for a few clients at most', () => {
    const relay = new AwarenessRelay();
    let owned: number[] = [];
    for (let i = 0; i < 6; i++) owned = relay.accept('conn-a', { id: 'user-a', name: 'Ada' }, clientAwareness({ i }).frame, owned).owned;
    expect(owned).toHaveLength(4);
  });

  it('ignores out-of-date states and anything that isn’t a state', () => {
    const relay = new AwarenessRelay();
    relay.accept('c', { id: 'u', name: 'U' }, encodeAwareness([{ clientId: 7, clock: 5, state: '{"a":1}' }]), []);
    expect(relay.accept('c', { id: 'u', name: 'U' }, encodeAwareness([{ clientId: 7, clock: 4, state: '{"a":2}' }]), [7]).frame).toBeNull();
    expect(relay.accept('c', { id: 'u', name: 'U' }, encodeAwareness([{ clientId: 7, clock: 6, state: '[1,2]' }]), [7]).frame).toBeNull();
    expect(relay.accept('c', { id: 'u', name: 'U' }, encodeAwareness([{ clientId: 7, clock: 6, state: 'not json' }]), [7]).frame).toBeNull();
    expect(relay.accept('c', { id: 'u', name: 'U' }, encodeAwareness([{ clientId: 7, clock: 6, state: JSON.stringify({ big: 'x'.repeat(20_000) }) }]), [7]).frame).toBeNull();
  });

  it('gives a newcomer everyone’s states, and removes a client for everyone when its socket closes', () => {
    const relay = new AwarenessRelay();
    const a = clientAwareness({ user: { color: '#00f' } });
    const { owned } = relay.accept('conn-a', { id: 'user-a', name: 'Ada' }, a.frame, []);
    const watcher = watch(relay.snapshot()!);
    expect(watcher.getStates().get(a.awareness.clientID)).toMatchObject({ user: { id: 'user-a' } });

    const removal = relay.drop('conn-a', owned)!;
    const d = decoding.createDecoder(removal);
    decoding.readVarUint(d);
    applyAwarenessUpdate(watcher, decoding.readVarUint8Array(d), 'server');
    expect(watcher.getStates().has(a.awareness.clientID)).toBe(false);
    expect(relay.snapshot()).toBeNull();
    // Someone else can't drop it, and dropping twice does nothing.
    expect(relay.drop('conn-a', owned)).toBeNull();
  });

  it('re-learns who owns which client after the room wakes up', () => {
    const relay = new AwarenessRelay();
    relay.restore('conn-a', [42]);
    expect(relay.accept('conn-b', { id: 'b', name: 'B' }, encodeAwareness([{ clientId: 42, clock: 1, state: '{}' }]), []).frame).toBeNull();
    expect(relay.accept('conn-a', { id: 'a', name: 'A' }, encodeAwareness([{ clientId: 42, clock: 1, state: '{}' }]), [42]).frame).not.toBeNull();
  });

  it('encodes and decodes awareness frames symmetrically', () => {
    const entries = [
      { clientId: 1, clock: 2, state: '{"x":1}' },
      { clientId: 300, clock: 0, state: 'null' },
    ];
    expect(decodeAwareness(encodeAwareness(entries))).toEqual(entries);
    expect(() => decodeAwareness(new Uint8Array([FRAME.awareness, 5, 1]))).toThrow(FrameError);
  });
});

describe('JSON messages', () => {
  it('reads the messages the server knows', () => {
    expect(parseClientMessage('{"t":"chat","text":"hi"}')).toEqual({ t: 'chat', text: 'hi' });
    expect(parseClientMessage('{"t":"hand","up":true}')).toEqual({ t: 'hand', up: true });
    for (const t of ['perm', 'mute-all', 'end', 'seeded']) expect(parseClientMessage(JSON.stringify({ t, extra: 1 }))).toEqual({ t });
    expect(parseClientMessage('{"t":"chip-ask","id":"q_1-a","text":"why?"}')).toEqual({ t: 'chip-ask', id: 'q_1-a', text: 'why?' });
    expect(parseClientMessage('{"t":"chip-done","id":"q1","text":""}')).toEqual({ t: 'chip-done', id: 'q1', text: '' });
  });

  it('turns away anything else', () => {
    for (const bad of ['', 'ping', 'null', '[]', '{"t":"nope"}', '{"t":"chat"}', '{"t":"chat","text":5}', '{"t":"hand","up":"yes"}', '{"t":"chip-ask","id":"has space","text":"x"}', `{"t":"chip-ask","id":"${'x'.repeat(65)}","text":"x"}`]) {
      expect(parseClientMessage(bad)).toBeNull();
    }
  });
});
