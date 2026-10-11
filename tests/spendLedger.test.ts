import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SpendLedger } from '../src/shared/spendLedger.ts';

describe('SpendLedger', () => {
  const OCT = Date.UTC(2026, 9, 10, 12);
  const NOV = Date.UTC(2026, 10, 2, 12);
  let dir: string;
  let ledger: SpendLedger;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-ledger-'));
    ledger = new SpendLedger(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sums the last cost of every session in the month', () => {
    ledger.record('a', 1.5, OCT);
    ledger.record('a', 2.5, OCT);
    ledger.record('b', 4, OCT);
    expect(ledger.monthTotal(OCT)).toBe(6.5);
  });

  it('keeps months separate and counts only new-month spend for a spanning session', () => {
    ledger.record('a', 3, OCT);
    ledger.record('a', 5, NOV);
    ledger.record('b', 1, NOV);
    expect(ledger.monthTotal(OCT)).toBe(3);
    expect(ledger.monthTotal(NOV)).toBe(3);
  });

  it('carries spend when a session counter restarts', () => {
    ledger.record('a', 4, OCT);
    ledger.record('a', 1, OCT);
    expect(ledger.monthTotal(OCT)).toBe(5);
  });

  it('ignores unsafe session ids and invalid costs', () => {
    ledger.record('../evil', 9, OCT);
    ledger.record('a', Number.NaN, OCT);
    ledger.record('b', -1, OCT);
    expect(ledger.monthTotal(OCT)).toBe(0);
  });

  it('returns 0 for a month without files and null for a missing limit', () => {
    expect(ledger.monthTotal(OCT)).toBe(0);
    expect(ledger.readLimit()).toBeNull();
  });

  it('reads the cached limit and skips corrupt session files', () => {
    fs.writeFileSync(path.join(dir, 'limit.json'), JSON.stringify({ limit_usd: 4500 }));
    fs.mkdirSync(path.join(dir, '2026-10'));
    fs.writeFileSync(path.join(dir, '2026-10', 'bad.json'), '{not json');
    fs.writeFileSync(path.join(dir, '2026-10', 'partial.json'), JSON.stringify({ last_usd: 2 }));
    expect(ledger.readLimit()?.limit_usd).toBe(4500);
    expect(ledger.monthTotal(OCT)).toBe(0);
  });

  it('computes the month key and next reset in UTC', () => {
    expect(ledger.monthKey(Date.UTC(2026, 11, 31, 23))).toBe('2026-12');
    expect(ledger.nextMonthStartSecs(Date.UTC(2026, 11, 31, 23))).toBe(Date.UTC(2027, 0, 1) / 1000);
  });

  it('previous month of January is December of the prior year', () => {
    ledger.record('a', 2, Date.UTC(2026, 11, 20));
    ledger.record('a', 3, Date.UTC(2027, 0, 2));
    expect(ledger.monthTotal(Date.UTC(2027, 0, 2))).toBe(1);
  });
});
