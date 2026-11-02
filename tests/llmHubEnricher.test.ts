import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import type { Server } from 'bun';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LlmHubEnricher } from '../src/shared/llmHubEnricher.ts';
import type { StatusJSON } from '../src/types.ts';

const NOW = Date.parse('2026-10-31T20:00:00Z');

const usageBody = {
  updatedAt: NOW,
  source: 'copilot_internal/user',
  quotas: [{ id: 'premium_interactions', unit: 'aic', used: 12_626, entitlement: 33_000, remainingPercentage: 62, resetDate: '2026-11-01T00:00:00Z' }],
};

describe('LlmHubEnricher', () => {
  let server: Server<undefined>;
  let baseUrl: string;
  let failing = false;
  let decisionCalls = 0;
  let usageCalls = 0;
  let smartCalls = 0;
  let smartBySession: Record<string, Record<string, unknown>> = {};
  let dir: string;

  const smartBody = (session: string): Record<string, unknown> => ({
    session,
    selection: {
      main: { model: 'copilot/claude-sonnet-5-5', tier: 'balance', role: 'implement', confirmed_effort: 'low' },
      active: [],
      state: 'completed',
      age_ms: 0,
      stale: false,
    },
  });
  const withMain = (session: string, main: Record<string, unknown>, active: unknown[] = []): Record<string, unknown> => ({
    session,
    selection: { main, active, state: 'completed', age_ms: 0, stale: false },
  });
  const autoStatus = (overrides: Partial<StatusJSON> = {}): StatusJSON => ({
    session_id: 'sess-1',
    model: { id: 'copilot/auto', display_name: 'copilot/auto' },
    ...overrides,
  });
  const smartStatus = (session = 'sess-1'): StatusJSON => ({
    session_id: session,
    model: { id: 'hub/smart-auto-balance', display_name: 'hub/smart-auto-balance' },
  });
  const enricher = (env: Record<string, string | undefined> = { ANTHROPIC_BASE_URL: baseUrl }): LlmHubEnricher =>
    new LlmHubEnricher(env, dir);

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/api/copilot/auto/decisions') {
          decisionCalls += 1;
          return failing
            ? new Response('down', { status: 503 })
            : Response.json({ decisions: [{ model: 'copilot/claude-sonnet-5-5', complexity: 'medium', tier: 'fast' }] });
        }
        if (url.pathname === '/api/copilot/usage') {
          usageCalls += 1;
          return failing ? new Response('down', { status: 503 }) : Response.json(usageBody);
        }
        if (url.pathname === '/api/smart-auto/current') {
          smartCalls += 1;
          const session = url.searchParams.get('session') ?? '';
          return failing ? new Response('down', { status: 503 }) : Response.json(smartBySession[session] ?? smartBody(session));
        }
        if (url.pathname === '/v1/models') {
          return Response.json({
            data: [
              { id: 'copilot/claude-sonnet-5-5[1m]', context_window: 1_000_000 },
              { id: 'copilot/gpt-6.1-sol', context_window: 922_000 },
              { id: 'copilot/model-a', context_window: 64_000 },
            ],
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.stop(true);
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-hub-enricher-'));
    failing = false;
    decisionCalls = 0;
    usageCalls = 0;
    smartCalls = 0;
    smartBySession = {};
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('leaves non-Copilot hub profiles untouched', async () => {
    const otherProfile: StatusJSON = { session_id: 'sess-1', model: 'openai/auto' };

    expect(await enricher().apply(otherProfile, NOW)).toBe(otherProfile);
    expect(decisionCalls + usageCalls).toBe(0);
  });

  it('treats a bare model id on a hub base URL as the Copilot profile', async () => {
    const alias: StatusJSON = { session_id: 'sess-1', model: { id: 'claude-sonnet-4-6' } };

    const result = await enricher().apply(alias, NOW);

    expect(result.copilot_quota?.quotas[0]?.used).toBe(12_626);
    expect(decisionCalls).toBe(0);
  });

  it('leaves the status untouched without a hub base URL', async () => {
    const status = autoStatus();
    expect(await enricher({}).apply(status, NOW)).toBe(status);
  });

  it('sets the Auto pick and the hub quota for copilot/auto with a session', async () => {
    const result = await enricher().apply(autoStatus(), NOW);

    expect(result.llm_hub_auto).toEqual({ model: 'copilot/claude-sonnet-5-5', complexity: 'medium', tier: 'fast', mode: 'auto' });
    expect(result.copilot_quota?.quotas[0]?.used).toBe(12_626);
  });

  it('sets the Auto pick for a tiered copilot/auto-<tier> model', async () => {
    const result = await enricher().apply(autoStatus({ model: { id: 'copilot/auto-fast' } }), NOW);

    expect(result.llm_hub_auto).toEqual({ model: 'copilot/claude-sonnet-5-5', complexity: 'medium', tier: 'fast', mode: 'auto' });
  });

  it('keeps the tier in the stored decision used while the hub is down', async () => {
    await enricher().apply(autoStatus(), NOW);
    failing = true;

    const failed = await enricher().apply(autoStatus(), NOW + 61_000);

    expect(failed.llm_hub_auto?.tier).toBe('fast');
  });

  it('falls back to api.base_url when ANTHROPIC_BASE_URL is unset', async () => {
    const result = await enricher({}).apply(autoStatus({ api: { base_url: baseUrl } }), NOW);
    expect(result.llm_hub_auto?.model).toBe('copilot/claude-sonnet-5-5');
  });

  it('sets the hub quota but no Auto pick for a concrete copilot model', async () => {
    const result = await enricher().apply({ session_id: 'sess-1', model: 'copilot/claude-opus-5-5' }, NOW);

    expect(result.llm_hub_auto).toBeUndefined();
    expect(result.copilot_quota?.source).toBe('copilot_internal/user');
    expect(decisionCalls).toBe(0);
  });

  it('replaces Anthropic rate_limits with the hub quota in a hub session', async () => {
    const result = await enricher().apply(autoStatus({ rate_limits: { session: { used_percentage: 10 } } }), NOW);

    expect(result.copilot_quota?.quotas[0]?.used).toBe(12_626);
    expect(result.rate_limits).toBeUndefined();
  });

  it('serves the stored usage inside 60 s and refreshes after', async () => {
    await enricher().apply(autoStatus(), NOW);
    const cached = await enricher().apply(autoStatus(), NOW + 59_000);
    expect(cached.copilot_quota?.quotas[0]?.used).toBe(12_626);
    expect(usageCalls).toBe(1);

    await enricher().apply(autoStatus(), NOW + 61_000);
    expect(usageCalls).toBe(2);
  });

  it('backs off for 30 s after a failure and keeps showing the stored values', async () => {
    await enricher().apply(autoStatus(), NOW);
    failing = true;

    const failed = await enricher().apply(autoStatus(), NOW + 61_000);
    expect(failed.llm_hub_auto?.model).toBe('copilot/claude-sonnet-5-5');
    expect(failed.copilot_quota?.quotas[0]?.used).toBe(12_626);
    const callsAfterFailure = decisionCalls + usageCalls;

    const backingOff = await enricher().apply(autoStatus(), NOW + 80_000);
    expect(decisionCalls + usageCalls).toBe(callsAfterFailure);
    expect(backingOff.llm_hub_auto?.model).toBe('copilot/claude-sonnet-5-5');
    expect(backingOff.copilot_quota?.quotas[0]?.used).toBe(12_626);

    await enricher().apply(autoStatus(), NOW + 92_000);
    expect(decisionCalls + usageCalls).toBeGreaterThan(callsAfterFailure);
  });

  it('drops a stored quota whose reset date has passed', async () => {
    await enricher().apply(autoStatus(), NOW);
    failing = true;

    const result = await enricher().apply(autoStatus(), Date.parse('2026-11-01T00:00:01Z'));
    expect(result.copilot_quota).toBeUndefined();
  });

  it('sets the Smart Auto selection for hub/smart-auto-* and reports no Copilot quota', async () => {
    smartBySession['sess-1'] = withMain(
      'sess-1',
      { model: 'copilot/model-a', tier: 'balance', role: 'implement', confirmed_effort: 'low' },
      [{ stage: 'solver', model: 'copilot/model-a' }, { stage: 'reviewer', model: 'copilot/model-b', confirmed_effort: 'high' }],
    );

    const result = await enricher().apply(smartStatus(), NOW);

    expect(result.llm_hub_auto).toMatchObject({
      model: 'copilot/model-a',
      mode: 'smart-auto',
      effort: 'low',
      tier: 'balance',
      stale: false,
      ageMs: 0,
      reviewers: [{ model: 'copilot/model-b', effort: 'high' }],
    });
    expect(result.copilot_quota).toBeUndefined();
    expect(usageCalls).toBe(0);
    expect(smartCalls).toBe(1);
  });

  it('leaves other hub models untouched', async () => {
    const other: StatusJSON = { session_id: 'sess-1', model: { id: 'hub/claude-sonnet-5-5' } };

    expect(await enricher().apply(other, NOW)).toBe(other);
    expect(smartCalls).toBe(0);
  });

  it('reports a selecting hub with no main model as selecting, not as a failure', async () => {
    smartBySession['sess-1'] = { session: 'sess-1', selection: { main: null, active: [], state: 'selected', age_ms: 0, stale: false } };

    const result = await enricher().apply(smartStatus(), NOW);

    expect(result.llm_hub_auto).toMatchObject({ model: '', state: 'selected', mode: 'smart-auto' });
  });

  it('shows no Smart Auto selection when the hub is down and nothing was stored', async () => {
    failing = true;

    const result = await enricher().apply(smartStatus(), NOW);

    expect(result.llm_hub_auto).toBeUndefined();
  });

  it('shows the last-known Smart Auto selection with its age, marked stale after 60 s', async () => {
    await enricher().apply(smartStatus(), NOW);
    failing = true;

    const recent = await enricher().apply(smartStatus(), NOW + 30_000);
    expect(recent.llm_hub_auto).toMatchObject({ model: 'copilot/claude-sonnet-5-5', ageMs: 30_000, stale: false });

    const old = await enricher().apply(smartStatus(), NOW + 61_000);
    expect(old.llm_hub_auto).toMatchObject({ model: 'copilot/claude-sonnet-5-5', ageMs: 61_000, stale: true });
  });

  it('takes the context window from the hub for the chosen model, for Auto and Smart Auto alike', async () => {
    smartBySession['sess-ctx'] = withMain('sess-ctx', { model: 'copilot/model-a', confirmed_effort: 'low' });
    const payload = {
      ...smartStatus('sess-ctx'),
      context_window: { context_window_size: 200_000, current_context_tokens: 1_000, current_context_used_percentage: 1 },
    } as StatusJSON;

    const result = await enricher().apply(payload, NOW);

    expect(result.context_window?.context_window_size).toBe(64_000);
  });

  it('shows the [1m] suffix on the chosen model when the hub serves it with a 1M window', async () => {
    smartBySession['sess-1m'] = withMain('sess-1m', { model: 'copilot/claude-sonnet-5-5', confirmed_effort: 'high' });
    const payload = { ...smartStatus('sess-1m'), context_window: { context_window_size: 200_000, current_context_tokens: 1_000, current_context_used_percentage: 1 } } as StatusJSON;

    const result = await enricher().apply(payload, NOW);

    expect(result.llm_hub_auto?.model).toBe('copilot/claude-sonnet-5-5[1m]');
    expect(result.context_window?.context_window_size).toBe(1_000_000);
  });

  it('keeps the selections of concurrent sessions apart', async () => {
    smartBySession['sess-a'] = withMain('sess-a', { model: 'copilot/model-a', confirmed_effort: 'low' });
    smartBySession['sess-b'] = withMain('sess-b', { model: 'copilot/model-b', confirmed_effort: 'high' });
    await enricher().apply(smartStatus('sess-a'), NOW);
    await enricher().apply(smartStatus('sess-b'), NOW + 1_000);
    failing = true;

    const a = await enricher().apply(smartStatus('sess-a'), NOW + 2_000);
    const b = await enricher().apply(smartStatus('sess-b'), NOW + 2_000);

    expect(a.llm_hub_auto).toMatchObject({ model: 'copilot/model-a', effort: 'low' });
    expect(b.llm_hub_auto).toMatchObject({ model: 'copilot/model-b', effort: 'high' });
  });
});
