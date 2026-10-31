import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeUsageRefresher } from '../src/shared/claudeUsageRefresher.ts';
import { PayloadClassifier } from '../src/shared/payloadClassifier.ts';
import { PayloadEnricher } from '../src/shared/payloadEnricher.ts';
import type { KindEnricher, KindEnricherFactories } from '../src/shared/payloadEnricher.ts';
import { SpendEnricher } from '../src/shared/spendEnricher.ts';
import { SpendLedger } from '../src/shared/spendLedger.ts';
import type { PayloadKind, StatusJSON } from '../src/types.ts';

describe('PayloadEnricher', () => {
  const payloads: Readonly<Record<PayloadKind, StatusJSON>> = {
    cursor: { render_width_chars: 120 } as StatusJSON,
    'copilot-cli': { ai_used: 3 } as StatusJSON,
    'claude-hub': { session_id: 'hub', model: { id: 'copilot/auto' }, cost: { total_cost_usd: 5 } } as StatusJSON,
    claude: { session_id: 'direct', model: { id: 'claude-opus-5-5' }, cost: { total_cost_usd: 5 } } as StatusJSON,
  };
  const kinds = Object.keys(payloads) as PayloadKind[];
  let built: PayloadKind[];

  const recordingFactories = (): KindEnricherFactories => {
    const factory = (kind: PayloadKind) => (): KindEnricher => {
      built.push(kind);
      return { apply: (status: StatusJSON): StatusJSON => status };
    };
    return { cursor: factory('cursor'), 'copilot-cli': factory('copilot-cli'), 'claude-hub': factory('claude-hub'), claude: factory('claude') };
  };

  beforeEach(() => {
    built = [];
  });

  for (const kind of kinds) {
    it(`builds and runs only the ${kind} enricher for a ${kind} payload`, async () => {
      const enricher = new PayloadEnricher(new PayloadClassifier({}), recordingFactories());

      expect(await enricher.apply(payloads[kind])).toBe(payloads[kind]);
      expect(built).toEqual([kind]);
    });
  }

  describe('with the real SpendEnricher', () => {
    let dir: string;
    let recorded: string[];

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-enricher-'));
      recorded = [];
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const spendBacked = (): PayloadEnricher => {
      const ledger = new SpendLedger(dir);
      const record = ledger.record.bind(ledger);
      ledger.record = (session: string, cost: number, nowMs: number): void => {
        recorded.push(session);
        record(session, cost, nowMs);
      };
      const refresher = { refreshInBackground: (): void => {} } as unknown as ClaudeUsageRefresher;
      return new PayloadEnricher(new PayloadClassifier({}), {
        ...recordingFactories(),
        claude: () => new SpendEnricher(ledger, refresher),
      });
    };

    it('never records a claude-hub session in the spend ledger', async () => {
      await spendBacked().apply(payloads['claude-hub']);

      expect(recorded).toEqual([]);
      expect(built).toEqual(['claude-hub']);
    });

    it('records a direct Claude session in the spend ledger', async () => {
      await spendBacked().apply(payloads.claude);

      expect(recorded).toEqual(['direct']);
    });
  });
});
