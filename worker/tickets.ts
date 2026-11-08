/** Room tickets: what a browser shows to open the room socket, since a WebSocket can't carry a
 * sign-in header. The room keeps each ticket's nonce and lets it be used once, within 60 s; the
 * Worker signs it (HMAC-SHA256 with the room server's secret) so that a made-up ticket is turned
 * away before it reaches, or wakes, any room. */

const enc = new TextEncoder();

export const toBase64Url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (s: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

/** A fresh random nonce (32 bytes, base64url). */
export const newNonce = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

const NONCE = /^[A-Za-z0-9_-]{43}$/;

const key = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const message = (roomId: string, nonce: string, expiresAt: number) => enc.encode(`room-ticket:v1:${roomId}:${nonce}:${expiresAt}`);

export async function signTicket(secret: string, roomId: string, nonce: string, expiresAt: number): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), message(roomId, nonce, expiresAt)));
  return `${nonce}.${expiresAt}.${toBase64Url(sig)}`;
}

/** The ticket's nonce if it is signed for this room and not out of date; else null. Whether it has
 * been used is the room's to say. */
export async function readTicket(secret: string, roomId: string, ticket: string, now: number): Promise<string | null> {
  if (ticket.length > 200) return null;
  const [nonce, expires, sig, extra] = ticket.split('.');
  if (extra !== undefined || !nonce || !NONCE.test(nonce) || !/^\d{1,15}$/.test(expires ?? '')) return null;
  const expiresAt = Number(expires);
  if (expiresAt <= now) return null;
  const bytes = fromBase64Url(sig ?? '');
  if (!bytes || bytes.length !== 32) return null;
  const good = await crypto.subtle.verify('HMAC', await key(secret), bytes, message(roomId, nonce, expiresAt));
  return good ? nonce : null;
}
