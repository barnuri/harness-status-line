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
  let dir: string;

  const autoStatus = (overrides: Partial<StatusJSON> = {}): StatusJSON => ({
    session_id: 'sess-1',
    model: { id: 'copilot/auto', display_name: 'copilot/auto' },
    ...overrides,
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

    expect(result.llm_hub_auto).toEqual({ model: 'copilot/claude-sonnet-5-5', complexity: 'medium', tier: 'fast' });
    expect(result.copilot_quota?.quotas[0]?.used).toBe(12_626);
  });

  it('sets the Auto pick for a tiered copilot/auto-<tier> model', async () => {
    const result = await enricher().apply(autoStatus({ model: { id: 'copilot/auto-fast' } }), NOW);

    expect(result.llm_hub_auto).toEqual({ model: 'copilot/claude-sonnet-5-5', complexity: 'medium', tier: 'fast' });
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
});
