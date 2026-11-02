import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import type { Server } from 'bun';
import { LlmHubClient } from '../src/shared/llmHubClient.ts';

const usageBody = {
  profile: 'copilot',
  updatedAt: 1_000,
  source: 'copilot_internal/user',
  quotas: [{
    id: 'premium_interactions',
    unit: 'aic',
    used: 12_626,
    entitlement: 33_000,
    remaining: 20_489,
    remainingPercentage: 62,
    resetDate: '2026-11-01T00:00:00Z',
  }],
};

describe('LlmHubClient', () => {
  let server: Server<undefined>;
  let baseUrl: string;
  const seenAuth: Array<string | null> = [];
  const seenSearch: string[] = [];

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        const url = new URL(request.url);
        seenAuth.push(request.headers.get('authorization'));
        seenSearch.push(url.search);
        if (url.pathname === '/api/copilot/auto/decisions') {
          const session = url.searchParams.get('session');
          if (session === 'slow') {
            await Bun.sleep(1_000);
          }
          const decisions = session === 'empty'
            ? []
            : [{
              ts_ms: 1,
              session,
              model: 'copilot/claude-sonnet-5-5',
              auto_pick: 'copilot/claude-haiku-5-5',
              complexity: 'medium',
              tier: 'intelligence',
              turn: 'routed',
              effort: session === 'effort' ? 'medium' : undefined,
            }];
          return Response.json({ decisions });
        }
        if (url.pathname === '/api/smart-auto/current') {
          const session = url.searchParams.get('session');
          if (session === 'slow') {
            await Bun.sleep(1_000);
          }
          if (session === 'none') {
            return Response.json({ session });
          }
          if (session === 'selecting') {
            return Response.json({ selection: { main: null, active: [], state: 'selected', age_ms: 0, stale: false } });
          }
          return Response.json({
            selection: {
              main: { model: 'hub/model-a', tier: 'balance', role: 'implement', confirmed_effort: 'low' },
              active: [
                { stage: 'solver', model: 'hub/model-a' },
                { stage: 'reviewer', model: 'copilot/model-b', confirmed_effort: 'high' },
                { stage: 'reviewer', model: 'copilot/model-c' },
              ],
              state: 'started',
              age_ms: 250,
              stale: false,
            },
          });
        }
        if (url.pathname === '/api/copilot/usage' && url.searchParams.get('profile') === 'copilot') {
          return Response.json(usageBody);
        }
        return new Response('not found', { status: 404 });
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}/`;
  });

  afterAll(async () => {
    await server.stop(true);
  });

  it('parses the latest decision and sends the bearer key', async () => {
    const lookup = await new LlmHubClient(baseUrl, 'hub-key').fetchDecision('abc');

    expect(lookup).toEqual({ decision: { model: 'copilot/claude-sonnet-5-5', complexity: 'medium', tier: 'intelligence', mode: 'auto' } });
    expect(seenAuth.at(-1)).toBe('Bearer hub-key');
    expect(seenSearch.at(-1)).toBe('?session=abc&limit=1');
  });

  it('reads the effort the hub applied to a decision', async () => {
    const lookup = await new LlmHubClient(baseUrl).fetchDecision('effort');

    expect(lookup?.decision?.effort).toBe('medium');
    expect(lookup?.decision?.mode).toBe('auto');
  });

  it('leaves the effort unset when the decision carries none', async () => {
    const lookup = await new LlmHubClient(baseUrl).fetchDecision('abc');

    expect(lookup?.decision?.effort).toBeUndefined();
  });

  it('reports an empty decision list as no decision rather than a failure', async () => {
    expect(await new LlmHubClient(baseUrl).fetchDecision('empty')).toEqual({ decision: null });
    expect(seenAuth.at(-1)).toBeNull();
  });

  it('parses the usage body with the shared quota parser', async () => {
    const state = await new LlmHubClient(baseUrl).fetchUsage('copilot');

    expect(state?.source).toBe('copilot_internal/user');
    expect(state?.quotas).toEqual(usageBody.quotas);
  });

  it('parses the Smart Auto main model, reviewers, state and age', async () => {
    const lookup = await new LlmHubClient(baseUrl, 'hub-key').fetchSmartAutoCurrent('smart');

    expect(lookup).toEqual({
      selection: {
        model: 'hub/model-a',
        complexity: null,
        tier: 'balance',
        mode: 'smart-auto',
        effort: 'low',
        role: 'implement',
        state: 'started',
        reviewers: [{ model: 'copilot/model-b', effort: 'high' }, { model: 'copilot/model-c', effort: undefined }],
        ageMs: 250,
        stale: false,
      },
    });
    expect(seenSearch.at(-1)).toBe('?session=smart');
    expect(seenAuth.at(-1)).toBe('Bearer hub-key');
  });

  it('reports a selecting hub with no main model as selecting, not as a failure', async () => {
    const lookup = await new LlmHubClient(baseUrl).fetchSmartAutoCurrent('selecting');

    expect(lookup?.selection?.model).toBe('');
    expect(lookup?.selection?.state).toBe('selected');
    expect(lookup?.selection?.reviewers).toEqual([]);
  });

  it('reports a current body with neither a main model nor a state as no selection', async () => {
    expect(await new LlmHubClient(baseUrl).fetchSmartAutoCurrent('none')).toEqual({ selection: null });
  });

  it('times out a slow Smart Auto current call to null', async () => {
    const started = performance.now();

    expect(await new LlmHubClient(baseUrl).fetchSmartAutoCurrent('slow')).toBeNull();
    expect(performance.now() - started).toBeLessThan(900);
  });

  it('times out a slow hub to null', async () => {
    const started = performance.now();
    const lookup = await new LlmHubClient(baseUrl).fetchDecision('slow');

    expect(lookup).toBeNull();
    expect(performance.now() - started).toBeLessThan(900);
  });

  it('returns null on a 404', async () => {
    expect(await new LlmHubClient(baseUrl).fetchUsage('openai')).toBeNull();
  });

  it('returns null when the hub is unreachable', async () => {
    expect(await new LlmHubClient('http://127.0.0.1:1').fetchUsage('copilot')).toBeNull();
  });
});
