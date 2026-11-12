import { LlmHubEnricher } from '../shared/llmHubEnricher.ts';
import type { OpencodeStatusInput, StatusJSON } from '../types.ts';

type HubStatusEnricher = Pick<LlmHubEnricher, 'apply'>;

// opencode on llm-hub (`llm-hub opencode`): shape the status like Claude Code's hub payload, then add the hub data.
export class OpencodeHubEnricher {
  static readonly PROVIDER_ID = 'llm-hub';
  private static readonly DEFAULT_HUB_URL = 'http://localhost:8888';
  private static readonly DEFAULT_API_KEY = 'llm-hub';

  private readonly hubUrl: string;
  private readonly enricher: HubStatusEnricher;

  constructor(env: Readonly<Record<string, string | undefined>> = process.env, enricher?: HubStatusEnricher) {
    this.hubUrl = env['LLM_HUB_URL'] || OpencodeHubEnricher.DEFAULT_HUB_URL;
    this.enricher =
      enricher ??
      new LlmHubEnricher({
        ANTHROPIC_BASE_URL: this.hubUrl,
        ANTHROPIC_AUTH_TOKEN: env['LLM_HUB_API_KEY'] || OpencodeHubEnricher.DEFAULT_API_KEY,
      });
  }

  applies(input: OpencodeStatusInput): boolean {
    return input.providerId === OpencodeHubEnricher.PROVIDER_ID && typeof input.modelId === 'string';
  }

  async apply(input: OpencodeStatusInput, status: StatusJSON): Promise<StatusJSON> {
    if (!this.applies(input)) {
      return status;
    }
    // Claude's snapshot describes the Anthropic login, not the hub session. opencode prices a Smart Auto
    // turn at $0 because the requested model has no fixed price, so a zero session cost is dropped.
    const { rate_limits: _claudeRateLimits, cost, ...rest } = status;
    const hubStatus: StatusJSON = {
      ...rest,
      model: { id: input.modelId, display_name: input.model ?? input.modelId },
      api: { base_url: this.hubUrl },
      ...(cost && cost.total_cost_usd !== 0 ? { cost } : {}),
      ...(status.context_window && typeof input.contextTokens === 'number'
        ? { context_window: { ...status.context_window, current_context_tokens: input.contextTokens } }
        : {}),
    };
    return this.enricher.apply(hubStatus);
  }
}
