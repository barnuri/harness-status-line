import { describe, expect, it } from 'bun:test';
import { GhCopilotQuotaClient } from '../extensions/harness-status-line-quota/ghCopilotQuotaClient.mjs';

interface CommandResult {
  readonly success: boolean;
  readonly stdout: string;
}

describe('GhCopilotQuotaClient', () => {
  it('selects the authenticated account with the largest finite premium quota', () => {
    const commands: readonly CommandResult[] = [
      {
        success: true,
        stdout: JSON.stringify({
          hosts: {
            'github.com': [
              { state: 'success', login: 'personal' },
              { state: 'success', login: 'business' },
            ],
          },
        }),
      },
      { success: true, stdout: 'personal-token\n' },
      {
        success: true,
        stdout: JSON.stringify({
          quota_reset_date: '2026-11-01',
          quota_snapshots: {
            premium_interactions: { entitlement: 0, credits_used: 0, percent_remaining: 0 },
          },
        }),
      },
      { success: true, stdout: 'business-token\n' },
      {
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
      },
    ];
    let commandIndex = 0;
    const client = new GhCopilotQuotaClient(() => commands[commandIndex++] ?? { success: false, stdout: '' });

    expect(client.fetchSnapshot()).toEqual({
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

  it('returns null when GitHub CLI authentication or quota responses are unavailable', () => {
    const authFailure = new GhCopilotQuotaClient(() => ({ success: false, stdout: '' }));
    expect(authFailure.fetchSnapshot()).toBeNull();

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
      () => invalidResponses[commandIndex++] ?? { success: false, stdout: '' },
    );
    expect(invalidQuota.fetchSnapshot()).toBeNull();
  });
});
