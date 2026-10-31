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

  it('reads token-billed AI credit quota from the live copilot_internal/user shape', async () => {
    const client = new GhCopilotQuotaClient(async (args: readonly string[]) => {
      if (args[0] === 'auth' && args[1] === 'status') {
        return {
          success: true,
          stdout: JSON.stringify({
            hosts: { 'github.com': [{ state: 'success', login: 'business' }] },
          }),
        };
      }
      if (args[0] === 'auth' && args[1] === 'token') {
        return { success: true, stdout: 'business-token\n' };
      }
      return {
        success: true,
        stdout: JSON.stringify({
          quota_reset_date: '2026-11-01',
          quota_reset_date_utc: '2026-11-01T00:00:00Z',
          quota_snapshots: {
            premium_interactions: {
              credits_used: 12_626,
              entitlement: 33_000,
              remaining: 20_489,
              quota_remaining: 20_489.9,
              percent_remaining: 62.0,
              overage_permitted: true,
              token_based_billing: true,
              unlimited: false,
            },
          },
        }),
      };
    });

    expect(await client.fetchSnapshot()).toEqual({
      login: 'business',
      snapshot: {
        isUnlimitedEntitlement: false,
        entitlementRequests: 33_000,
        usedRequests: 12_626,
        remainingPercentage: 62,
        remainingRequests: 20_489,
        tokenBasedBilling: true,
        overagePermitted: true,
        resetDate: '2026-11-01T00:00:00Z',
      },
    });
  });

  it('derives usage from remaining when credits_used is missing', async () => {
    const client = new GhCopilotQuotaClient(async (args: readonly string[]) => {
      if (args[0] === 'auth' && args[1] === 'status') {
        return {
          success: true,
          stdout: JSON.stringify({
            hosts: { 'github.com': [{ state: 'success', login: 'business' }] },
          }),
        };
      }
      if (args[0] === 'auth' && args[1] === 'token') {
        return { success: true, stdout: 'business-token\n' };
      }
      return {
        success: true,
        stdout: JSON.stringify({
          quota_snapshots: {
            premium_interactions: { entitlement: 300, remaining: 180, percent_remaining: 60 },
          },
        }),
      };
    });

    expect((await client.fetchSnapshot())?.snapshot).toMatchObject({
      entitlementRequests: 300,
      usedRequests: 120,
      remainingRequests: 180,
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

  it('preserves the previous value when any authenticated account lookup fails', async () => {
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
        if (env['GH_TOKEN'] === 'second-token') {
          return { success: false, stdout: '' };
        }
        return {
          success: true,
          stdout: JSON.stringify({
            quota_snapshots: {
              premium_interactions: {
                entitlement: 14_400,
                credits_used: 7_766,
                percent_remaining: 46,
              },
            },
          }),
        };
      },
    );

    expect(await client.fetchSnapshot(14_400)).toBeNull();
  });
});
