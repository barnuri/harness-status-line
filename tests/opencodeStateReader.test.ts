import { describe, expect, it } from 'bun:test';
import { OpencodeStateReader } from '../src/opencode/opencodeStateReader.ts';
import type { OpencodeMessage, OpencodeTuiSlice } from '../src/opencode/types.ts';

const reader = new OpencodeStateReader();

const assistant = (overrides: Partial<OpencodeMessage> = {}): OpencodeMessage => ({
  type: 'assistant',
  model: { id: 'claude-opus-5', providerID: 'anthropic' },
  tokens: { input: 1_000, output: 200, reasoning: 0, cache: { read: 300, write: 100 } },
  ...overrides,
});

const api = (
  messages: ReadonlyArray<OpencodeMessage> = [assistant()],
  overrides: Partial<OpencodeTuiSlice> = {},
): OpencodeTuiSlice => ({
  app: { version: '2.2.7' },
  data: {
    session: { cost: () => 0.25, message: { list: () => messages } },
    location: {
      default: () => ({ directory: '/repo/project' }),
      model: {
        list: () => [
          { modelID: 'claude-opus-5', providerID: 'anthropic', name: 'Claude Opus 5', limit: { context: 200_000 } },
          { modelID: 'hub/smart-auto-balance', providerID: 'llm-hub', name: 'Smart Auto (Balance)' },
        ],
      },
    },
  },
  ui: {
    router: { current: () => ({ type: 'session', sessionID: 'ses-route' }) },
    model: { current: () => ({ providerID: 'llm-hub', modelID: 'hub/smart-auto-balance' }) },
  },
  ...overrides,
});

describe('OpencodeStateReader.read()', () => {
  describe('empty and hostile input', () => {
    it('returns an empty input for a bare object', () => {
      expect(reader.read({})).toEqual({});
    });

    it('survives accessors that throw', () => {
      const throwing: OpencodeTuiSlice = {
        data: {
          session: {
            message: {
              list: () => {
                throw new Error('boom');
              },
            },
          },
        },
        ui: {
          router: {
            current: () => {
              throw new Error('boom');
            },
          },
        },
      };

      expect(reader.read(throwing, 'ses-1')).toEqual({ sessionId: 'ses-1' });
    });
  });

  describe('session', () => {
    it('reads the latest assistant message of the slot session', () => {
      const selected = { ui: { ...api().ui, model: { current: () => ({ providerID: 'anthropic', modelID: 'claude-opus-5' }) } } };
      const input = reader.read(api(undefined, selected as Partial<OpencodeTuiSlice>), 'ses-1');

      expect(input).toEqual({
        directory: '/repo/project',
        version: '2.2.7',
        sessionId: 'ses-1',
        model: 'Claude Opus 5',
        modelId: 'claude-opus-5',
        providerId: 'anthropic',
        contextWindowSize: 200_000,
        contextTokens: 1_600,
        sessionCostUsd: 0.25,
      });
    });

    it('falls back to the session route when the slot has no session id', () => {
      expect(reader.read(api()).sessionId).toBe('ses-route');
    });

    it('shows the prompt-selected model after /model, before the next reply', () => {
      const input = reader.read(api([assistant()]), 'ses-1');

      expect(input.modelId).toBe('hub/smart-auto-balance');
      expect(input.providerId).toBe('llm-hub');
    });
  });

  describe('before the first reply', () => {
    it('shows the prompt-selected model and no cost', () => {
      const input = reader.read(api([]), 'ses-1');

      expect(input.model).toBe('Smart Auto (Balance)');
      expect(input.modelId).toBe('hub/smart-auto-balance');
      expect(input.providerId).toBe('llm-hub');
      expect(input.sessionCostUsd).toBeUndefined();
      expect(input.contextTokens).toBeUndefined();
    });
  });
});
