import type { PayloadKind, StatusJSON } from '../types.ts';

// Decides once which harness sent the status JSON, so only that harness's enricher runs.
export class PayloadClassifier {
  private static readonly HUB_MODEL = /^[^/\s]+\/[^/\s]+$/;
  private static readonly ANTHROPIC_HOST = /(^|\.)anthropic\.com$/;

  private readonly env: Readonly<Record<string, string | undefined>>;

  constructor(env?: Readonly<Record<string, string | undefined>>) {
    this.env = env ?? process.env;
  }

  classify(status: StatusJSON): PayloadKind {
    if (typeof status.render_width_chars === 'number' || typeof status.autorun === 'boolean') {
      return 'cursor';
    }
    if (status.ai_used !== undefined || status.allow_all_enabled !== undefined || status.username !== undefined) {
      return 'copilot-cli';
    }
    return this.hubModelId(status) !== null || this.gatewayBaseUrl(status) !== null ? 'claude-hub' : 'claude';
  }

  /** The llm-hub `<profile>/<model>` id from model.id or display_name; Anthropic ids never contain '/'. */
  hubModelId(status: StatusJSON): string | null {
    const raw = status.model;
    const candidates = typeof raw === 'string' ? [raw] : [raw?.id, raw?.display_name];
    const match = candidates.find(
      (candidate): candidate is string => typeof candidate === 'string' && PayloadClassifier.HUB_MODEL.test(candidate),
    );
    return match ?? null;
  }

  /** ANTHROPIC_BASE_URL (or api.base_url) when it points anywhere other than Anthropic's own API. */
  gatewayBaseUrl(status: StatusJSON): string | null {
    const baseUrl = this.env['ANTHROPIC_BASE_URL'] || status.api?.base_url;
    if (!baseUrl) {
      return null;
    }
    try {
      return PayloadClassifier.ANTHROPIC_HOST.test(new URL(baseUrl).hostname) ? null : baseUrl;
    } catch {
      return null;
    }
  }
}
