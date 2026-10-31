import type { CopilotQuotaState, LlmHubDecisionLookup } from '../types.ts';
import { CopilotQuotaReader } from './copilotQuotaReader.ts';

export class LlmHubClient {
  static readonly DEFAULT_TIMEOUT_MS = 300;
  private static readonly DECISIONS_PATH = '/api/copilot/auto/decisions';
  private static readonly USAGE_PATH = '/api/copilot/usage';

  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly quotaReader = new CopilotQuotaReader();

  constructor(baseUrl: string, apiKey?: string, timeoutMs?: number) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey && apiKey.length > 0 ? apiKey : undefined;
    this.timeoutMs = timeoutMs ?? LlmHubClient.DEFAULT_TIMEOUT_MS;
  }

  async fetchDecision(session: string): Promise<LlmHubDecisionLookup | null> {
    const query = new URLSearchParams({ session, limit: '1' });
    const raw = await this.get(`${LlmHubClient.DECISIONS_PATH}?${query.toString()}`);
    if (raw === null) {
      return null;
    }
    return this.parseDecisions(raw);
  }

  async fetchUsage(profile: string): Promise<CopilotQuotaState | null> {
    const query = new URLSearchParams({ profile });
    const raw = await this.get(`${LlmHubClient.USAGE_PATH}?${query.toString()}`);
    return raw === null ? null : this.quotaReader.parseState(raw);
  }

  private async get(pathAndQuery: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}${pathAndQuery}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      });
      return response.ok ? await response.text() : null;
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }

  private parseDecisions(raw: string): LlmHubDecisionLookup | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!this.isRecord(parsed) || !Array.isArray(parsed['decisions'])) {
        return null;
      }
      const latest: unknown = parsed['decisions'][0];
      if (latest === undefined) {
        return { decision: null };
      }
      if (!this.isRecord(latest) || typeof latest['model'] !== 'string' || latest['model'].length === 0) {
        return null;
      }
      const complexity = typeof latest['complexity'] === 'string' ? latest['complexity'] : null;
      const tier = typeof latest['tier'] === 'string' && latest['tier'].length > 0 ? latest['tier'] : null;
      return { decision: { model: latest['model'], complexity, tier } };
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
