import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CursorStatusEnricher } from '../src/shared/cursorStatusEnricher.ts';
import { CursorUsageStore } from '../src/shared/cursorUsageStore.ts';
import { CursorUsageClient } from '../src/shared/cursorUsageClient.ts';
import { CursorAccessTokenReader } from '../src/shared/cursorAccessTokenReader.ts';

describe('CursorStatusEnricher', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-enrich-'));
    file = path.join(dir, 'cursor-usage.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function enricher(): CursorStatusEnricher {
    const store = new CursorUsageStore(file, 60_000);
    const client = new CursorUsageClient(new CursorAccessTokenReader(path.join(dir, 'missing.vscdb')), store);
    return new CursorStatusEnricher(store, client);
  }

  it('leaves a Claude-shaped payload unchanged', () => {
    const status = { model: { display_name: 'Sonnet' } };
    expect(enricher().apply(status, Date.now())).toEqual(status);
  });

  it('merges cached credits onto a Cursor payload that has no quotas', () => {
    const store = new CursorUsageStore(file);
    store.write({
      credits: { remaining: 12.34, unit: 'usd', used_percentage: 20 },
      rate_limits: { day: { used_percentage: 10 } },
      captured_at: '2026-08-25T11:00:00Z',
    });
    const client = new CursorUsageClient(new CursorAccessTokenReader(path.join(dir, 'missing.vscdb')), store);
    const result = new CursorStatusEnricher(store, client).apply({ autorun: false }, Date.now());
    expect(result.credits?.remaining).toBe(12.34);
    expect(result.rate_limits?.day?.used_percentage).toBe(10);
  });

  it('does not overwrite credits already on the payload', () => {
    const store = new CursorUsageStore(file);
    store.write({ credits: { remaining: 99, unit: 'usd' }, captured_at: '2026-08-25T11:00:00Z' });
    const client = new CursorUsageClient(new CursorAccessTokenReader(path.join(dir, 'missing.vscdb')), store);
    const result = new CursorStatusEnricher(store, client).apply({
      autorun: false,
      credits: { remaining: 1, unit: 'usd' },
    }, Date.now());
    expect(result.credits?.remaining).toBe(1);
  });
});
