import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeCredentialReader } from '../src/shared/claudeCredentialReader.ts';
import { ClaudeUsageClient } from '../src/shared/claudeUsageClient.ts';
import { SpendLedger } from '../src/shared/spendLedger.ts';

describe('ClaudeUsageClient', () => {
  const NOW = Date.UTC(2026, 9, 13, 10);
  let dir: string;
  let ledger: SpendLedger;
  let credentialReader: ClaudeCredentialReader;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-client-'));
    ledger = new SpendLedger(dir);
    credentialReader = new ClaudeCredentialReader();
    credentialReader.read = async (): Promise<string> => 'test-token';
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('maps minor USD units and writes the spend cache', async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
      return new Response(JSON.stringify({
        extra_usage: {
          currency: 'USD',
          decimal_places: 2,
          monthly_limit: 450000,
          used_credits: 52354,
        },
      }), { status: 200 });
    }) as typeof fetch;
    const refreshed = await new ClaudeUsageClient(credentialReader, ledger, fetchImpl).refresh(NOW);
    expect(refreshed).toBe(true);
    expect(ledger.readLimit()).toEqual({
      limit_usd: 4500,
      api: {
        month: '2026-10',
        used_usd: 523.54,
        captured_at: new Date(NOW).toISOString(),
      },
    });
  });

  it('rejects unsupported currency and invalid numeric fields', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      extra_usage: {
        currency: 'EUR',
        decimal_places: 2,
        monthly_limit: 100,
        used_credits: 5,
      },
    }), { status: 200 })) as typeof fetch;
    const refreshed = await new ClaudeUsageClient(credentialReader, ledger, fetchImpl).refresh(NOW);
    expect(refreshed).toBe(false);
    expect(ledger.readLimit()).toBeNull();
  });

  it('skips the request when Keychain has no token', async () => {
    credentialReader.read = async (): Promise<null> => null;
    let requested = false;
    const fetchImpl = (async () => {
      requested = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const refreshed = await new ClaudeUsageClient(credentialReader, ledger, fetchImpl).refresh(NOW);
    expect(refreshed).toBe(false);
    expect(requested).toBe(false);
  });
});
