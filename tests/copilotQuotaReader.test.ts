import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotQuotaReader } from '../src/shared/copilotQuotaReader.ts';

describe('CopilotQuotaReader', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-quota-reader-'));
    file = path.join(dir, 'quota.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (state: unknown): void => {
    fs.writeFileSync(file, JSON.stringify(state), 'utf8');
  };

  it('reads a fresh quota snapshot', () => {
    write({
      updatedAt: 10_000,
      quotas: [{ id: 'ai_credits', remainingPercentage: 25, resetDate: '2026-10-02T00:00:00Z' }],
    });

    expect(new CopilotQuotaReader(file, 5_000).read(12_000)).toEqual({
      updatedAt: 10_000,
      quotas: [{ id: 'ai_credits', remainingPercentage: 25, resetDate: '2026-10-02T00:00:00Z' }],
    });
  });

  it('reads the last successful poll timestamp', () => {
    write({
      updatedAt: 10_000,
      polledAt: 9_000,
      quotas: [{ id: 'ai_credits', remainingPercentage: 25 }],
    });

    expect(new CopilotQuotaReader(file).read(12_000)?.polledAt).toBe(9_000);
  });

  it('returns null for missing, malformed, or stale data', () => {
    expect(new CopilotQuotaReader(file).read(10_000)).toBeNull();

    fs.writeFileSync(file, '{invalid', 'utf8');
    expect(new CopilotQuotaReader(file).read(10_000)).toBeNull();

    write({ updatedAt: 1_000, quotas: [{ id: 'quota', remainingPercentage: 50 }] });
    expect(new CopilotQuotaReader(file, 100).read(1_101)).toBeNull();
  });

  it('rejects future timestamps', () => {
    write({ updatedAt: 10_001, quotas: [{ id: 'quota', remainingPercentage: 50 }] });
    expect(new CopilotQuotaReader(file).read(10_000)).toBeNull();
  });

  it('drops reset quotas and malformed entries', () => {
    write({
      updatedAt: 10_000,
      quotas: [
        { id: 'expired', remainingPercentage: 80, resetDate: '1970-01-01T00:00:00Z' },
        { id: 'invalid', remainingPercentage: 120 },
        { id: 'current', remainingPercentage: 15 },
      ],
    });

    expect(new CopilotQuotaReader(file).read(10_000)?.quotas).toEqual([
      { id: 'current', remainingPercentage: 15 },
    ]);
  });
});
