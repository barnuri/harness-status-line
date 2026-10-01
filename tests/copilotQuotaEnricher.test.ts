import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotQuotaEnricher } from '../src/shared/copilotQuotaEnricher.ts';
import { CopilotQuotaReader } from '../src/shared/copilotQuotaReader.ts';

describe('CopilotQuotaEnricher', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-quota-enricher-'));
    file = path.join(dir, 'quota.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('adds cached account quota only to Copilot payloads', () => {
    fs.writeFileSync(file, JSON.stringify({
      updatedAt: 10_000,
      quotas: [{ id: 'ai_credits', remainingPercentage: 15 }],
    }), 'utf8');
    const enricher = new CopilotQuotaEnricher(new CopilotQuotaReader(file));
    const copilotStatus = { username: 'octocat' };
    const claudeStatus = { model: 'claude-sonnet' };

    expect(enricher.apply(copilotStatus, 11_000).copilot_quota?.quotas[0]?.remainingPercentage).toBe(15);
    expect(enricher.apply(claudeStatus, 11_000)).toBe(claudeStatus);
  });

  it('preserves quota data already present on the payload', () => {
    const existing = {
      updatedAt: 10_000,
      quotas: [{ id: 'existing', remainingPercentage: 5 }],
    };
    const status = { username: 'octocat', copilot_quota: existing };

    expect(new CopilotQuotaEnricher(new CopilotQuotaReader(file)).apply(status)).toBe(status);
  });
});
