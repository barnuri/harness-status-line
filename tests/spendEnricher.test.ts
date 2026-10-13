import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SpendLedger } from '../src/shared/spendLedger.ts';
import { SpendEnricher } from '../src/shared/spendEnricher.ts';
import { ClaudeUsageRefresher } from '../src/shared/claudeUsageRefresher.ts';

describe('SpendEnricher', () => {
  const OCT = Date.UTC(2026, 9, 10, 12);
  let dir: string;
  let enricher: SpendEnricher;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-enricher-'));
    const ledger = new SpendLedger(dir);
    const refresher = { refreshInBackground: (): void => {} } as unknown as ClaudeUsageRefresher;
    enricher = new SpendEnricher(ledger, refresher);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeLimit = (value: unknown): void => {
    fs.writeFileSync(path.join(dir, 'limit.json'), JSON.stringify(value));
  };

  it('uses the local session sum when it exceeds the cached API reading', () => {
    writeLimit({ limit_usd: 4500, api: { month: '2026-10', used_usd: 19.93 } });
    enricher.apply({ session_id: 'other', cost: { total_cost_usd: 10 } }, OCT);
    const status = enricher.apply({ session_id: 'me', cost: { total_cost_usd: 35 } }, OCT);
    const spend = status.rate_limits?.['spend_limit'];
    expect(spend?.used_usd).toBe(45);
    expect(spend?.limit_usd).toBe(4500);
    expect(spend?.used_percentage).toBeCloseTo(1);
    expect(spend?.resets_at).toBe(Date.UTC(2026, 10, 1) / 1000);
    expect(spend?.period).toBe('monthly');
  });

  it('uses the cached API reading when it exceeds the local sum', () => {
    writeLimit({ limit_usd: 4500, api: { month: '2026-10', used_usd: 19.93 } });
    const status = enricher.apply({ session_id: 'me', cost: { total_cost_usd: 2 } }, OCT);
    expect(status.rate_limits?.['spend_limit']?.used_usd).toBe(19.93);
  });

  it('ignores an API reading from another month', () => {
    writeLimit({ limit_usd: 100, api: { month: '2026-09', used_usd: 50 } });
    const status = enricher.apply({ session_id: 'me', cost: { total_cost_usd: 5 } }, OCT);
    expect(status.rate_limits?.['spend_limit']?.used_usd).toBe(5);
  });

  it('records cost but adds nothing without a cached limit', () => {
    const input = { session_id: 'me', cost: { total_cost_usd: 5 } };
    expect(enricher.apply(input, OCT)).toBe(input);
    expect(new SpendLedger(dir).monthTotal(OCT)).toBe(5);
  });

  it('takes max of stdin spend_limit and local sum, keeping stdin limit and reset', () => {
    const resets_at = Date.UTC(2026, 10, 1) / 1000 + 7200;
    const stdin = { used_usd: 3, limit_usd: 200, used_percentage: 1.5, resets_at, period: 'weekly' as const };
    const low = enricher.apply({ session_id: 'me', cost: { total_cost_usd: 1 }, rate_limits: { spend_limit: stdin } }, OCT);
    expect(low.rate_limits?.['spend_limit']?.used_usd).toBe(3);
    const high = enricher.apply({ session_id: 'me', cost: { total_cost_usd: 10 }, rate_limits: { spend_limit: stdin } }, OCT);
    const spend = high.rate_limits?.['spend_limit'];
    expect(spend?.used_usd).toBe(10);
    expect(spend?.used_percentage).toBe(5);
    expect(spend?.resets_at).toBe(resets_at);
    expect(spend?.period).toBe('weekly');
  });

  it('passes a stdin spend_limit without usd through unchanged', () => {
    const stdin = { used_percentage: 7 };
    const status = enricher.apply({ session_id: 'me', cost: { total_cost_usd: 5 }, rate_limits: { spend_limit: stdin } }, OCT);
    expect(status.rate_limits?.['spend_limit']).toBe(stdin);
  });

  it('converts a stdin percentage to usd with the cached limit', () => {
    writeLimit({ limit_usd: 200 });
    const status = enricher.apply({ session_id: 'me', cost: { total_cost_usd: 1 }, rate_limits: { spend_limit: { used_percentage: 10 } } }, OCT);
    expect(status.rate_limits?.['spend_limit']?.used_usd).toBe(20);
  });

  it('skips Copilot, Cursor and payloads without cost or session', () => {
    writeLimit({ limit_usd: 100 });
    const copilot = { session_id: 'c', username: 'u', cost: { total_cost_usd: 5 } };
    const cursor = { session_id: 'k', render_width_chars: 80, cost: { total_cost_usd: 5 } };
    const noCost = { session_id: 'n' };
    const noSession = { cost: { total_cost_usd: 5 } };
    for (const input of [copilot, cursor, noCost, noSession]) {
      expect(enricher.apply(input, OCT)).toBe(input);
    }
    expect(new SpendLedger(dir).monthTotal(OCT)).toBe(0);
  });

  it('keeps existing subscription windows next to the synthesized spend_limit', () => {
    writeLimit({ limit_usd: 100 });
    const status = enricher.apply({ session_id: 'me', cost: { total_cost_usd: 5 }, rate_limits: { five_hour: { used_percentage: 3 } } }, OCT);
    expect(status.rate_limits?.['five_hour']?.used_percentage).toBe(3);
    expect(status.rate_limits?.['spend_limit']?.used_usd).toBe(5);
  });

  it('requests a live refresh only for a complete Claude payload', () => {
    let refreshes = 0;
    const refresher = {
      refreshInBackground: (): void => { refreshes += 1; },
    } as unknown as ClaudeUsageRefresher;
    const isolated = new SpendEnricher(new SpendLedger(dir), refresher);
    isolated.apply({ session_id: 'claude', cost: { total_cost_usd: 1 } }, OCT);
    isolated.apply({ session_id: 'cursor', render_width_chars: 80, cost: { total_cost_usd: 1 } }, OCT);
    isolated.apply({ session_id: 'missing-cost' }, OCT);
    expect(refreshes).toBe(1);
  });
});
