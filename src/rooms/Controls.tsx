import {
  Camera,
  CameraOff,
  Hand,
  Keyboard,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  NotebookPen,
  ListChecks,
  PhoneOff,
  ScrollText,
  Settings2,
  Share2,
  Users,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Orb } from '../components/Orb.tsx';
import { Confirm, Menu, MenuItem, Modal } from '../components/ui.tsx';
import { toast } from '../store/toast.ts';
import { canPickSpeaker, canShareScreen, listDevices, type Devices } from './devices.ts';
import { isManager } from './people.ts';
import { roomSession } from './session.ts';
import { openPanel, togglePanel, useRoom, type RoomPanel } from './store.ts';

/** The room's controls: microphone, camera, screen, hand, chat, people, Chip and leaving (and, for
 * hosts, ending it for everyone), each with a tooltip and a keyboard shortcut. */

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = mac ? '⌘' : 'Ctrl';

export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: `M  or  ${MOD} D`, what: 'Mute or unmute' },
  { keys: 'V', what: 'Camera on or off' },
  { keys: 'S', what: 'Share your screen' },
  { keys: 'H', what: 'Raise or lower your hand' },
  { keys: 'C', what: 'Chat' },
  { keys: 'P', what: 'People' },
  { keys: 'K', what: 'Chip' },
  { keys: 'Esc', what: 'Close the side panel' },
  { keys: '?', what: 'These shortcuts' },
];

/** Typing somewhere (the document, code, a field): single-letter shortcuts stay out of the way. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('.cm-editor, [contenteditable="true"], [role="dialog"]');
}

export function useShortcuts(onHelp: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = roomSession();
      if (!s || useRoom.getState().ended) return;
      const k = e.key.toLowerCase();
      // Muting works everywhere, even mid-sentence.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && k === 'd') {
        e.preventDefault();
        void s.setMic(!useRoom.getState().mic);
        return;
      }
      // Esc closes the side panel (unless a dialog above it is open: that closes first).
      if (e.key === 'Escape') {
        if (useRoom.getState().panel && !document.querySelector('[aria-modal="true"]:not([aria-label="Room panels"])')) {
          e.preventDefault();
          openPanel(null);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      const st = useRoom.getState();
      const act: Record<string, () => void> = {
        m: () => void s.setMic(!st.mic),
        v: () => void s.setCam(!st.cam),
        s: () => canShareScreen() && void s.setScreen(!st.screen),
        h: () => s.setHand(!st.hands.includes(st.you?.userId ?? '')),
        c: () => togglePanel('chat'),
        p: () => togglePanel('people'),
        k: () => togglePanel('chip'),
        '?': onHelp,
      };
      const run = act[k] ?? (e.key === '?' ? act['?'] : undefined);
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onHelp]);
}

function Tip({ label, keys, children }: { label: string; keys?: string; children: ReactNode }) {
  return (
    <span className="room-tipped">
      {children}
      <span className="room-tip" role="tooltip">
        {label}
        {keys && <kbd>{keys}</kbd>}
      </span>
    </span>
  );
}

function Control({
  label,
  keys,
  on,
  danger,
  badge,
  onClick,
  children,
  pressed,
  className = '',
}: {
  label: string;
  keys?: string;
  on?: boolean;
  danger?: boolean;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <Tip label={label} keys={keys}>
      <button
        className={`room-ctl ${on === false ? 'is-off' : ''} ${danger ? 'is-danger' : ''} ${pressed ? 'is-pressed' : ''} ${className}`}
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={keys
          ?.replace(/\s+or\s+/g, ' ')
          .replace('⌘', 'Meta+')
          .replace('Ctrl ', 'Control+')}
      >
        {children}
        {badge ? <span className="room-ctl-badge">{badge > 9 ? '9+' : badge}</span> : null}
      </button>
    </Tip>
  );
}

export function ControlsBar({ compact, onShare }: { compact: boolean; onShare: () => void }) {
  const mic = useRoom((s) => s.mic);
  const cam = useRoom((s) => s.cam);
  const screen = useRoom((s) => s.screen);
  const panel = useRoom((s) => s.panel);
  const you = useRoom((s) => s.you);
  const hand = useRoom((s) => s.hands.includes(s.you?.userId ?? ''));
  const unreadChat = useRoom((s) => s.unreadChat);
  const unreadChip = useRoom((s) => s.unreadChip);
  const waiting = useRoom((s) => s.manage?.members.filter((m) => m.state === 'waiting').length ?? 0);
  const manager = isManager(you?.role);
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [ending, setEnding] = useState(false);
  useShortcuts(() => setHelp((h) => !h));
  const s = roomSession();
  if (!s) return null;

  const panelButton = (p: RoomPanel, label: string, keys: string, icon: ReactNode, badge?: number) => (
    <Control label={label} keys={keys} pressed={panel === p} badge={badge} onClick={() => togglePanel(p)}>
      {icon}
    </Control>
  );

  return (
    <div className="room-controls" role="toolbar" aria-label="Room controls">
      <div className="room-controls-group">
        <Control label={mic ? 'Mute' : 'Unmute'} keys={`M or ${MOD} D`} on={mic} onClick={() => void s.setMic(!mic)}>
          {mic ? <Mic size={20} /> : <MicOff size={20} />}
        </Control>
        <Control label={cam ? 'Turn camera off' : 'Turn camera on'} keys="V" on={cam} onClick={() => void s.setCam(!cam)}>
          {cam ? <Camera size={20} /> : <CameraOff size={20} />}
        </Control>
        {canShareScreen() && !compact && (
          <Control label={screen ? 'Stop sharing your screen' : 'Share your screen'} keys="S" pressed={screen} onClick={() => void s.setScreen(!screen)}>
            <MonitorUp size={20} />
          </Control>
        )}
        <Control label={hand ? 'Lower your hand' : 'Raise your hand'} keys="H" pressed={hand} onClick={() => s.setHand(!hand)}>
          <Hand size={20} />
        </Control>
      </div>
      <div className="room-controls-group">
        {panelButton('chat', 'Chat', 'C', <MessageSquare size={20} />, unreadChat)}
        {panelButton('people', manager && waiting ? `People (${waiting} waiting)` : 'People', 'P', <Users size={20} />, manager ? waiting : 0)}
        {panelButton('chip', 'Chip', 'K', <Orb size={20} />, unreadChip)}
        <Menu label="More" button={<MoreHorizontal size={20} />} className="room-more">
          {(close) => (
            <>
              {compact && canShareScreen() && (
                <MenuItem icon={<MonitorUp size={15} />} onClick={() => (close(), void s.setScreen(!screen))}>
                  {screen ? 'Stop sharing your screen' : 'Share your screen'}
                </MenuItem>
              )}
              <MenuItem icon={<ListChecks size={15} />} onClick={() => (close(), openPanel('tasks'))}>
                Shared plan
              </MenuItem>
              <MenuItem icon={<NotebookPen size={15} />} onClick={() => (close(), openPanel('notes'))}>
                Shared notes
              </MenuItem>
              <MenuItem icon={<ScrollText size={15} />} onClick={() => (close(), openPanel('brief'))}>
                The brief
              </MenuItem>
              <div className="my-1 h-px bg-line" />
              {manager && (
                <MenuItem icon={<Share2 size={15} />} onClick={() => (close(), onShare())}>
                  Invite people
                </MenuItem>
              )}
              <MenuItem icon={<Settings2 size={15} />} onClick={() => (close(), setSettings(true))}>
                Camera, microphone and speaker
              </MenuItem>
              {!compact && (
                <MenuItem icon={<Keyboard size={15} />} onClick={() => (close(), setHelp(true))}>
                  Keyboard shortcuts
                </MenuItem>
              )}
            </>
          )}
        </Menu>
      </div>
      <div className="room-controls-group">
        {manager ? (
          <Menu label="Leave or end the room" button={<PhoneOff size={20} />} className="room-leave">
            {(close) => (
              <>
                <MenuItem icon={<LogOut size={15} />} onClick={() => (close(), s.leave())}>
                  Leave the room
                </MenuItem>
                <MenuItem icon={<PhoneOff size={15} />} danger onClick={() => (close(), setEnding(true))}>
                  End for everyone
                </MenuItem>
              </>
            )}
          </Menu>
        ) : (
          <Control label="Leave the room" danger onClick={() => s.leave()}>
            <PhoneOff size={20} />
          </Control>
        )}
      </div>

      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts" width={440}>
        <ul className="divide-y divide-line text-sm">
          {SHORTCUTS.map((k) => (
            <li key={k.what} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-ink-2">{k.what}</span>
              <kbd className="room-kbd">{k.keys}</kbd>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-ink-3">Single letters work when you’re not typing. {MOD} D mutes from anywhere, even mid-sentence.</p>
      </Modal>
      <DeviceSettings open={settings} onClose={() => setSettings(false)} />
      <Confirm
        open={ending}
        title="End the room for everyone?"
        body="Everyone leaves, and the shared work is saved to the assignment. Nothing else is kept from the call."
        yes="End for everyone"
        danger
        onClose={() => setEnding(false)}
        onYes={async () => {
          try {
            await s.endForEveryone();
          } catch (e) {
            toast((e as Error).message, 'warn');
          }
        }}
      />
    </div>
  );
}

function DeviceSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [devices, setDevices] = useState<Devices>({
    cameras: [],
    mics: [],
    speakers: [],
  });
  const s = roomSession();
  useEffect(() => {
    if (open) void listDevices().then(setDevices);
  }, [open]);
  if (!s) return null;
  const row = (label: string, kind: 'camera' | 'mic' | 'speaker', list: MediaDeviceInfo[]) => (
    <label className="block">
      <span className="label">{label}</span>
      <select className="field" value={s.devices[kind] ?? ''} onChange={(e) => void s.setDevice(kind, e.target.value).then(() => setDevices((d) => ({ ...d })))} disabled={!list.length}>
        <option value="">{list.length ? 'Default' : 'None found'}</option>
        {list.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Modal open={open} onClose={onClose} title="Camera, microphone and speaker" width={460}>
      <div className="space-y-4">
        {row('Camera', 'camera', devices.cameras)}
        {row('Microphone', 'mic', devices.mics)}
        {canPickSpeaker() ? row('Speaker', 'speaker', devices.speakers) : <p className="text-sm text-ink-3">This browser plays sound through your device’s own speaker setting.</p>}
        <p className="text-xs leading-relaxed text-ink-3">Echo cancellation and noise suppression are on.</p>
      </div>
    </Modal>
  );
}
