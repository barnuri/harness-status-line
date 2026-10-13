import { ClaudeCredentialReader } from './claudeCredentialReader.ts';
import { SpendLedger } from './spendLedger.ts';

export class ClaudeUsageClient {
  private static readonly USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
  private static readonly OAUTH_BETA = 'oauth-2025-04-20';
  private static readonly FETCH_TIMEOUT_MS = 5_000;

  private readonly credentialReader: ClaudeCredentialReader;
  private readonly ledger: SpendLedger;
  private readonly fetchImpl: typeof fetch;

  constructor(
    credentialReader?: ClaudeCredentialReader,
    ledger?: SpendLedger,
    fetchImpl?: typeof fetch,
  ) {
    this.credentialReader = credentialReader ?? new ClaudeCredentialReader();
    this.ledger = ledger ?? new SpendLedger();
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async refresh(nowMs: number = Date.now()): Promise<boolean> {
    const token = await this.credentialReader.read();
    if (!token) {
      return false;
    }
    try {
      const response = await this.fetchImpl(ClaudeUsageClient.USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': ClaudeUsageClient.OAUTH_BETA,
        },
        signal: AbortSignal.timeout(ClaudeUsageClient.FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        return false;
      }
      const usage = this.extractExtraUsage(await response.json());
      if (!usage) {
        return false;
      }
      this.ledger.writeApiLimit(usage.limitUsd, usage.usedUsd, nowMs);
      return true;
    } catch (err: unknown) {
      if (err instanceof Error) {
        return false;
      }
      throw err;
    }
  }

  private extractExtraUsage(raw: unknown): { readonly limitUsd: number; readonly usedUsd: number } | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return null;
    }
    const extraUsage = (raw as { extra_usage?: unknown }).extra_usage;
    if (typeof extraUsage !== 'object' || extraUsage === null || Array.isArray(extraUsage)) {
      return null;
    }
    const fields = extraUsage as {
      readonly currency?: unknown;
      readonly decimal_places?: unknown;
      readonly monthly_limit?: unknown;
      readonly used_credits?: unknown;
    };
    if (fields.currency !== 'USD') {
      return null;
    }
    if (
      typeof fields.decimal_places !== 'number'
      || !Number.isInteger(fields.decimal_places)
      || fields.decimal_places < 0
      || fields.decimal_places > 6
    ) {
      return null;
    }
    if (typeof fields.monthly_limit !== 'number' || fields.monthly_limit <= 0) {
      return null;
    }
    if (typeof fields.used_credits !== 'number' || fields.used_credits < 0) {
      return null;
    }
    const divisor = 10 ** fields.decimal_places;
    return {
      limitUsd: fields.monthly_limit / divisor,
      usedUsd: fields.used_credits / divisor,
    };
  }
}
