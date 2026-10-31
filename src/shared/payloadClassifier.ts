import type { PayloadKind, StatusJSON } from '../types.ts';

// Decides once which harness sent the status JSON, so only that harness's enricher runs.
export class PayloadClassifier {
  private static readonly HUB_MODEL = /^[^/\s]+\/[^/\s]+$/;

  classify(status: StatusJSON): PayloadKind {
    if (typeof status.render_width_chars === 'number' || typeof status.autorun === 'boolean') {
      return 'cursor';
    }
    if (status.ai_used !== undefined || status.allow_all_enabled !== undefined || status.username !== undefined) {
      return 'copilot-cli';
    }
    return this.hasHubModel(status) ? 'claude-hub' : 'claude';
  }

  // Anthropic model ids never contain '/', while llm-hub ids are always <profile>/<model>.
  private hasHubModel(status: StatusJSON): boolean {
    const raw = status.model;
    const candidates = typeof raw === 'string' ? [raw] : [raw?.id, raw?.display_name];
    return candidates.some(
      (candidate) => typeof candidate === 'string' && PayloadClassifier.HUB_MODEL.test(candidate),
    );
  }
}
