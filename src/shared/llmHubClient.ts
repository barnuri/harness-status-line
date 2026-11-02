import type {
  CopilotQuotaState,
  LlmHubAuto,
  LlmHubDecisionLookup,
  LlmHubReviewer,
  LlmHubSelectionLookup,
  LlmHubState,
} from '../types.ts';
import { CopilotQuotaReader } from './copilotQuotaReader.ts';
import { isRecord } from './isRecord.ts';

export class LlmHubClient {
  static readonly DEFAULT_TIMEOUT_MS = 300;
  private static readonly DECISIONS_PATH = '/api/copilot/auto/decisions';
  private static readonly SMART_AUTO_CURRENT_PATH = '/api/smart-auto/current';
  private static readonly MODELS_PATH = '/v1/models';
  private static readonly ONE_M_SUFFIX = /\[1m\]$/i;
  private static readonly USAGE_PATH = '/api/copilot/usage';
  private static readonly STATES: ReadonlyArray<LlmHubState> = ['selected', 'started', 'completed', 'rejected', 'cancelled'];

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

  // The hub's current Smart Auto selection for one session: main model, active reviewers, state and age.
  async fetchSmartAutoCurrent(session: string): Promise<LlmHubSelectionLookup | null> {
    const query = new URLSearchParams({ session });
    const raw = await this.get(`${LlmHubClient.SMART_AUTO_CURRENT_PATH}?${query.toString()}`);
    return raw === null ? null : this.parseSelection(raw);
  }

  // The advertised prompt window of one served model, matched without its [1m] suffix; null when unknown.
  async fetchModelWindow(qualifiedId: string): Promise<{ window: number; oneMillion: boolean } | null> {
    const raw = await this.get(LlmHubClient.MODELS_PATH);
    if (raw === null) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const data: unknown[] = isRecord(parsed) && Array.isArray(parsed['data']) ? parsed['data'] : [];
      const wanted = qualifiedId.replace(LlmHubClient.ONE_M_SUFFIX, '');
      const entry = data.find(
        (item): item is Record<string, unknown> =>
          isRecord(item) && typeof item['id'] === 'string' && item['id'].replace(LlmHubClient.ONE_M_SUFFIX, '') === wanted,
      );
      const window = entry?.['context_window'];
      if (typeof window !== 'number' || window <= 0 || typeof entry?.['id'] !== 'string') {
        return null;
      }
      return { window, oneMillion: LlmHubClient.ONE_M_SUFFIX.test(entry['id']) };
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
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
      if (!isRecord(parsed) || !Array.isArray(parsed['decisions'])) {
        return null;
      }
      const latest: unknown = parsed['decisions'][0];
      if (latest === undefined) {
        return { decision: null };
      }
      if (!isRecord(latest) || typeof latest['model'] !== 'string' || latest['model'].length === 0) {
        return null;
      }
      const complexity = typeof latest['complexity'] === 'string' ? latest['complexity'] : null;
      const tier = typeof latest['tier'] === 'string' && latest['tier'].length > 0 ? latest['tier'] : null;
      const effort = this.nonEmptyString(latest['effort']);
      return { decision: { model: latest['model'], complexity, tier, mode: 'auto', effort } };
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }

  // An empty main model is allowed while the hub is still selecting; the state then says so.
  private parseSelection(raw: string): LlmHubSelectionLookup | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) {
        return null;
      }
      // The hub wraps the selection: { selection: { main, active, state, age_ms, stale } }.
      const body: Record<string, unknown> = isRecord(parsed['selection']) ? parsed['selection'] : parsed;
      const main: Record<string, unknown> = isRecord(body['main']) ? body['main'] : {};
      const model = this.nonEmptyString(main['model']) ?? '';
      const state = this.parseState(body['state']);
      if (model.length === 0 && state === undefined) {
        return { selection: null };
      }
      // The applied effort is the confirmed one, else the one sent; a Smart Auto turn with neither shows none.
      const effort =
        this.nonEmptyString(main['confirmed_effort']) ??
        this.nonEmptyString(main['sent_effort']) ??
        this.nonEmptyString(main['selected_effort']);
      const selection: LlmHubAuto = {
        model,
        complexity: null,
        tier: this.nonEmptyString(main['tier']) ?? null,
        mode: 'smart-auto',
        effort,
        role: this.nonEmptyString(main['role']),
        state,
        reviewers: this.parseReviewers(this.reviewerEntries(body['active'])),
        ageMs: typeof body['age_ms'] === 'number' ? body['age_ms'] : undefined,
        stale: body['stale'] === true,
      };
      return { selection };
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }

  private reviewerEntries(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((entry): entry is Record<string, unknown> => isRecord(entry) && entry['stage'] !== 'solver')
      .map((entry) => ({
        model: entry['model'],
        effort: entry['confirmed_effort'] ?? entry['sent_effort'] ?? entry['selected_effort'],
      }));
  }

  private parseReviewers(value: unknown): LlmHubReviewer[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const reviewers: LlmHubReviewer[] = [];
    for (const entry of value) {
      if (!isRecord(entry)) {
        continue;
      }
      const model = this.nonEmptyString(entry['model']);
      if (model !== undefined) {
        reviewers.push({ model, effort: this.nonEmptyString(entry['effort']) });
      }
    }
    return reviewers;
  }

  private parseState(value: unknown): LlmHubState | undefined {
    const state = this.nonEmptyString(value);
    return LlmHubClient.STATES.find((known) => known === state);
  }

  private nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

}
