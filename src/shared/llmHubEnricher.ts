import type { CopilotQuotaState, LlmHubAuto, StatusJSON } from '../types.ts';
import { LlmHubClient } from './llmHubClient.ts';
import { LlmHubStore } from './llmHubStore.ts';

// Claude Code on llm-hub's copilot/* models: show Auto's pick and the Copilot quota from the hub.
export class LlmHubEnricher {
  private static readonly HUB_MODEL = /^[^/\s]+\/[^/\s]+$/;
  private static readonly COPILOT_PROFILE = 'copilot';
  private static readonly AUTO_MODEL = 'auto';

  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly storeDir: string | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(env?: Readonly<Record<string, string | undefined>>, storeDir?: string, timeoutMs?: number) {
    this.env = env ?? process.env;
    this.storeDir = storeDir;
    this.timeoutMs = timeoutMs;
  }

  async apply(status: StatusJSON, nowMs: number = Date.now()): Promise<StatusJSON> {
    const modelId = this.extractHubModelId(status);
    const baseUrl = this.env['ANTHROPIC_BASE_URL'] || status.api?.base_url;
    if (modelId === null || !baseUrl) {
      return status;
    }
    const [profile = '', bareModel = ''] = modelId.split('/');
    if (profile !== LlmHubEnricher.COPILOT_PROFILE) {
      return status;
    }

    const client = new LlmHubClient(baseUrl, this.env['ANTHROPIC_AUTH_TOKEN'], this.timeoutMs);
    const store = new LlmHubStore(client.baseUrl, this.storeDir);
    let result = status;
    if (bareModel === LlmHubEnricher.AUTO_MODEL && status.session_id) {
      const auto = await this.resolveDecision(client, store, status.session_id, nowMs);
      result = auto ? { ...result, llm_hub_auto: auto } : result;
    }
    if (!status.rate_limits && !status.copilot_quota) {
      const quota = await this.resolveUsage(client, store, profile, nowMs);
      result = quota ? { ...result, copilot_quota: quota } : result;
    }
    return result;
  }

  // Claude Code may carry the hub id in model.id or display_name, so take the first that looks like one.
  private extractHubModelId(status: StatusJSON): string | null {
    const raw = status.model;
    const candidates = typeof raw === 'string' ? [raw] : [raw?.id, raw?.display_name];
    const match = candidates.find(
      (candidate): candidate is string => typeof candidate === 'string' && LlmHubEnricher.HUB_MODEL.test(candidate),
    );
    return match ?? null;
  }

  private async resolveDecision(
    client: LlmHubClient,
    store: LlmHubStore,
    session: string,
    nowMs: number,
  ): Promise<LlmHubAuto | null> {
    if (store.isBackingOff(nowMs)) {
      return store.readDecision(session);
    }
    const lookup = await client.fetchDecision(session);
    if (lookup === null) {
      store.recordFailure(nowMs);
      return store.readDecision(session);
    }
    if (lookup.decision === null) {
      return store.readDecision(session);
    }
    store.writeDecision(session, lookup.decision, nowMs);
    return lookup.decision;
  }

  private async resolveUsage(
    client: LlmHubClient,
    store: LlmHubStore,
    profile: string,
    nowMs: number,
  ): Promise<CopilotQuotaState | null> {
    const stored = store.readUsage(profile);
    if (stored && store.isUsageFresh(stored, nowMs)) {
      return this.withoutExpiredQuotas(stored.state, nowMs);
    }
    if (store.isBackingOff(nowMs)) {
      return stored ? this.withoutExpiredQuotas(stored.state, nowMs) : null;
    }
    const state = await client.fetchUsage(profile);
    if (state === null) {
      store.recordFailure(nowMs);
      return stored ? this.withoutExpiredQuotas(stored.state, nowMs) : null;
    }
    store.writeUsage(profile, state, nowMs);
    return this.withoutExpiredQuotas(state, nowMs);
  }

  // A stored snapshot can outlive its quota period while the hub is unreachable.
  private withoutExpiredQuotas(state: CopilotQuotaState, nowMs: number): CopilotQuotaState | null {
    const quotas = state.quotas.filter((quota) => quota.resetDate === undefined || Date.parse(quota.resetDate) > nowMs);
    return quotas.length > 0 ? { ...state, quotas } : null;
  }
}
