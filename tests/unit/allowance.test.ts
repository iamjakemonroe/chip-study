import { describe as group, expect, it } from 'vitest';
import { chipTime, describe, modelFor } from '../../src/lib/allowance.ts';
import type { Me } from '../../src/lib/types.ts';

const now = new Date('2026-10-28T20:00:00Z');
const base: Me = {
  tier: 'free',
  name: 'Ada',
  pro_until: null,
  resets_at: '2026-10-29T00:00:00Z',
  fast: { used: 0, cap: 0.03, avg: 0.001 },
  best: null,
  uploads: { used: 0, cap: 3, max_mb: 4 },
  readings: { used: 0, cap: 3, max_chars: 60000 },
  price: { amount: 4.99, currency: 'USD' },
};
const pro: Me = {
  ...base,
  tier: 'pro',
  pro_until: '2026-11-20T00:00:00Z',
  fast: { used: 0, cap: 0.05, avg: 0.001 },
  best: { used: 0.1, cap: 0.4, avg: 0.03, period_used: 1, period_cap: 3 },
};

group('Chip time', () => {
  it('a free day: the share left and messages at the usual cost', () => {
    const t = chipTime({ ...base, fast: { used: 0.006, cap: 0.03, avg: 0.0012 } }, 'fast')!;
    expect(t.share).toBeCloseTo(0.8);
    expect(t.messages).toBe(20);
    expect(describe(t, now)).toBe('About 20 messages left today');
  });
  it('lots left reads as plenty', () => {
    expect(describe(chipTime({ ...base, fast: { used: 0, cap: 0.05, avg: 0.0001 } }, 'fast')!, now)).toBe('Plenty left today');
  });
  it('a sliver left is still one message', () => {
    const t = chipTime({ ...base, fast: { used: 0.0299, cap: 0.03, avg: 0.001 } }, 'fast')!;
    expect(t.messages).toBe(1);
    expect(describe(t, now)).toBe('1 message left today');
  });
  it('used up (or over, after settling): nothing left, and when it is back', () => {
    const t = chipTime({ ...base, fast: { used: 0.031, cap: 0.03, avg: 0.001 } }, 'fast')!;
    expect(t.share).toBe(0);
    expect(t.messages).toBe(0);
    expect(describe(t, now)).toMatch(/^Back at /);
  });
  it('no best model on a free account', () => {
    expect(chipTime(base, 'best')).toBeNull();
    expect(modelFor(base, 'best')).toBe('fast');
  });
  it("Pro's best model: limited by the day", () => {
    const t = chipTime(pro, 'best')!;
    expect(t.messages).toBe(10);
    expect(t.by).toBe('day');
    expect(t.share).toBeCloseTo(0.75);
    expect(modelFor(pro, 'best')).toBe('best');
  });
  it("…or by the month, when that's nearly used", () => {
    const t = chipTime({ ...pro, best: { ...pro.best!, period_used: 2.94 } }, 'best')!;
    expect(t.by).toBe('period');
    expect(t.messages).toBe(2);
    expect(describe(t, now)).toBe('About 2 messages left this month');
  });
  it('once the best model is used, messages go to Fast', () => {
    expect(modelFor({ ...pro, best: { ...pro.best!, used: 0.4 } }, 'best')).toBe('fast');
    expect(modelFor(pro, 'fast')).toBe('fast');
    expect(modelFor(null, 'best')).toBe('fast');
  });
});
