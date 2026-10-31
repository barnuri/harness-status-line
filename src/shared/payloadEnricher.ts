import type { PayloadKind, StatusJSON } from '../types.ts';
import { CopilotQuotaEnricher } from './copilotQuotaEnricher.ts';
import { CursorStatusEnricher } from './cursorStatusEnricher.ts';
import { LlmHubEnricher } from './llmHubEnricher.ts';
import { PayloadClassifier } from './payloadClassifier.ts';
import { SpendEnricher } from './spendEnricher.ts';

export interface KindEnricher {
  apply(status: StatusJSON): StatusJSON | Promise<StatusJSON>;
}

export type KindEnricherFactories = Readonly<Record<PayloadKind, () => KindEnricher>>;

// Each enricher builds stores and clients, so build only the one this harness needs.
export class PayloadEnricher {
  private static readonly DEFAULT_FACTORIES: KindEnricherFactories = {
    cursor: () => new CursorStatusEnricher(),
    'copilot-cli': () => new CopilotQuotaEnricher(),
    'claude-hub': () => new LlmHubEnricher(),
    claude: () => new SpendEnricher(),
  };

  private readonly classifier: PayloadClassifier;
  private readonly factories: KindEnricherFactories;

  constructor(classifier?: PayloadClassifier, factories?: KindEnricherFactories) {
    this.classifier = classifier ?? new PayloadClassifier();
    this.factories = factories ?? PayloadEnricher.DEFAULT_FACTORIES;
  }

  async apply(status: StatusJSON): Promise<StatusJSON> {
    return this.factories[this.classifier.classify(status)]().apply(status);
  }
}
