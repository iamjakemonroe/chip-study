import { RIDS, type Rid } from '../../shared/rooms.ts';
import { roomSession } from './session.ts';

/** Which simulcast layer each received video should be on, from everything on screen showing it:
 * the best any of them wants (the stage wants f, a large tile h, a small one q), or nothing when
 * none of them is on screen (the media client pauses it after a moment). */

const wants = new Map<string, Map<symbol, Rid | null>>();

function apply(trackName: string) {
  const all = [...(wants.get(trackName)?.values() ?? [])].filter((r): r is Rid => r !== null);
  const best = all.length ? (RIDS.find((r) => all.includes(r)) ?? null) : null;
  roomSession()?.media.want(trackName, best);
}

export function want(trackName: string, key: symbol, rid: Rid | null): void {
  let m = wants.get(trackName);
  if (!m) wants.set(trackName, (m = new Map()));
  m.set(key, rid);
  apply(trackName);
}

export function unwant(trackName: string, key: symbol): void {
  const m = wants.get(trackName);
  if (!m) return;
  m.delete(key);
  if (!m.size) wants.delete(trackName);
  apply(trackName);
}
