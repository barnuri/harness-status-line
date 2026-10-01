import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotQuotaWriter } from '../extensions/harness-status-line-quota/quotaWriter.mjs';

describe('CopilotQuotaWriter', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-quota-writer-'));
    file = path.join(dir, 'quota.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes finite quota snapshots with usage and reset metadata', () => {
    const writer = new CopilotQuotaWriter(file);
    const resetDate = '2026-10-01T00:00:00.000Z';
    const wrote = writer.write({
      premium_interactions: {
        isUnlimitedEntitlement: false,
        entitlementRequests: 14_400,
        usedRequests: 14_166,
        remainingPercentage: 1.625,
        resetDate,
      },
    }, 1_000);

    expect(wrote).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      updatedAt: 1_000,
      quotas: [{
        id: 'premium_interactions',
        used: 14_166,
        entitlement: 14_400,
        remainingPercentage: 1.625,
        resetDate,
      }],
    });
  });

  it('derives remaining percentage and omits unlimited or invalid quotas', () => {
    const writer = new CopilotQuotaWriter(file);
    const wrote = writer.write({
      limited: {
        isUnlimitedEntitlement: false,
        entitlementRequests: 200,
        usedRequests: 50,
        remainingPercentage: 101,
      },
      unlimited: {
        isUnlimitedEntitlement: true,
        entitlementRequests: -1,
        usedRequests: 10,
        remainingPercentage: 90,
      },
      invalid: { entitlementRequests: 0, remainingPercentage: 50 },
    }, 2_000);

    expect(wrote).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).quotas).toEqual([
      { id: 'limited', used: 50, entitlement: 200, remainingPercentage: 75 },
    ]);
  });

  it('preserves the last valid quota when incoming snapshots contain no usable quota', () => {
    const writer = new CopilotQuotaWriter(file);
    writer.write({
      premium_interactions: {
        entitlementRequests: 14_400,
        usedRequests: 1_000,
        remainingPercentage: 93,
      },
    }, 2_000);

    expect(writer.write(null)).toBe(false);
    expect(writer.write({ invalid: { entitlementRequests: 0 } }, 3_000)).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).updatedAt).toBe(2_000);
  });

  it('records successful empty polls without losing the last quota or poll timestamp on events', () => {
    const writer = new CopilotQuotaWriter(file);
    expect(writer.getPolledAt()).toBeNull();
    writer.write({
      premium_interactions: {
        entitlementRequests: 14_400,
        usedRequests: 1_000,
        remainingPercentage: 93,
      },
    }, 2_000);

    writer.markPolled(3_000);
    expect(writer.getPolledAt()).toBe(3_000);

    writer.write({
      premium_interactions: {
        entitlementRequests: 14_400,
        usedRequests: 1_100,
        remainingPercentage: 92.36,
      },
    }, 4_000);

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      updatedAt: 4_000,
      polledAt: 3_000,
      quotas: [{
        id: 'premium_interactions',
        used: 1_100,
        entitlement: 14_400,
        remainingPercentage: 92.36,
      }],
    });
  });
});
