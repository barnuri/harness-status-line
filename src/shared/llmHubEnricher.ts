import type { CopilotQuotaState, LlmHubAuto, StatusJSON } from '../types.ts';
import { LlmHubClient } from './llmHubClient.ts';
import { LlmHubStore } from './llmHubStore.ts';
import { PayloadClassifier } from './payloadClassifier.ts';

// Claude Code on llm-hub: show Auto's pick (copilot/*) or the Smart Auto selection (hub/*), and the Copilot quota.
export class LlmHubEnricher {
  private static readonly COPILOT_PROFILE = 'copilot';
  private static readonly HUB_PROFILE = 'hub';
  // llm-hub names Auto "<profile>/auto" (balance) or "<profile>/auto-<tier>".
  private static readonly AUTO_MODEL = /^auto(?:-[a-z]+)?$/;
  // Smart Auto is "hub/smart-auto" or "hub/smart-auto-<tier>".
  private static readonly SMART_AUTO_MODEL = /^smart-auto(?:-[a-z]+)?$/;

  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly storeDir: string | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(env?: Readonly<Record<string, string | undefined>>, storeDir?: string, timeoutMs?: number) {
    this.env = env ?? process.env;
    this.storeDir = storeDir;
    this.timeoutMs = timeoutMs;
  }

  // A bare Auto name (e.g. gpt-6.1-sol) is a Copilot model; a Smart Auto selection already carries its profile.
  private static qualify(model: string): string {
    return model.includes('/') ? model : `${LlmHubEnricher.COPILOT_PROFILE}/${model}`;
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
    const isCopilot = profile === LlmHubEnricher.COPILOT_PROFILE;
    const isHub = profile === LlmHubEnricher.HUB_PROFILE;
    if (!isCopilot && !isHub) {
      return status;
    }

    const client = new LlmHubClient(baseUrl, this.env['ANTHROPIC_AUTH_TOKEN'], this.timeoutMs);
    const store = new LlmHubStore(client.baseUrl, this.storeDir);
    let result = status;
    if (isCopilot && LlmHubEnricher.AUTO_MODEL.test(bareModel) && status.session_id) {
      const auto = await this.resolveDecision(client, store, status.session_id, nowMs);
      result = auto ? { ...result, llm_hub_auto: auto } : result;
    }
    if (isHub && LlmHubEnricher.SMART_AUTO_MODEL.test(bareModel) && status.session_id) {
      const selection = await this.resolveSelection(client, store, status.session_id, nowMs);
      result = selection ? { ...result, llm_hub_auto: selection } : result;
    }
    // The ctx denominator is the window the hub serves for the model it chose, not Claude's default size.
    const chosen = result.llm_hub_auto?.model;
    if (chosen && status.context_window) {
      const served = await client.fetchModelWindow(LlmHubEnricher.qualify(chosen));
      if (served !== null) {
        const ctx = status.context_window;
        const tokens = ctx.current_context_tokens ?? ctx.total_input_tokens;
        const percent = typeof tokens === 'number' && tokens >= 0 ? (tokens / served.window) * 100 : ctx.current_context_used_percentage;
        result = {
          ...result,
          context_window: { ...ctx, context_window_size: served.window, displayed_context_limit: undefined, current_context_used_percentage: percent },
          llm_hub_auto: served.oneMillion && result.llm_hub_auto ? { ...result.llm_hub_auto, model: `${result.llm_hub_auto.model}[1m]` } : result.llm_hub_auto,
        };
      }
    }
    // Quota is Copilot-only: a Smart Auto session has no Copilot seat to report.
    if (isCopilot && !status.copilot_quota) {
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

  // A live hub answer is shown as is; when the hub is unreachable, the stored last-known copy is shown with its age.
  private async resolveSelection(
    client: LlmHubClient,
    store: LlmHubStore,
    session: string,
    nowMs: number,
  ): Promise<LlmHubAuto | null> {
    if (store.isBackingOff(nowMs)) {
      return store.readSelection(session, nowMs);
    }
    const lookup = await client.fetchSmartAutoCurrent(session);
    if (lookup === null) {
      store.recordFailure(nowMs);
      return store.readSelection(session, nowMs);
    }
    if (lookup.selection === null) {
      return store.readSelection(session, nowMs);
    }
    store.writeSelection(session, lookup.selection, nowMs);
    return lookup.selection;
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
