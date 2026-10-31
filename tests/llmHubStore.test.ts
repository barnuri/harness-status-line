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

  const decision = (model: string): LlmHubAuto => ({ model, complexity: 'medium', tier: 'fast' });
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
});
