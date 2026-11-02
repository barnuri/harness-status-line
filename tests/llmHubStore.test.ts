import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LlmHubStore } from '../src/shared/llmHubStore.ts';
import type { LlmHubAuto } from '../src/types.ts';

const NOW = Date.parse('2026-10-31T20:00:00Z');
const BASE_URL = 'http://127.0.0.1:8888';

describe('LlmHubStore', () => {
  let dir: string;
  let store: LlmHubStore;

  const decision = (model: string): LlmHubAuto => ({ model, complexity: 'medium', tier: 'fast', mode: 'auto' });
  const selection = (model: string, effort = 'low'): LlmHubAuto => ({
    model,
    complexity: null,
    tier: 'balance',
    mode: 'smart-auto',
    effort,
    state: 'completed',
    reviewers: [{ model: 'copilot/judge' }],
  });
  const storeFile = (): string => {
    const [name] = fs.readdirSync(dir);
    if (name === undefined) {
      throw new Error('LlmHubStore wrote no file');
    }
    return path.join(dir, name);
  };
  const storedFetchedAt = (session: string): unknown =>
    JSON.parse(fs.readFileSync(storeFile(), 'utf-8')).decisions[session]?.fetchedAt;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-hub-store-'));
    store = new LlmHubStore(BASE_URL, dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the newest 50 session decisions and evicts the oldest', () => {
    for (let index = 0; index <= 50; index += 1) {
      store.writeDecision(`sess-${index}`, decision(`copilot/model-${index}`), NOW + index);
    }

    expect(store.readDecision('sess-0')).toBeNull();
    expect(store.readDecision('sess-1')).toEqual(decision('copilot/model-1'));
    expect(store.readDecision('sess-50')).toEqual(decision('copilot/model-50'));
    expect(Object.keys(JSON.parse(fs.readFileSync(storeFile(), 'utf-8')).decisions)).toHaveLength(50);
  });

  it('skips the write when the decision is unchanged', () => {
    store.writeDecision('sess-1', decision('copilot/claude-sonnet-5-5'), NOW);
    store.writeDecision('sess-1', decision('copilot/claude-sonnet-5-5'), NOW + 1000);

    expect(storedFetchedAt('sess-1')).toBe(NOW);
  });

  it('rewrites the decision when the tier changes', () => {
    store.writeDecision('sess-1', decision('copilot/claude-sonnet-5-5'), NOW);
    store.writeDecision('sess-1', { ...decision('copilot/claude-sonnet-5-5'), tier: 'deep' }, NOW + 1000);

    expect(storedFetchedAt('sess-1')).toBe(NOW + 1000);
    expect(store.readDecision('sess-1')?.tier).toBe('deep');
  });

  for (const [label, content] of [
    ['malformed JSON', '{"usage": {'],
    ['a partial file without decisions', '{"usage": {}}'],
    ['a JSON array', '[]'],
  ] as const) {
    it(`reads ${label} as empty`, () => {
      store.recordFailure(NOW);
      fs.writeFileSync(storeFile(), content, 'utf-8');

      expect(store.readDecision('sess-1')).toBeNull();
      expect(store.readUsage('copilot')).toBeNull();
      expect(store.isBackingOff(NOW)).toBe(false);
    });
  }

  it('recovers from a malformed file on the next write', () => {
    store.recordFailure(NOW);
    fs.writeFileSync(storeFile(), 'not json', 'utf-8');

    store.writeDecision('sess-1', decision('copilot/claude-sonnet-5-5'), NOW);

    expect(store.readDecision('sess-1')).toEqual(decision('copilot/claude-sonnet-5-5'));
  });

  it('reads the stored effort back with the Auto decision', () => {
    store.writeDecision('sess-1', { ...decision('copilot/claude-sonnet-5-5'), effort: 'medium' }, NOW);

    expect(store.readDecision('sess-1')?.effort).toBe('medium');
  });

  it('reads a Smart Auto selection with its age, and marks it stale after 60 s', () => {
    store.writeSelection('sess-1', selection('copilot/model-a'), NOW);

    expect(store.readSelection('sess-1', NOW + 59_000)).toMatchObject({ model: 'copilot/model-a', ageMs: 59_000, stale: false });
    expect(store.readSelection('sess-1', NOW + 61_000)).toMatchObject({ model: 'copilot/model-a', ageMs: 61_000, stale: true });
  });

  it('keeps the age out of the file, and the hub stale flag in it', () => {
    store.writeSelection('sess-1', { ...selection('copilot/model-a'), ageMs: 5_000, stale: true }, NOW);

    const stored = JSON.parse(fs.readFileSync(storeFile(), 'utf-8')).selections['sess-1'];
    expect(stored.selection).not.toHaveProperty('ageMs');
    expect(stored.selection.stale).toBe(true);
  });

  it('dates a selection from the hub age, so an old one is not read as fresh', () => {
    store.writeSelection('sess-1', { ...selection('copilot/model-a'), ageMs: 120_000 }, NOW);

    expect(store.readSelection('sess-1', NOW)).toMatchObject({ ageMs: 120_000, stale: true });
  });

  it('keeps the hub stale flag on read', () => {
    store.writeSelection('sess-1', { ...selection('copilot/model-a'), stale: true }, NOW);

    expect(store.readSelection('sess-1', NOW)).toMatchObject({ ageMs: 0, stale: true });
  });

  it('returns null for a session with no stored selection', () => {
    expect(store.readSelection('sess-1', NOW)).toBeNull();
  });

  it('skips the rewrite of an unchanged selection until the touch interval passes', () => {
    store.writeSelection('sess-1', selection('copilot/model-a'), NOW);
    store.writeSelection('sess-1', selection('copilot/model-a'), NOW + 1_000);
    expect(JSON.parse(fs.readFileSync(storeFile(), 'utf-8')).selections['sess-1'].fetchedAt).toBe(NOW);

    store.writeSelection('sess-1', selection('copilot/model-a'), NOW + 61_000);
    expect(JSON.parse(fs.readFileSync(storeFile(), 'utf-8')).selections['sess-1'].fetchedAt).toBe(NOW + 61_000);
  });

  it('rewrites a selection when its model or effort changes', () => {
    store.writeSelection('sess-1', selection('copilot/model-a', 'low'), NOW);
    store.writeSelection('sess-1', selection('copilot/model-a', 'high'), NOW + 1_000);

    expect(store.readSelection('sess-1', NOW + 1_000)).toMatchObject({ effort: 'high', ageMs: 0 });
  });

  it('ignores an older observation that arrives after a newer one', () => {
    store.writeSelection('sess-1', selection('copilot/newer'), NOW + 5_000);
    store.writeSelection('sess-1', selection('copilot/older'), NOW);

    expect(store.readSelection('sess-1', NOW + 5_000)?.model).toBe('copilot/newer');
  });

  it('keeps concurrent sessions selections apart', () => {
    store.writeSelection('sess-a', selection('copilot/model-a'), NOW);
    store.writeSelection('sess-b', selection('copilot/model-b', 'high'), NOW + 1);
    store.writeSelection('sess-a', selection('copilot/model-c'), NOW + 2);

    expect(store.readSelection('sess-a', NOW + 2)?.model).toBe('copilot/model-c');
    expect(store.readSelection('sess-b', NOW + 2)).toMatchObject({ model: 'copilot/model-b', effort: 'high' });
  });

  it('keeps the newest 50 selections across sessions', () => {
    for (let index = 0; index <= 50; index += 1) {
      store.writeSelection(`sess-${index}`, selection(`copilot/model-${index}`), NOW + index);
    }

    expect(store.readSelection('sess-0', NOW + 50)).toBeNull();
    expect(store.readSelection('sess-50', NOW + 50)?.model).toBe('copilot/model-50');
    expect(Object.keys(JSON.parse(fs.readFileSync(storeFile(), 'utf-8')).selections)).toHaveLength(50);
  });

  it('reads a file written before selections existed as having none', () => {
    store.writeDecision('sess-1', decision('copilot/claude-sonnet-5-5'), NOW);
    fs.writeFileSync(storeFile(), '{"usage": {}, "decisions": {}}', 'utf-8');
    expect(store.readSelection('sess-1', NOW)).toBeNull();

    store.writeSelection('sess-1', selection('copilot/model-a'), NOW);
    expect(store.readSelection('sess-1', NOW)?.model).toBe('copilot/model-a');
  });
});
