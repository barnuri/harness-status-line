import { describe, expect, it } from 'bun:test';
import { CursorUsageMapper } from '../src/shared/cursorUsageMapper.ts';

describe('CursorUsageMapper', () => {
  const mapper = new CursorUsageMapper();
  const capturedAt = '2026-08-25T11:00:00Z';

  it('maps planUsage cents to dollar credits', () => {
    const snapshot = mapper.map({
      planUsage: { totalSpend: 1234, limit: 5000, totalPercentUsed: 24.68 },
    }, capturedAt);
    expect(snapshot?.credits).toEqual({
      unit: 'usd',
      used: 12.34,
      limit: 50,
      remaining: 37.66,
      used_percentage: 25,
    });
    expect(snapshot?.captured_at).toBe(capturedAt);
  });

  it('uses remaining cents when provided', () => {
    const snapshot = mapper.map({
      planUsage: { remaining: 2500, limit: 10000 },
    }, capturedAt);
    expect(snapshot?.credits?.remaining).toBe(25);
    expect(snapshot?.credits?.limit).toBe(100);
    expect(snapshot?.credits?.used_percentage).toBe(75);
  });

  it('falls back to spendLimitUsage pool when planUsage is empty', () => {
    const snapshot = mapper.map({
      spendLimitUsage: { pooledUsed: 800, pooledLimit: 2000, pooledRemaining: 1200 },
    }, capturedAt);
    expect(snapshot?.credits).toEqual({
      unit: 'usd',
      used: 8,
      limit: 20,
      remaining: 12,
      used_percentage: 40,
    });
  });

  it('maps daily and weekly windows onto rate_limits', () => {
    const snapshot = mapper.map({
      planUsage: { totalSpend: 100, limit: 1000 },
      daily: { used_percentage: 10, resets_at: 1780000000 },
      weekly: { used_percentage: 40 },
    }, capturedAt);
    expect(snapshot?.rate_limits?.day).toEqual({ used_percentage: 10, resets_at: 1780000000 });
    expect(snapshot?.rate_limits?.week).toEqual({ used_percentage: 40 });
  });

  it('maps /auth/usage request buckets to credits', () => {
    const snapshot = mapper.map({
      'gpt-4': {
        numRequests: 200,
        numRequestsTotal: 200,
        numTokens: 0,
        maxRequestUsage: 1000,
        maxTokenUsage: null,
      },
      startOfMonth: '2026-08-01T00:00:00.000Z',
    }, capturedAt);
    expect(snapshot?.credits).toEqual({
      unit: 'requests',
      used: 200,
      limit: 1000,
      remaining: 800,
      used_percentage: 20,
      resets_at: Date.parse('2026-09-01T00:00:00.000Z') / 1000,
    });
  });

  it('clamps remaining at 0 when the request pool is exhausted', () => {
    const snapshot = mapper.map({
      'gpt-4': { numRequests: 1016, maxRequestUsage: 1000 },
    }, capturedAt);
    expect(snapshot?.credits?.remaining).toBe(0);
    expect(snapshot?.credits?.used).toBe(1016);
    expect(snapshot?.credits?.used_percentage).toBe(102);
  });

  it('prefers planUsage dollars over /auth/usage request buckets when merging', () => {
    const period = mapper.map({ planUsage: { totalSpend: 100, limit: 1000 } }, capturedAt);
    const auth = mapper.map({ 'gpt-4': { numRequests: 10, maxRequestUsage: 100 } }, capturedAt);
    const merged = mapper.merge(period, auth, capturedAt);
    expect(merged?.credits?.unit).toBe('usd');
    expect(merged?.credits?.remaining).toBe(9);
  });

  it('keeps /auth/usage credits when the period payload has no quota fields', () => {
    const period = mapper.map({ billingCycleStart: '1', billingCycleEnd: '1', displayThreshold: 100 }, capturedAt);
    const auth = mapper.map({ 'gpt-4': { numRequests: 10, maxRequestUsage: 100 } }, capturedAt);
    const merged = mapper.merge(period, auth, capturedAt);
    expect(merged?.credits?.unit).toBe('requests');
    expect(merged?.credits?.remaining).toBe(90);
  });

  it('returns null for an empty object', () => {
    expect(mapper.map({}, capturedAt)).toBeNull();
  });

  it('returns null for non-objects', () => {
    expect(mapper.map(null, capturedAt)).toBeNull();
    expect(mapper.map([], capturedAt)).toBeNull();
  });
});
