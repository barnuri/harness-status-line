import type { CopilotQuotaState, LlmHubAuto, StatusJSON } from '../types.ts';
import { LlmHubClient } from './llmHubClient.ts';
import { LlmHubStore } from './llmHubStore.ts';
import { PayloadClassifier } from './payloadClassifier.ts';

// Claude Code on llm-hub's copilot/* models: show Auto's pick and the Copilot quota from the hub.
export class LlmHubEnricher {
  private static readonly COPILOT_PROFILE = 'copilot';
  // llm-hub names Auto "<profile>/auto" (balance) or "<profile>/auto-<tier>".
  private static readonly AUTO_MODEL = /^auto(?:-[a-z]+)?$/;

  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly storeDir: string | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(env?: Readonly<Record<string, string | undefined>>, storeDir?: string, timeoutMs?: number) {
    this.env = env ?? process.env;
    this.storeDir = storeDir;
    this.timeoutMs = timeoutMs;
  }

  async apply(status: StatusJSON, nowMs: number = Date.now()): Promise<StatusJSON> {
    const classifier = new PayloadClassifier(this.env);
    const baseUrl = classifier.gatewayBaseUrl(status);
    if (!baseUrl) {
      return status;
    }
    // An alias such as `opus` can reach the status line as a bare id; the hub's default Copilot profile serves it.
    const modelId = classifier.hubModelId(status) ?? `${LlmHubEnricher.COPILOT_PROFILE}/`;
    const [profile = '', bareModel = ''] = modelId.split('/');
    if (profile !== LlmHubEnricher.COPILOT_PROFILE) {
      return status;
    }

    const client = new LlmHubClient(baseUrl, this.env['ANTHROPIC_AUTH_TOKEN'], this.timeoutMs);
    const store = new LlmHubStore(client.baseUrl, this.storeDir);
    let result = status;
    if (LlmHubEnricher.AUTO_MODEL.test(bareModel) && status.session_id) {
      const auto = await this.resolveDecision(client, store, status.session_id, nowMs);
      result = auto ? { ...result, llm_hub_auto: auto } : result;
    }
    if (!status.copilot_quota) {
      const quota = await this.resolveUsage(client, store, profile, nowMs);
      // Rate limits in a hub session describe the Anthropic login, not the Copilot seat that serves it.
      result = quota ? { ...result, copilot_quota: quota, rate_limits: undefined } : result;
    }
    return result;
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
