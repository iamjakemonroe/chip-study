import { ArrowUp, MessageSquare } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ROOM } from '../../../shared/rooms.ts';
import { AutoTextarea } from '../../components/ui.tsx';
import { colorFor } from '../people.ts';
import { roomSession } from '../session.ts';
import { useRoom } from '../store.ts';

/** The room's chat: messages with names and times, links you can open safely (only http and https
 * addresses become links, opened in a new tab without the room behind them), and everything else
 * as plain text. Chat is kept with the room's assignment for its host. */

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
/** Punctuation that ends a sentence rather than the address. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

/** [text] with its web addresses as safe links. Exported for the tests. */
export function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const trail = TRAILING.exec(url)?.[0] ?? '';
    if (trail) url = url.slice(0, -trail.length);
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    let safe: string | null = null;
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') safe = u.href;
    } catch {
      safe = null;
    }
    out.push(
      safe ? (
        <a key={`${start}-${url}`} href={safe} target="_blank" rel="noopener noreferrer nofollow ugc" className="font-medium text-iris-2 [overflow-wrap:anywhere] underline underline-offset-2">
          {url}
        </a>
      ) : (
        url
      ),
    );
    last = start + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function ChatPanel() {
  const chat = useRoom((s) => s.chat);
  const you = useRoom((s) => s.you?.userId);
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat]);

  const send = () => {
    const t = text.trim();
    if (!t || t.length > ROOM.chatChars) return;
    if (roomSession()?.sendChat(t)) {
      setText('');
      stick.current = true;
    }
  };
  const left = ROOM.chatChars - text.trim().length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        aria-live="polite"
        aria-label="Chat messages"
      >
        {chat.length === 0 ? (
          <div className="flex flex-col items-center px-4 pt-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-iris-soft text-iris">
              <MessageSquare size={20} />
            </span>
            <p className="mt-4 font-semibold">Say hello</p>
            <p className="mt-1 max-w-xs text-sm leading-relaxed text-ink-3">Messages go to everyone here. They’re kept with the room’s assignment for its host.</p>
          </div>
        ) : (
          <ol className="space-y-3">
            {chat.map((m, i) => {
              const mine = m.from.userId === you;
              const prev = chat[i - 1];
              const grouped = prev && prev.from.userId === m.from.userId && m.at - prev.at < 3 * 60_000;
              return (
                <Fragment key={m.id}>
                  <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'} ${grouped ? '-mt-2' : ''}`}>
                    {!grouped && (
                      <p className="mb-1 flex items-baseline gap-2 px-1 text-xs">
                        {!mine && (
                          <span className="font-semibold" style={{ color: colorFor(m.from.userId) }}>
                            {m.from.name}
                          </span>
                        )}
                        {mine && <span className="font-semibold text-ink-2">You</span>}
                        <time className="text-ink-4" dateTime={new Date(m.at).toISOString()}>
                          {time(m.at)}
                        </time>
                      </p>
                    )}
                    <div
                      className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-relaxed ${mine ? 'rounded-br-md bg-iris-soft text-ink' : 'rounded-bl-md border border-line bg-white text-ink'}`}
                    >
                      {linkify(m.text)}
                    </div>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>
      <div className="border-t border-line/80 bg-white/70 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-white px-3 py-2 shadow-[var(--shadow-soft)] focus-within:border-iris/40">
          <AutoTextarea
            value={text}
            onChange={setText}
            maxRows={5}
            placeholder="Message everyone"
            className="max-h-40 min-h-6 flex-1 resize-none bg-transparent py-1 text-[0.9375rem] leading-6 outline-none placeholder:text-ink-4"
            aria-label="Message to everyone in the room"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="grid h-9 w-9 flex-none place-items-center rounded-full bg-ink text-white transition-opacity disabled:opacity-30"
            onClick={send}
            disabled={!text.trim() || left < 0}
            aria-label="Send to everyone"
          >
            <ArrowUp size={18} />
          </button>
        </div>
        {left < 200 && <p className={`mt-1 px-1 text-right text-xs ${left < 0 ? 'text-rose' : 'text-ink-4'}`}>{left < 0 ? `${-left} characters too long` : `${left} characters left`}</p>}
      </div>
    </div>
  );
}
