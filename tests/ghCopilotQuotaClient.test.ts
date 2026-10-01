import { describe, expect, it } from 'bun:test';
import { GhCopilotQuotaClient } from '../extensions/harness-status-line-quota/ghCopilotQuotaClient.mjs';

interface CommandResult {
  readonly success: boolean;
  readonly stdout: string;
}

describe('GhCopilotQuotaClient', () => {
  it('selects the authenticated account matching the existing entitlement', async () => {
    const client = new GhCopilotQuotaClient(
      async (args: readonly string[], env: Readonly<Record<string, string>> = {}) => {
        if (args[0] === 'auth' && args[1] === 'status') {
          return {
            success: true,
            stdout: JSON.stringify({
              hosts: {
                'github.com': [
                  { state: 'success', login: 'personal' },
                  { state: 'success', login: 'business' },
                ],
              },
            }),
          };
        }
        if (args[0] === 'auth' && args[1] === 'token') {
          return { success: true, stdout: `${args.at(-1)}-token\n` };
        }
        if (env['GH_TOKEN'] === 'business-token') {
          return {
            success: true,
            stdout: JSON.stringify({
              quota_reset_date: '2026-11-01',
              quota_snapshots: {
                premium_interactions: {
                  entitlement: 14_400,
                  credits_used: 6_080,
                  percent_remaining: 58,
                },
              },
            }),
          };
        }
        return {
          success: true,
          stdout: JSON.stringify({
            quota_reset_date: '2026-11-01',
            quota_snapshots: {
              premium_interactions: { entitlement: 0, credits_used: 0, percent_remaining: 0 },
            },
          }),
        };
      },
    );

    expect(await client.fetchSnapshot(14_400)).toEqual({
      login: 'business',
      snapshot: {
        isUnlimitedEntitlement: false,
        entitlementRequests: 14_400,
        usedRequests: 6_080,
        remainingPercentage: 58,
        resetDate: '2026-11-01T00:00:00Z',
      },
    });
  });

  it('returns null when GitHub CLI authentication or quota responses are unavailable', async () => {
    const authFailure = new GhCopilotQuotaClient(async () => ({ success: false, stdout: '' }));
    expect(await authFailure.fetchSnapshot()).toBeNull();

    const invalidResponses: readonly CommandResult[] = [
      {
        success: true,
        stdout: JSON.stringify({
          hosts: { 'github.com': [{ state: 'success', login: 'business' }] },
        }),
      },
      { success: true, stdout: 'token\n' },
      { success: true, stdout: '{invalid' },
    ];
    let commandIndex = 0;
    const invalidQuota = new GhCopilotQuotaClient(
      async () => invalidResponses[commandIndex++] ?? { success: false, stdout: '' },
    );
    expect(await invalidQuota.fetchSnapshot()).toBeNull();
  });

  it('preserves the previous value when multiple accounts are ambiguous', async () => {
    const client = new GhCopilotQuotaClient(
      async (args: readonly string[], env: Readonly<Record<string, string>> = {}) => {
        if (args[0] === 'auth' && args[1] === 'status') {
          return {
            success: true,
            stdout: JSON.stringify({
              hosts: {
                'github.com': [
                  { state: 'success', login: 'first' },
                  { state: 'success', login: 'second' },
                ],
              },
            }),
          };
        }
        if (args[0] === 'auth' && args[1] === 'token') {
          return { success: true, stdout: `${args.at(-1)}-token\n` };
        }
        const first = env['GH_TOKEN'] === 'first-token';
        return {
          success: true,
          stdout: JSON.stringify({
            quota_snapshots: {
              premium_interactions: {
                entitlement: first ? 1_000 : 2_000,
                credits_used: first ? 100 : 200,
                percent_remaining: 90,
              },
            },
          }),
        };
      },
    );

    expect(await client.fetchSnapshot()).toBeNull();
  });
});
