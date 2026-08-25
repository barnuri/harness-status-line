import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CursorUsageStore } from '../src/shared/cursorUsageStore.ts';

describe('CursorUsageStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-usage-'));
    file = path.join(dir, 'cursor-usage.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the file is missing', () => {
    expect(new CursorUsageStore(file).read()).toBeNull();
  });

  it('round-trips a snapshot', () => {
    const store = new CursorUsageStore(file);
    store.write({
      credits: { remaining: 12.34, unit: 'usd', used_percentage: 20 },
      captured_at: '2026-08-25T11:00:00Z',
    });
    expect(store.read()?.credits?.remaining).toBe(12.34);
  });

  it('treats a recent captured_at as fresh', () => {
    const nowMs = Date.parse('2026-08-25T11:00:00Z');
    const store = new CursorUsageStore(file, 120_000);
    store.write({ captured_at: '2026-08-25T10:59:00Z', credits: { remaining: 1, unit: 'usd' } });
    expect(store.isFresh(nowMs)).toBe(true);
  });

  it('treats an old captured_at as stale', () => {
    const nowMs = Date.parse('2026-08-25T11:00:00Z');
    const store = new CursorUsageStore(file, 120_000);
    store.write({ captured_at: '2026-08-25T10:50:00Z', credits: { remaining: 1, unit: 'usd' } });
    expect(store.isFresh(nowMs)).toBe(false);
  });

  it('returns null for malformed JSON', () => {
    fs.writeFileSync(file, '{nope', 'utf-8');
    expect(new CursorUsageStore(file).read()).toBeNull();
  });
});
