import { describe, expect, it } from 'bun:test';
import { OpencodeStateReader } from '../src/opencode/opencodeStateReader.ts';
import type { OpencodeMessage, OpencodeTuiSlice } from '../src/opencode/types.ts';

const reader = new OpencodeStateReader();

const assistant = (overrides: Partial<OpencodeMessage> = {}): OpencodeMessage => ({
  role: 'assistant',
  modelID: 'claude-opus-5',
  providerID: 'anthropic',
  tokens: { input: 1_000, output: 200, reasoning: 0, cache: { read: 300, write: 100 } },
  ...overrides,
});

const api = (overrides: Partial<OpencodeTuiSlice> = {}): OpencodeTuiSlice => ({
  app: { version: '1.18.11' },
  route: { current: { name: 'session', params: { sessionID: 'ses-1' } } },
  state: {
    path: { directory: '/repo/project', worktree: '/repo' },
    provider: [
      {
        id: 'anthropic',
        models: { 'claude-opus-5': { name: 'Claude Opus 5', limit: { context: 200_000 } } },
      },
    ],
    session: { messages: () => [assistant()] },
  },
  ...overrides,
});

describe('OpencodeStateReader.read()', () => {
  describe('empty and hostile input', () => {
    it('returns an empty input for a bare object', () => {
      expect(reader.read({})).toEqual({});
    });

    it('does not throw when state is missing entirely', () => {
      expect(() => reader.read({ app: { version: '1.0.0' } })).not.toThrow();
      expect(reader.read({ app: { version: '1.0.0' } })).toEqual({ version: '1.0.0' });
    });

    it('survives a messages() that throws', () => {
      const hostile = api({
        state: {
          ...api().state,
          session: {
            messages: () => {
              throw new Error('session not loaded');
            },
          },
        },
      });
      expect(() => reader.read(hostile)).not.toThrow();
      expect(reader.read(hostile).model).toBeUndefined();
    });

    it('survives messages() returning an empty list', () => {
      const empty = api({ state: { ...api().state, session: { messages: () => [] } } });
      const result = reader.read(empty);
      expect(result.model).toBeUndefined();
      expect(result.contextTokens).toBeUndefined();
    });
  });

  describe('directory', () => {
    it('prefers path.directory', () => {
      expect(reader.read(api()).directory).toBe('/repo/project');
    });

    it('falls back to worktree when directory is absent', () => {
      const result = reader.read(api({ state: { path: { worktree: '/repo' } } }));
      expect(result.directory).toBe('/repo');
    });

    it('omits directory when neither is present', () => {
      expect(reader.read(api({ state: { path: {} } })).directory).toBeUndefined();
    });
  });

  describe('session id', () => {
    it('reads the session id from the session route', () => {
      expect(reader.read(api()).sessionId).toBe('ses-1');
    });

    it('omits the session id on the home route', () => {
      const result = reader.read(api({ route: { current: { name: 'home' } } }));
      expect(result.sessionId).toBeUndefined();
    });

    it('omits the session id when there is no route', () => {
      expect(reader.read(api({ route: undefined })).sessionId).toBeUndefined();
    });
  });

  describe('model', () => {
    it('uses the provider catalogue display name', () => {
      expect(reader.read(api()).model).toBe('Claude Opus 5');
    });

    it('falls back to the raw modelID when the model is not in the catalogue', () => {
      const result = reader.read(api({ state: { ...api().state, provider: [] } }));
      expect(result.model).toBe('claude-opus-5');
      expect(result.contextWindowSize).toBeUndefined();
    });

    it('finds the model under a different provider when providerID does not match', () => {
      const result = reader.read(
        api({
          state: {
            ...api().state,
            provider: [
              { id: 'other', models: { 'claude-opus-5': { name: 'Opus via other', limit: { context: 111 } } } },
            ],
          },
        }),
      );
      expect(result.model).toBe('Opus via other');
      expect(result.contextWindowSize).toBe(111);
    });

    it('reads the context limit from the matching provider', () => {
      expect(reader.read(api()).contextWindowSize).toBe(200_000);
    });

    it('omits the model when the latest assistant message has no modelID', () => {
      const noModel = api({
        state: { ...api().state, session: { messages: () => [assistant({ modelID: undefined })] } },
      });
      expect(reader.read(noModel).model).toBeUndefined();
    });
  });

  describe('latest assistant message selection', () => {
    it('picks the last assistant message, ignoring later user messages', () => {
      const messages: OpencodeMessage[] = [
        assistant({ modelID: 'old-model', tokens: { total: 1 } }),
        assistant({ modelID: 'claude-opus-5', tokens: { total: 4_242 } }),
        { role: 'user' },
      ];
      const result = reader.read(api({ state: { ...api().state, session: { messages: () => messages } } }));
      expect(result.model).toBe('Claude Opus 5');
      expect(result.contextTokens).toBe(4_242);
    });

    it('ignores a session made up only of user messages', () => {
      const result = reader.read(
        api({ state: { ...api().state, session: { messages: () => [{ role: 'user' }, { role: 'user' }] } } }),
      );
      expect(result.contextTokens).toBeUndefined();
    });
  });

  describe('context tokens', () => {
    it('prefers tokens.total when present', () => {
      const withTotal = api({
        state: { ...api().state, session: { messages: () => [assistant({ tokens: { total: 5_555, input: 1 } })] } },
      });
      expect(reader.read(withTotal).contextTokens).toBe(5_555);
    });

    it('sums input, output, reasoning and cache when total is absent', () => {
      expect(reader.read(api()).contextTokens).toBe(1_600);
    });

    it('sums only the fields that are present', () => {
      const partial = api({
        state: { ...api().state, session: { messages: () => [assistant({ tokens: { input: 700 } })] } },
      });
      expect(reader.read(partial).contextTokens).toBe(700);
    });

    it('omits contextTokens when the tokens object is empty', () => {
      const noTokens = api({
        state: { ...api().state, session: { messages: () => [assistant({ tokens: {} })] } },
      });
      expect(reader.read(noTokens).contextTokens).toBeUndefined();
    });

    it('omits contextTokens when tokens is absent', () => {
      const noTokens = api({
        state: { ...api().state, session: { messages: () => [assistant({ tokens: undefined })] } },
      });
      expect(reader.read(noTokens).contextTokens).toBeUndefined();
    });

    it('keeps a genuine zero token count', () => {
      const zero = api({
        state: { ...api().state, session: { messages: () => [assistant({ tokens: { total: 0 } })] } },
      });
      expect(reader.read(zero).contextTokens).toBe(0);
    });
  });

  describe('version', () => {
    it('reads the opencode version', () => {
      expect(reader.read(api()).version).toBe('1.18.11');
    });

    it('omits the version when absent', () => {
      expect(reader.read(api({ app: {} })).version).toBeUndefined();
    });
  });
});
