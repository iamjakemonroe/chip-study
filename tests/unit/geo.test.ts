import { describe, expect, it } from 'vitest';
import { geo } from '../../worker/geo.ts';

describe('GET /api/geo', () => {
  const ask = (cf: unknown, method = 'GET') => {
    const r = new Request('https://study.kaivon.app/api/geo', { method });
    if (cf !== undefined) Object.defineProperty(r, 'cf', { value: cf });
    return geo(r);
  };

  it('answers the country Cloudflare sees, never cached', async () => {
    const res = ask({ country: 'GB' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ country: 'GB' });
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await ask({ country: 'ng' }).json()).toEqual({ country: 'NG' });
    expect(await ask({ country: 'T1' }).json()).toEqual({ country: 'T1' });
  });

  it('says XX when it isn’t known', async () => {
    expect(await ask(undefined).json()).toEqual({ country: 'XX' });
    expect(await ask({}).json()).toEqual({ country: 'XX' });
    expect(await ask({ country: 'GBR' }).json()).toEqual({ country: 'XX' });
  });

  it('takes GET and HEAD only', async () => {
    const head = ask({ country: 'US' }, 'HEAD');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = ask({ country: 'US' }, 'POST');
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });
});
