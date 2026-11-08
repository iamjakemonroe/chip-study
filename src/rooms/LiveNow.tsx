import { ArrowRight, Building2, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { myRooms, type MyRoom } from './api.ts';

/** On the desk: study rooms running now that you host, are in, or are invited to. */
export function LiveNow() {
  const [rooms, setRooms] = useState<MyRoom[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      myRooms()
        .then((r) => live && setRooms(r))
        .catch(() => undefined);
    void load();
    const t = setInterval(() => document.visibilityState !== 'hidden' && void load(), 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  if (!rooms.length) return null;
  return (
    <section className="card mt-4 p-4 sm:p-5" aria-labelledby="live-now">
      <h2 id="live-now" className="flex items-center gap-2 text-sm font-semibold text-ink-2">
        <span className="room-live" aria-hidden="true" /> Live now
      </h2>
      <ul className="mt-3 space-y-2">
        {rooms.map((r) => (
          <li key={r.id}>
            <Link to={`/room/${r.token}`} className="group flex items-center gap-3 rounded-2xl border border-line bg-white/70 px-3.5 py-3 transition-colors hover:bg-white">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.title}</p>
                <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-ink-3">
                  {r.institution && <Building2 size={12} className="flex-none" />}
                  <span className="truncate">
                    {r.mine ? 'Your room' : `Hosted by ${r.host}`}
                    {r.institution ? ` · ${r.institution}` : ''}
                  </span>
                  {r.ends_at && (
                    <span className="flex flex-none items-center gap-1">
                      · <Clock size={12} /> until {new Date(r.ends_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  )}
                </p>
              </div>
              <span className="btn btn-primary btn-sm pointer-events-none flex-none">
                {r.mine ? 'Go back in' : 'Join'} <ArrowRight size={14} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
