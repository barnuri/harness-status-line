import { describe, expect, it } from 'bun:test';
import { OpencodeHubEnricher } from '../src/opencode/hubEnricher.ts';
import type { OpencodeStatusInput, StatusJSON } from '../src/types.ts';

const HUB_INPUT: OpencodeStatusInput = {
  providerId: 'llm-hub',
  modelId: 'hub/smart-auto-balance',
  model: 'Smart Auto (Balance) (recommended)',
  sessionId: 'ses_1',
  contextTokens: 5_000,
};

const BASE_STATUS: StatusJSON = {
  model: 'Smart Auto (Balance) (recommended)',
  session_id: 'ses_1',
  context_window: { tokens: 5_000, size: 200_000 },
  rate_limits: { five_hour: { used_percentage: 12 } },
  api: { type: 'subscription' },
};

const recordingEnricher = () => {
  const seen: StatusJSON[] = [];
  return {
    seen,
    apply: async (status: StatusJSON): Promise<StatusJSON> => {
      seen.push(status);
      return { ...status, session_name: 'enriched' };
    },
  };
};

describe('OpencodeHubEnricher', () => {
  it('applies only to an llm-hub provider message with a model id', () => {
    const enricher = new OpencodeHubEnricher({}, recordingEnricher());

    expect(enricher.applies(HUB_INPUT)).toBe(true);
    expect(enricher.applies({ ...HUB_INPUT, providerId: 'anthropic' })).toBe(false);
    expect(enricher.applies({ providerId: 'llm-hub' })).toBe(false);
  });

  it('leaves a non-hub status unchanged', async () => {
    const fake = recordingEnricher();
    const enricher = new OpencodeHubEnricher({}, fake);

    const result = await enricher.apply({ ...HUB_INPUT, providerId: 'anthropic' }, BASE_STATUS);

    expect(result).toBe(BASE_STATUS);
    expect(fake.seen).toHaveLength(0);
  });

  it('sends the Claude Code hub payload shape to the llm-hub enricher', async () => {
    const fake = recordingEnricher();
    const enricher = new OpencodeHubEnricher({ LLM_HUB_URL: 'http://127.0.0.1:9999' }, fake);

    const result = await enricher.apply(HUB_INPUT, BASE_STATUS);

    expect(fake.seen[0]).toEqual({
      model: { id: 'hub/smart-auto-balance', display_name: 'Smart Auto (Balance) (recommended)' },
      session_id: 'ses_1',
      context_window: { tokens: 5_000, size: 200_000, current_context_tokens: 5_000 },
      api: { base_url: 'http://127.0.0.1:9999' },
    });
    expect(result.session_name).toBe('enriched');
  });

  it('drops a zero session cost and keeps a real one', async () => {
    const fake = recordingEnricher();
    const enricher = new OpencodeHubEnricher({}, fake);

    await enricher.apply(HUB_INPUT, { ...BASE_STATUS, cost: { total_cost_usd: 0 } });
    await enricher.apply(HUB_INPUT, { ...BASE_STATUS, cost: { total_cost_usd: 0.42 } });

    expect(fake.seen[0]?.cost).toBeUndefined();
    expect(fake.seen[1]?.cost).toEqual({ total_cost_usd: 0.42 });
  });

  it('defaults the hub url to the local service port', async () => {
    const fake = recordingEnricher();

    await new OpencodeHubEnricher({}, fake).apply(HUB_INPUT, BASE_STATUS);

    expect(fake.seen[0]?.api?.base_url).toBe('http://localhost:8888');
  });
});
