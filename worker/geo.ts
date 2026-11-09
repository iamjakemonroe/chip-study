/** GET /api/geo: the visitor's country as Cloudflare sees it, {"country":"GB"}, so the page shows
 * prices in their currency (src/lib/currency.ts). "XX" when it isn't known. Never cached: it's
 * different for every visitor. */
export function geo(request: Request): Response {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
  }
  const raw = (request as Request & { cf?: { country?: unknown } }).cf?.country;
  const country = typeof raw === 'string' && /^[A-Za-z0-9]{2}$/.test(raw) ? raw.toUpperCase() : 'XX';
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({ country }), { status: 200, headers });
}
