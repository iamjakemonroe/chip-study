import { Check, DoorOpen, Hand, MicOff, MoreHorizontal, Pencil, PencilOff, Pin, UserMinus, VolumeX, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Person } from '../../../shared/rooms.ts';
import { Confirm, Menu, MenuItem, Segmented, Spinner } from '../../components/ui.tsx';
import { toast } from '../../store/toast.ts';
import { roomSettings, setRoomMember, type RoomMember } from '../api.ts';
import { colorFor, initials, isManager, ordered, roleName } from '../people.ts';
import { roomSession } from '../session.ts';
import { useRoom } from '../store.ts';

/** Who's in the room: each person's role, whether they can edit, and their hand. Hosts and
 * co-hosts let people in, choose who edits, take people out, mute everyone, and set how people
 * join. Every change is sent to the room server with {t: "perm"} so it applies at once. */
export function PeoplePanel() {
  const people = useRoom((s) => s.people);
  const you = useRoom((s) => s.you);
  const manage = useRoom((s) => s.manage);
  const hands = useRoom((s) => s.hands);
  const pubs = useRoom((s) => s.pubs);
  const editModeLive = useRoom((s) => s.editMode);
  const micOn = useRoom((s) => s.mic);
  const manager = isManager(you?.role);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Person | null>(null);
  const roomId = useRoom((s) => s.roomId)!;
  const editMode = manage?.edit_mode ?? editModeLive;

  const here = useMemo(() => {
    const list = people.filter((p) => p.connected);
    if (you && !list.some((p) => p.userId === you.userId)) list.push({ ...you, hand: false, connected: true });
    return ordered(list, you?.userId);
  }, [people, you]);
  const raised = here.filter((p) => hands.includes(p.userId));
  const waiting = manage?.members.filter((m) => m.state === 'waiting') ?? [];
  const away = manager ? (manage?.members.filter((m) => m.state === 'in' && !here.some((p) => p.userId === m.user_id)) ?? []) : [];

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      roomSession()?.afterChange();
      if (done) toast(done, 'good');
    } catch (e) {
      toast((e as Error).message, 'warn');
    } finally {
      setBusy(null);
    }
  };

  const canManage = (p: { userId: string; role: Person['role'] }) => manager && p.userId !== you?.userId && p.role !== 'host' && (p.role !== 'cohost' || you?.role === 'host');
  const editsOf = (p: Person) => p.canEdit || p.role !== 'member';

  return (
    <div className="scroll-soft h-full overflow-y-auto px-4 pb-6 pt-4">
      {manager && manage && (
        <section className="mb-5 space-y-3 rounded-2xl border border-line bg-white p-3.5" aria-label="Room settings">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-ink-3">Who can edit the work</p>
            <Segmented
              size="sm"
              label="Who can edit"
              value={editMode}
              onChange={(v) => void run('mode', () => roomSettings(roomId, { editMode: v }), v === 'everyone' ? 'Everyone can edit now.' : 'Only the people you choose can edit now.')}
              options={[
                { value: 'everyone', label: 'Everyone' },
                { value: 'chosen', label: 'People I choose' },
              ]}
            />
          </div>
          {!manage.institution_id && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-ink-3">How people join</p>
              <Segmented
                size="sm"
                label="How people join"
                value={manage.admission === 'ask' ? 'ask' : 'link'}
                onChange={(v) => void run('admission', () => roomSettings(roomId, { admission: v }), v === 'ask' ? 'You’ll let each new person in.' : 'Anyone with the link can join now.')}
                options={[
                  { value: 'link', label: 'Anyone with the link' },
                  { value: 'ask', label: 'I let them in' },
                ]}
              />
            </div>
          )}
          <button className="btn btn-ghost btn-sm w-full" onClick={() => roomSession()?.muteAll()}>
            <VolumeX size={15} /> Mute everyone
          </button>
        </section>
      )}

      {waiting.length > 0 && (
        <section className="mb-5" aria-label="Waiting to join">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-iris-2">
            <DoorOpen size={13} /> Waiting to join · {waiting.length}
          </h3>
          <ul className="space-y-1.5">
            {waiting.map((m) => (
              <WaitingRow
                key={m.user_id}
                m={m}
                busy={busy === `in:${m.user_id}` || busy === `no:${m.user_id}`}
                onIn={() => void run(`in:${m.user_id}`, () => setRoomMember(roomId, m.user_id, { state: 'in' }), `${m.name} is in.`)}
                onNo={() => void run(`no:${m.user_id}`, () => setRoomMember(roomId, m.user_id, { state: 'removed' }))}
              />
            ))}
          </ul>
        </section>
      )}

      {raised.length > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-sand-soft px-3.5 py-2.5 text-sm text-[#7a5a14]">
          <Hand size={15} className="flex-none" />
          <span className="min-w-0">
            {raised.map((p) => (p.userId === you?.userId ? 'You' : p.name)).join(', ')} {raised.length === 1 && raised[0].userId !== you?.userId ? 'has' : 'have'} a hand up
          </span>
        </p>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">In the room · {here.length}</h3>
      <ul className="space-y-1">
        {here.map((p) => {
          const self = p.userId === you?.userId;
          const muted = self ? !micOn : !pubs.some((x) => x.userId === p.userId && x.kind === 'audio');
          const role = roleName(p.role);
          return (
            <li key={p.userId} className="group flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-white">
              <span className="room-avatar h-9 w-9 flex-none text-sm" style={{ background: colorFor(p.userId) }}>
                {initials(p.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                  <span className="truncate">{p.name}</span>
                  {self && <span className="flex-none font-normal text-ink-3">(you)</span>}
                  {hands.includes(p.userId) && <Hand size={13} className="flex-none text-sand" aria-label="Hand raised" />}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-ink-3">
                  {role && <span className="chip-tag h-[1.1rem] bg-iris-soft px-1.5 text-[0.68rem] text-iris-2">{role}</span>}
                  {editsOf(p) ? (
                    <span className="flex items-center gap-1">
                      <Pencil size={11} /> Can edit
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <PencilOff size={11} /> Viewing
                    </span>
                  )}
                  {muted && (
                    <span className="flex items-center gap-1">
                      · <MicOff size={11} /> Muted
                    </span>
                  )}
                </p>
              </div>
              {busy?.endsWith(p.userId) && <Spinner size={14} />}
              <Menu label={`More for ${p.name}`} button={<MoreHorizontal size={17} />}>
                {(close) => (
                  <>
                    <MenuItem
                      icon={<Pin size={15} />}
                      onClick={() => {
                        close();
                        useRoom.setState({ pinned: p.userId, view: 'stage' });
                      }}
                    >
                      Pin to the stage
                    </MenuItem>
                    {canManage(p) && p.role === 'member' && editMode === 'chosen' && (
                      <MenuItem
                        icon={p.canEdit ? <PencilOff size={15} /> : <Pencil size={15} />}
                        onClick={() => {
                          close();
                          void run(`edit:${p.userId}`, () => setRoomMember(roomId, p.userId, { canEdit: !p.canEdit }), p.canEdit ? `${p.name} is viewing now.` : `${p.name} can edit now.`);
                        }}
                      >
                        {p.canEdit ? 'Stop their editing' : 'Let them edit'}
                      </MenuItem>
                    )}
                    {canManage(p) && (
                      <MenuItem
                        icon={<UserMinus size={15} />}
                        danger
                        onClick={() => {
                          close();
                          setRemoving(p);
                        }}
                      >
                        Remove from the room
                      </MenuItem>
                    )}
                  </>
                )}
              </Menu>
            </li>
          );
        })}
      </ul>
      {manager && editMode === 'everyone' && <p className="mt-3 px-2 text-xs leading-relaxed text-ink-3">Everyone can edit. Choose “People I choose” to decide person by person.</p>}

      {away.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">Joined, not here now · {away.length}</h3>
          <ul className="space-y-1">
            {away.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 rounded-2xl px-2 py-1.5 opacity-70">
                <span className="room-avatar h-8 w-8 flex-none text-xs" style={{ background: colorFor(m.user_id) }}>
                  {initials(m.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                {m.can_edit ? <Pencil size={12} className="text-ink-4" aria-label="Can edit" /> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      <Confirm
        open={!!removing}
        title={`Remove ${removing?.name ?? ''}?`}
        body="They leave the room at once and can’t come back with this link. Their part of the shared work stays."
        yes="Remove"
        danger
        onClose={() => setRemoving(null)}
        onYes={async () => {
          if (!removing) return;
          await run(`out:${removing.userId}`, () => setRoomMember(roomId, removing.userId, { state: 'removed' }), `${removing.name} has left the room.`);
        }}
      />
    </div>
  );
}

function WaitingRow({ m, busy, onIn, onNo }: { m: RoomMember; busy: boolean; onIn: () => void; onNo: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-iris-soft/60 px-2.5 py-2">
      <span className="room-avatar h-8 w-8 flex-none text-xs" style={{ background: colorFor(m.user_id) }}>
        {initials(m.name)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.name}</span>
      {busy ? (
        <Spinner size={14} />
      ) : (
        <>
          <button className="icon-btn h-8 w-8 text-ink-3" onClick={onNo} aria-label={`Don’t let ${m.name} in`} title="Don’t let them in">
            <X size={15} />
          </button>
          <button className="btn btn-primary btn-sm h-8 px-3" onClick={onIn}>
            <Check size={14} /> Let in
          </button>
        </>
      )}
    </li>
  );
}
