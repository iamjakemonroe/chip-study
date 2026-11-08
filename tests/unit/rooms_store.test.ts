// @vitest-environment node
// The room's storage, on the same SQL a Durable Object runs (here on node:sqlite): tickets are
// single use and short-lived, history is trimmed, and big Yjs updates survive being split.
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ROOM } from '../../shared/rooms';
import { RoomStore, type Access } from '../../worker/store';
import { memorySql } from './rooms_sqlite';

const ROOM_ID = '9b2a1c3d-0000-4000-8000-000000000001';
const access = (userId: string, extra: Partial<Access> = {}): Access => ({
  roomId: ROOM_ID,
  userId,
  name: `Person ${userId.slice(0, 4)}`,
  role: 'member',
  state: 'in',
  canEdit: true,
  live: true,
  maxPeople: 4,
  endsAt: null,
  editMode: 'everyone',
  classRoom: false,
  checkedAt: Number.MAX_SAFE_INTEGER, // "just now", unless a test says otherwise
  ...extra,
});

let store: RoomStore;
beforeEach(() => {
  store = new RoomStore(memorySql());
  store.migrate();
  store.migrate(); // twice is fine: every wake runs it
});

describe('tickets', () => {
  it('can be used once', () => {
    const now = 1_000_000;
    store.addTicket('nonce-a', access('aaaa'), now);
    expect(store.takeTicket('nonce-a', now + 1)?.access.userId).toBe('aaaa');
    expect(store.takeTicket('nonce-a', now + 2)).toBeNull();
  });

  it('expire after 60 seconds, and are gone once tried', () => {
    const now = 1_000_000;
    store.addTicket('nonce-b', access('bbbb'), now);
    store.addTicket('nonce-c', access('cccc'), now);
    expect(store.takeTicket('nonce-b', now + ROOM.ticketMs - 1)?.issuedAt).toBe(now);
    expect(store.takeTicket('nonce-c', now + ROOM.ticketMs)).toBeNull();
    expect(store.takeTicket('nonce-c', now)).toBeNull();
  });

  it('carry what the person was verified as, and go when they are taken out', () => {
    const now = 5;
    store.addTicket('n1', access('dddd', { role: 'cohost', canEdit: false }), now);
    store.addTicket('n2', access('dddd'), now);
    store.addTicket('n3', access('eeee'), now);
    expect(store.takeTicket('n1', now)?.access).toMatchObject({ userId: 'dddd', role: 'cohost', canEdit: false });
    store.dropTicketsOf('dddd');
    expect(store.takeTicket('n2', now)).toBeNull();
    expect(store.takeTicket('n3', now)?.access.userId).toBe('eeee');
  });

  it('date their rights from the access check, not from when they were issued', () => {
    store.addTicket('n-old', access('ffff', { checkedAt: 900 }), 1_000);
    expect(store.takeTicket('n-old', 1_001)?.issuedAt).toBe(900);
    // ...and still expire 60 s after they were issued.
    store.addTicket('n-old2', access('ffff', { checkedAt: 900 }), 1_000);
    expect(store.takeTicket('n-old2', 900 + ROOM.ticketMs + 50)).not.toBeNull();
  });

  it('that were never issued are refused', () => {
    expect(store.takeTicket('', 0)).toBeNull();
    expect(store.takeTicket("x' OR 1=1 --", 0)).toBeNull();
  });
});

describe('people, chat and Chip', () => {
  it('keeps people in the order they came, with their hands', () => {
    store.upsertPerson({ userId: 'b', name: 'Bo', role: 'member', canEdit: false }, 2);
    store.upsertPerson({ userId: 'a', name: 'Ada', role: 'host', canEdit: true }, 1);
    expect(store.setHand('b', true)).toBe(true);
    expect(store.setHand('b', true)).toBe(false);
    expect(store.setHand('nobody', true)).toBe(false);
    store.upsertPerson({ userId: 'b', name: 'Bo B.', role: 'member', canEdit: true }, 9);
    expect(store.people()).toEqual([
      { userId: 'a', name: 'Ada', role: 'host', canEdit: true, hand: false },
      { userId: 'b', name: 'Bo B.', role: 'member', canEdit: true, hand: true },
    ]);
    expect(store.hands()).toEqual(['b']);
    store.removePerson('b');
    expect(store.hands()).toEqual([]);
  });

  it('keeps the last 200 chat messages', () => {
    for (let i = 0; i < ROOM.chatKept + 15; i++) store.addChat({ id: `m${i}`, from: { userId: 'a', name: 'Ada' }, text: `hello ${i}`, at: i });
    const chat = store.chat();
    expect(chat).toHaveLength(ROOM.chatKept);
    expect(chat[0].text).toBe('hello 15');
    expect(chat.at(-1)).toEqual({ id: `m${ROOM.chatKept + 14}`, from: { userId: 'a', name: 'Ada' }, text: `hello ${ROOM.chatKept + 14}`, at: ROOM.chatKept + 14 });
  });

  it('keeps the last 50 Chip messages and their answers', () => {
    for (let i = 0; i < ROOM.chipKept + 3; i++) store.addChip({ id: `q${i}`, from: { userId: 'a', name: 'Ada' }, question: `q ${i}`, answer: '', done: false, at: i });
    store.updateChip(`q${ROOM.chipKept + 2}`, 'the answer', true, 77);
    const chip = store.chip();
    expect(chip).toHaveLength(ROOM.chipKept);
    expect(chip[0].id).toBe('q3');
    expect(chip.at(-1)).toMatchObject({ answer: 'the answer', done: true });
    expect(store.chipEntry(`q${ROOM.chipKept + 2}`)?.chunkAt).toBe(77);
    expect(store.unfinishedChipOf('a')).toHaveLength(ROOM.chipKept - 1);
  });
});

describe('SFU sessions and publications', () => {
  it('forgets everything on a person’s sessions with them', () => {
    store.addSession({ sessionId: 'pub-1', userId: 'a', purpose: 'publish' }, 1);
    store.addSession({ sessionId: 'rec-1', userId: 'a', purpose: 'receive' }, 1);
    store.addSession({ sessionId: 'pub-2', userId: 'b', purpose: 'publish' }, 1);
    store.addPub({ userId: 'a', sessionId: 'pub-1', trackName: 'a:video', kind: 'video', rids: ['f', 'h', 'q'], mid: '0' }, 1);
    store.addPub({ userId: 'b', sessionId: 'pub-2', trackName: 'b:audio', kind: 'audio', rids: [], mid: '1' }, 2);
    store.addSub({ sessionId: 'rec-1', mid: '4', pubSessionId: 'pub-2', trackName: 'b:audio', rid: null });
    expect(store.publications()).toEqual([
      { userId: 'a', sessionId: 'pub-1', trackName: 'a:video', kind: 'video', rids: ['f', 'h', 'q'] },
      { userId: 'b', sessionId: 'pub-2', trackName: 'b:audio', kind: 'audio', rids: [] },
    ]);
    expect(store.pub('pub-1', 'a:video')?.mid).toBe('0');
    expect(store.sub('rec-1', '4')).toEqual({ sessionId: 'rec-1', mid: '4', pubSessionId: 'pub-2', trackName: 'b:audio', rid: null });
    store.dropSessionsOf('a');
    expect(store.session('pub-1')).toBeNull();
    expect(store.publications().map((p) => p.userId)).toEqual(['b']);
    expect(store.sub('rec-1', '4')).toBeNull();
  });

  it('knows who holds sessions, and since when', () => {
    store.addSession({ sessionId: 's1', userId: 'a', purpose: 'publish' }, 10);
    store.addSession({ sessionId: 's2', userId: 'a', purpose: 'receive' }, 30);
    store.addSession({ sessionId: 's3', userId: 'b', purpose: 'receive' }, 20);
    expect(store.sessionHolders().sort((x, y) => x.userId.localeCompare(y.userId))).toEqual([
      { userId: 'a', at: 30 },
      { userId: 'b', at: 20 },
    ]);
  });

  it('withdraws a publication by mid and says which it was', () => {
    store.addPub({ userId: 'a', sessionId: 's', trackName: 'a:screen', kind: 'screen', rids: ['f'], mid: '2' }, 1);
    expect(store.dropPubs('s', ['2', '9']).map((p) => p.trackName)).toEqual(['a:screen']);
    expect(store.publications()).toEqual([]);
  });

  it('keeps forced closes until they are confirmed', () => {
    store.addClosing('s', '0');
    store.addClosing('s', '0');
    store.closingTried('s', '0');
    expect(store.closings()).toEqual([{ sessionId: 's', mid: '0', tries: 1 }]);
    store.closingDone('s', '0');
    expect(store.closings()).toEqual([]);
  });
});

describe('timers and settings', () => {
  it('answers what is due, soonest first, and the next one', () => {
    store.setTimer('save', 300);
    store.setTimer('depart:a', 100);
    store.setTimer('depart:b', 200);
    store.setTimerIfSooner('save', 400); // later: kept at 300
    expect(store.timer('save')).toBe(300);
    store.setTimerIfSooner('save', 250);
    expect(store.dueTimers(260)).toEqual(['depart:a', 'depart:b', 'save']);
    expect(store.nextTimer()).toBe(100);
    store.clearTimersLike('depart:');
    expect(store.dueTimers(1_000)).toEqual(['save']);
    store.clearTimer('save');
    expect(store.nextTimer()).toBeNull();
  });

  it('keeps settings and JSON', () => {
    store.setMeta('ended', 'host');
    expect(store.meta('ended')).toBe('host');
    store.setJson('roster', { at: 1, members: {} });
    expect(store.json('roster')).toEqual({ at: 1, members: {} });
    store.setMeta('ended', null);
    expect(store.meta('ended')).toBeNull();
  });
});

describe('the Y.Doc in storage', () => {
  it('reads back every update, even ones bigger than a row may hold', () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    doc.getText('code/a').insert(0, 'small');
    doc.getText('code/b').insert(0, 'x'.repeat(1_300_000)); // split into three parts
    doc.getText('code/a').insert(5, ' change');
    for (const u of updates) store.appendUpdate(u);

    const loaded = store.loadUpdates();
    expect(loaded).toHaveLength(3);
    const copy = new Y.Doc();
    for (const u of loaded) Y.applyUpdate(copy, u);
    expect(copy.getText('code/a').toString()).toBe('small change');
    expect(copy.getText('code/b').length).toBe(1_300_000);
  });

  it('compacts to one update with the same document', () => {
    const doc = new Y.Doc();
    doc.on('update', (u: Uint8Array) => store.appendUpdate(u));
    for (let i = 0; i < 50; i++) doc.getText('t').insert(0, String(i));
    store.replaceUpdates(Y.encodeStateAsUpdate(doc));
    const loaded = store.loadUpdates();
    expect(loaded).toHaveLength(1);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, loaded[0]);
    expect(copy.getText('t').toString()).toBe(doc.getText('t').toString());
  });

  it('remembers what was saved', () => {
    expect(store.savedPrint('notes')).toBeNull();
    store.setSavedPrint('notes', 'p1');
    store.setSavedPrint('notes', 'p2');
    expect(store.savedPrint('notes')).toBe('p2');
  });
});
