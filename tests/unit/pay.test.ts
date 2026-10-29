import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/lib/supabase.ts', () => ({ supabase: { functions: { invoke } } }));

// Each test starts a new session: the answer is kept in the module.
const fresh = () => import('../../src/lib/api.ts');

describe('payStatus', () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
  });

  it('asks once a session, never for longer than PAY_WAIT, and keeps the answer', async () => {
    invoke.mockResolvedValue({ data: { on: true, test: false }, error: null });
    const { knownPayStatus, PAY_WAIT, payStatus } = await fresh();
    expect(knownPayStatus()).toBeNull();
    const [first, second] = await Promise.all([payStatus(), payStatus()]);
    expect(first).toEqual({ on: true, test: false });
    expect(second).toBe(first);
    expect(await payStatus()).toBe(first);
    expect(knownPayStatus()).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('web-pay', { body: { action: 'status' }, timeout: PAY_WAIT });
  });

  it('keeps an answer that Pro isn’t open yet', async () => {
    invoke.mockResolvedValue({ data: { on: false, test: false }, error: null });
    const { knownPayStatus, payStatus } = await fresh();
    expect(await payStatus()).toEqual({ on: false, test: false });
    expect(await payStatus()).toEqual({ on: false, test: false });
    expect(knownPayStatus()).toEqual({ on: false, test: false });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('counts a check that failed or ran out of time as not open, and asks again the next time', async () => {
    invoke
      .mockResolvedValueOnce({ data: null, error: new Error('The request was aborted') })
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ data: { on: true, test: true }, error: null });
    const { knownPayStatus, payStatus } = await fresh();
    expect(await payStatus()).toEqual({ on: false, test: false });
    expect(knownPayStatus()).toBeNull();
    expect(await payStatus()).toEqual({ on: false, test: false });
    expect(await payStatus()).toEqual({ on: true, test: true });
    expect(await payStatus()).toEqual({ on: true, test: true });
    expect(knownPayStatus()).toEqual({ on: true, test: true });
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
