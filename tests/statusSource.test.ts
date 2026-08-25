import { describe, expect, it } from 'bun:test';
import { OpencodeStatusSource } from '../src/opencode/statusSource.ts';
import { StatusParser } from '../src/statusParser.ts';
import { ConfigManager } from '../src/configManager.ts';
import type { Config, UsageSnapshot } from '../src/types.ts';

const source = new OpencodeStatusSource();
const parser = new StatusParser();

const FRESH_SNAPSHOT: UsageSnapshot = {
  api: { type: 'subscription', plan: 'max' },
  rate_limits: {
    five_hour: { used_percentage: 12 },
    seven_day: { used_percentage: 80 },
  },
  session_id: 'snapshot-session',
  captured_at: '2026-08-04T06:00:00Z',
};

const configWith = (overrides: Partial<Config['segments']>): Config => ({
  ...ConfigManager.DEFAULT_CONFIG,
  segments: { ...ConfigManager.DEFAULT_CONFIG.segments, ...overrides },
});

const labelsOf = (config: Config, input: Parameters<typeof source.build>[0], snapshot: UsageSnapshot | null): string[] =>
  parser.buildSegments(source.build(input, snapshot), config).map((segment) => segment.label);

describe('OpencodeStatusSource.build()', () => {
  describe('empty input', () => {
    it('returns an empty StatusJSON for no input and no snapshot', () => {
      expect(source.build({}, null)).toEqual({});
    });

    it('produces no segments beyond the always-on auth fallback', () => {
      const config = configWith({ auth: false, git: false, slug: false });
      expect(parser.buildSegments(source.build({}, null), config)).toEqual([]);
    });
  });

  describe('directory', () => {
    it('maps directory onto both cwd and workspace.current_dir', () => {
      const status = source.build({ directory: '/tmp/my-project' }, null);
      expect(status.cwd).toBe('/tmp/my-project');
      expect(status.workspace?.current_dir).toBe('/tmp/my-project');
    });

    it('renders the folder segment from the basename', () => {
      const config = configWith({ auth: false, git: false, slug: false });
      const segments = parser.buildSegments(source.build({ directory: '/tmp/my-project' }, null), config);
      expect(segments).toHaveLength(1);
      expect(segments[0]?.value).toBe('my-project');
    });
  });

  describe('model', () => {
    it('passes the model string through to the model segment', () => {
      const config = configWith({ auth: false, git: false, slug: false, folder: false });
      const segments = parser.buildSegments(source.build({ model: 'anthropic/claude-opus-5' }, null), config);
      expect(segments).toHaveLength(1);
      expect(segments[0]?.value).toBe('anthropic/claude-opus-5');
    });

    it('omits the model key when absent', () => {
      expect(source.build({}, null).model).toBeUndefined();
    });
  });

  describe('context window', () => {
    it('derives the context percentage from tokens and size', () => {
      const status = source.build({ contextTokens: 45_000, contextWindowSize: 200_000 }, null);
      expect(status.context_window).toEqual({ tokens: 45_000, size: 200_000 });

      const config = configWith({ auth: false, git: false, slug: false, folder: false });
      const segments = parser.buildSegments(status, config);
      expect(segments).toHaveLength(1);
      expect(segments[0]?.value).toBe('23% · 45k/200k');
    });

    it('omits the context segment when context visibility is off', () => {
      const config = configWith({ auth: false, git: false, slug: false, folder: false, context: false });
      const segments = parser.buildSegments(
        source.build({ contextTokens: 45_000, contextWindowSize: 200_000 }, null),
        config,
      );
      expect(segments).toEqual([]);
    });

    it('renders the token count next to the percentage when the size is known', () => {
      const config = configWith({ auth: false, git: false, slug: false, folder: false });
      const segments = parser.buildSegments(
        source.build({ contextTokens: 45_000, contextWindowSize: 200_000 }, null),
        config,
      );
      expect(segments.map((s) => s.value)).toEqual(['23% · 45k/200k']);
    });

    it('omits context_window entirely when neither tokens nor size are given', () => {
      expect(source.build({ model: 'x' }, null).context_window).toBeUndefined();
    });

    it('includes tokens alone when size is unknown', () => {
      expect(source.build({ contextTokens: 1_234 }, null).context_window).toEqual({ tokens: 1_234 });
    });

    it('includes size alone when tokens are unknown', () => {
      expect(source.build({ contextWindowSize: 200_000 }, null).context_window).toEqual({ size: 200_000 });
    });

    it('treats zero tokens as present rather than missing', () => {
      expect(source.build({ contextTokens: 0, contextWindowSize: 200_000 }, null).context_window).toEqual({
        tokens: 0,
        size: 200_000,
      });
    });
  });

  describe('with a fresh snapshot', () => {
    it('adopts the snapshot rate limits and api info', () => {
      const status = source.build({ directory: '/tmp/p' }, FRESH_SNAPSHOT);
      expect(status.rate_limits).toEqual(FRESH_SNAPSHOT.rate_limits);
      expect(status.api).toEqual({ type: 'subscription', plan: 'max' });
    });

    it('renders both rate-limit segments', () => {
      const config = configWith({ auth: false, git: false, slug: false, folder: false });
      const labels = parser.buildSegments(source.build({}, FRESH_SNAPSHOT), config).map((s) => s.label);
      expect(labels).toEqual(['daily', 'weekly']);
    });

    it('does not take session_id from the snapshot', () => {
      expect(source.build({}, FRESH_SNAPSHOT).session_id).toBeUndefined();
      expect(source.build({ sessionId: 'opencode-session' }, FRESH_SNAPSHOT).session_id).toBe('opencode-session');
    });
  });

  describe('without a snapshot (stale or missing)', () => {
    it('omits rate_limits and api', () => {
      const status = source.build({ directory: '/tmp/p', model: 'm' }, null);
      expect(status.rate_limits).toBeUndefined();
      expect(status.api).toBeUndefined();
    });

    it('degrades by dropping only the rate-limit segments', () => {
      const config = configWith({ auth: false, git: false, slug: false, folder: false });
      const input = { contextTokens: 10_000, contextWindowSize: 100_000 };

      expect(labelsOf(config, input, FRESH_SNAPSHOT)).toEqual(['ctx', 'daily', 'weekly']);
      expect(labelsOf(config, input, null)).toEqual(['ctx']);
    });

    it('keeps api absent when the snapshot carries a null api', () => {
      const snapshot: UsageSnapshot = { ...FRESH_SNAPSHOT, api: null };
      expect(source.build({}, snapshot).api).toBeUndefined();
      expect(source.build({}, snapshot).rate_limits).toEqual(FRESH_SNAPSHOT.rate_limits);
    });
  });

  describe('segment ordering', () => {
    it('emits folder, model, ctx, auth, then rate limits', () => {
      const config = configWith({ git: false, slug: false });
      const status = source.build(
        {
          directory: '/tmp/my-project',
          model: 'claude-opus-5',
          contextTokens: 50_000,
          contextWindowSize: 200_000,
        },
        FRESH_SNAPSHOT,
      );
      const segments = parser.buildSegments(status, config);
      expect(segments.map((s) => s.label)).toEqual(['', '', 'ctx', 'auth', 'daily', 'weekly']);
      expect(segments[0]?.value).toBe('my-project');
      expect(segments[1]?.value).toBe('claude-opus-5');
    });
  });

  describe('version', () => {
    it('passes the opencode version through', () => {
      expect(source.build({ version: '1.18.11' }, null).version).toBe('1.18.11');
    });
  });
});
