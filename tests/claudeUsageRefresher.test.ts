import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeUsageRefresher } from '../src/shared/claudeUsageRefresher.ts';
import { SpendLedger } from '../src/shared/spendLedger.ts';

describe('ClaudeUsageRefresher', () => {
  const NOW = Date.UTC(2026, 9, 13, 10);
  let dir: string;
  let ledger: SpendLedger;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-refresher-'));
    ledger = new SpendLedger(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts one detached refresh while the cache is stale', () => {
    let starts = 0;
    const refresher = new ClaudeUsageRefresher(ledger, (): void => { starts += 1; });
    refresher.refreshInBackground(NOW);
    refresher.refreshInBackground(NOW + 1);
    expect(starts).toBe(1);
  });

  it('does not start a refresh while the API cache is fresh', () => {
    ledger.writeApiLimit(4500, 523.54, NOW);
    let starts = 0;
    new ClaudeUsageRefresher(ledger, (): void => { starts += 1; }).refreshInBackground(NOW + 30_000);
    expect(starts).toBe(0);
  });

  it('releases the lock when process creation fails', () => {
    const failing = new ClaudeUsageRefresher(ledger, (): void => { throw new Error('spawn failed'); });
    failing.refreshInBackground(NOW);
    let starts = 0;
    new ClaudeUsageRefresher(ledger, (): void => { starts += 1; }).refreshInBackground(NOW + 60_001);
    expect(starts).toBe(1);
  });
});
