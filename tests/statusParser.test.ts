import { describe, it, expect } from 'bun:test';
import { StatusParser } from '../src/statusParser.ts';
import { ConfigManager } from '../src/configManager.ts';
import type { Config } from '../src/types.ts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const cfg = ConfigManager.DEFAULT_CONFIG;

function makeConfig(overrides?: Partial<Config>): Config {
  return { ...cfg, ...overrides };
}

const parser = new StatusParser();

// ────────────────────────────────────────────────────────
// parse()
// ────────────────────────────────────────────────────────

describe('StatusParser.parse()', () => {
  it('returns empty object for empty string', () => {
    expect(parser.parse('')).toEqual({});
  });

  it('returns empty object for whitespace-only string', () => {
    expect(parser.parse('   \n  ')).toEqual({});
  });

  it('returns empty object for invalid JSON', () => {
    expect(parser.parse('{not json}')).toEqual({});
  });

  it('parses valid JSON', () => {
    expect(parser.parse('{"model": "claude-3"}')).toEqual({ model: 'claude-3' });
  });
});

// ────────────────────────────────────────────────────────
// buildSegments() — folder
// ────────────────────────────────────────────────────────

describe('buildSegments() — folder segment', () => {
  it('extracts folder from cwd', () => {
    const segs = parser.buildSegments({ cwd: '/home/user/my-project' }, cfg);
    const seg = segs.find(s => s.icon === '📁 ');
    expect(seg?.value).toBe('my-project');
  });

  it('extracts folder from workspace.current_dir when cwd is absent', () => {
    const segs = parser.buildSegments({ workspace: { current_dir: '/repos/my-repo' } }, cfg);
    const seg = segs.find(s => s.icon === '📁 ');
    expect(seg?.value).toBe('my-repo');
  });

  it('uses OLED folder colors (bg slate, fg light)', () => {
    const segs = parser.buildSegments({ cwd: '/home/user/proj' }, cfg);
    const seg = segs.find(s => s.icon === '📁 ')!;
    expect(seg.bg).toEqual([30, 41, 59]);
    expect(seg.fg).toEqual([248, 250, 252]);
  });

  it('omits folder segment when visibility.folder is false', () => {
    const config = makeConfig({ segments: { ...cfg.segments, folder: false } });
    const segs = parser.buildSegments({ cwd: '/home/user/proj' }, config);
    expect(segs.find(s => s.icon === '📁 ')).toBeUndefined();
  });

  it('omits folder when cwd and workspace are absent', () => {
    const segs = parser.buildSegments({}, cfg);
    expect(segs.find(s => s.icon === '📁 ')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// buildSegments() — slug segment
// ────────────────────────────────────────────────────────

describe('buildSegments() — slug segment', () => {
  const slugDir = path.join(os.homedir(), '.claude', 'session-slugs');
  const SLUG_ENV_KEYS = [
    'CURSOR_CONVERSATION_ID',
    'CLAUDE_CODE_SESSION_ID',
    'CODEX_THREAD_ID',
    'GROK_SESSION_ID',
    'GEMINI_SESSION_ID',
    'DSH_SESSION_ID',
    'DEEPSEEK_SESSION_ID',
  ] as const;

  function withClearedSlugEnv(run: () => void): void {
    const saved: Record<string, string | undefined> = {};
    for (const key of SLUG_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      run();
    } finally {
      for (const key of SLUG_ENV_KEYS) {
        const prev = saved[key];
        if (prev === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = prev;
        }
      }
    }
  }

  function writeSlugFile(sessionId: string, slug: string): void {
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, sessionId), slug + '\n', 'utf-8');
  }

  function removeSlugFile(sessionId: string): void {
    try {
      fs.unlinkSync(path.join(slugDir, sessionId));
    } catch {
      // already absent
    }
  }

  it('reads the slug from ~/.claude/session-slugs/<session_id> when session_id is present', () => {
    const sessionId = 'test-slug-segment-session';
    writeSlugFile(sessionId, '2026-07-29-skills-evolvement');
    try {
      const segs = parser.buildSegments({ session_id: sessionId }, cfg);
      const seg = segs.find(s => s.icon === '🏷 ');
      expect(seg?.value).toBe('2026-07-29-skills-evolvement');
    } finally {
      removeSlugFile(sessionId);
    }
  });

  it('omits the slug segment when no slug file exists for the session', () => {
    const segs = parser.buildSegments({ session_id: 'session-with-no-slug-file' }, cfg);
    expect(segs.find(s => s.icon === '🏷 ')).toBeUndefined();
  });

  it('omits the slug segment when session_id is absent', () => {
    withClearedSlugEnv(() => {
      const segs = parser.buildSegments({}, cfg);
      expect(segs.find(s => s.icon === '🏷 ')).toBeUndefined();
    });
  });

  it('falls back to CURSOR_CONVERSATION_ID when status.session_id is absent', () => {
    const conversationId = 'test-cursor-conversation-id';
    writeSlugFile(conversationId, '2026-08-16-cursor-slug');
    withClearedSlugEnv(() => {
      process.env['CURSOR_CONVERSATION_ID'] = conversationId;
      try {
        const segs = parser.buildSegments({}, cfg);
        const seg = segs.find(s => s.icon === '🏷 ');
        expect(seg?.value).toBe('2026-08-16-cursor-slug');
      } finally {
        removeSlugFile(conversationId);
      }
    });
  });

  it('falls back to GROK_SESSION_ID when status.session_id is absent', () => {
    const grokId = 'test-grok-session-id';
    writeSlugFile(grokId, '2026-08-16-grok-slug');
    withClearedSlugEnv(() => {
      process.env['GROK_SESSION_ID'] = grokId;
      try {
        const segs = parser.buildSegments({}, cfg);
        const seg = segs.find(s => s.icon === '🏷 ');
        expect(seg?.value).toBe('2026-08-16-grok-slug');
      } finally {
        removeSlugFile(grokId);
      }
    });
  });

  it('omits slug segment when visibility.slug is false', () => {
    const sessionId = 'test-slug-visibility-off';
    writeSlugFile(sessionId, 'some-slug');
    try {
      const config = makeConfig({ segments: { ...cfg.segments, slug: false } });
      const segs = parser.buildSegments({ session_id: sessionId }, config);
      expect(segs.find(s => s.icon === '🏷 ')).toBeUndefined();
    } finally {
      removeSlugFile(sessionId);
    }
  });
});

// ────────────────────────────────────────────────────────
// buildSegments() — git branch
// ────────────────────────────────────────────────────────

class FakeParser extends StatusParser {
  private fakeBranch: string | null;

  constructor(branch: string | null) {
    super();
    this.fakeBranch = branch;
  }

  protected override detectGitBranch(_cwd: string): string | null {
    return this.fakeBranch;
  }
}

describe('buildSegments() — git branch segment', () => {
  it('includes git segment when branch is "main"', () => {
    const p = new FakeParser('main');
    const segs = p.buildSegments({ cwd: '/repo' }, cfg);
    expect(segs.find(s => s.label === 'git')?.value).toBe('main');
  });

  it('includes git segment when branch is "feature/foo"', () => {
    const p = new FakeParser('feature/foo');
    const segs = p.buildSegments({ cwd: '/repo' }, cfg);
    expect(segs.find(s => s.label === 'git')?.value).toBe('feature/foo');
  });

  it('uses git colors from config', () => {
    const p = new FakeParser('main');
    const segs = p.buildSegments({ cwd: '/repo' }, cfg);
    const seg = segs.find(s => s.label === 'git')!;
    expect(seg.bg).toEqual(cfg.colors.git.bg);
    expect(seg.fg).toEqual(cfg.colors.git.fg);
  });

  it('git icon is ⎇  (BMP branch symbol)', () => {
    const p = new FakeParser('main');
    const segs = p.buildSegments({ cwd: '/repo' }, cfg);
    expect(segs.find(s => s.label === 'git')?.icon).toBe('⎇ ');
  });

  it('omits git segment when visibility.git is false', () => {
    const p = new FakeParser('main');
    const config = makeConfig({ segments: { ...cfg.segments, git: false } });
    const segs = p.buildSegments({ cwd: '/repo' }, config);
    expect(segs.find(s => s.label === 'git')).toBeUndefined();
  });

  it('omits git segment when detectGitBranch returns null', () => {
    const p = new FakeParser(null);
    const segs = p.buildSegments({ cwd: '/repo' }, cfg);
    expect(segs.find(s => s.label === 'git')).toBeUndefined();
  });

  it('omits git segment when detectGitBranch returns "HEAD" (detached)', () => {
    const p = new FakeParser('HEAD');
    const segs = p.buildSegments({ cwd: '/repo' }, cfg);
    expect(segs.find(s => s.label === 'git')).toBeUndefined();
  });

  it('omits git segment when no cwd in status', () => {
    const p = new FakeParser('main');
    const segs = p.buildSegments({}, cfg);
    expect(segs.find(s => s.label === 'git')).toBeUndefined();
  });

  it('git segment appears after folder and before model', () => {
    const p = new FakeParser('main');
    const segs = p.buildSegments({ cwd: '/repo/proj', model: 'claude' }, cfg);
    const labels = segs.map(s => s.label || s.icon);
    const folderIdx = labels.indexOf('📁 ');
    const gitIdx = segs.findIndex(s => s.label === 'git');
    const modelIdx = labels.indexOf('🤖 ');
    expect(folderIdx).toBeLessThan(gitIdx);
    expect(gitIdx).toBeLessThan(modelIdx);
  });
});

// ────────────────────────────────────────────────────────
// buildSegments() — model
// ────────────────────────────────────────────────────────

describe('buildSegments() — model segment', () => {
  it('includes model segment when model is present', () => {
    const segs = parser.buildSegments({ model: 'claude-sonnet' }, cfg);
    const seg = segs.find(s => s.icon === '🤖 ');
    expect(seg?.value).toBe('claude-sonnet');
  });

  it('uses OLED model colors (bg slate-700, fg light)', () => {
    const segs = parser.buildSegments({ model: 'claude-opus' }, cfg);
    const seg = segs.find(s => s.icon === '🤖 ')!;
    expect(seg.bg).toEqual([51, 65, 85]);
    expect(seg.fg).toEqual([248, 250, 252]);
  });

  it('omits model segment when visibility.model is false', () => {
    const config = makeConfig({ segments: { ...cfg.segments, model: false } });
    const segs = parser.buildSegments({ model: 'claude' }, config);
    expect(segs.find(s => s.icon === '🤖 ')).toBeUndefined();
  });

  it('omits model segment when model is absent', () => {
    const segs = parser.buildSegments({}, cfg);
    expect(segs.find(s => s.icon === '🤖 ')).toBeUndefined();
  });

  it('handles model sent as object with id field', () => {
    const segs = parser.buildSegments({ model: { id: 'claude-sonnet-4-6' } }, cfg);
    expect(segs.find(s => s.icon === '🤖 ')?.value).toBe('claude-sonnet-4-6');
  });

  it('prefers display_name over id in model object (actual Claude Code format)', () => {
    const segs = parser.buildSegments({ model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' } }, cfg);
    expect(segs.find(s => s.icon === '🤖 ')?.value).toBe('Sonnet 4.6');
  });

  it('handles model sent as object with name field', () => {
    const segs = parser.buildSegments({ model: { name: 'Claude Sonnet' } }, cfg);
    expect(segs.find(s => s.icon === '🤖 ')?.value).toBe('Claude Sonnet');
  });

  it('omits model segment when model object has no recognized key', () => {
    const segs = parser.buildSegments({ model: {} }, cfg);
    expect(segs.find(s => s.icon === '🤖 ')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// buildSegments() — context window
// ────────────────────────────────────────────────────────

describe('buildSegments() — context segment colors', () => {
  function ctxSeg(percentage: number) {
    return parser.buildSegments({ context_window: { percentage } }, cfg).find(s => s.label === 'ctx')!;
  }

  it('uses green (ctxHealthy) when ctx < 60%', () => {
    const seg = ctxSeg(45);
    expect(seg.bg).toEqual(cfg.colors.ctxHealthy.bg);
    expect(seg.fg).toEqual(cfg.colors.ctxHealthy.fg);
  });

  it('uses amber (ctxWarning) when ctx is 61–80%', () => {
    const seg = ctxSeg(70);
    expect(seg.bg).toEqual(cfg.colors.ctxWarning.bg);
  });

  it('uses red (ctxCritical) when ctx > 80%', () => {
    const seg = ctxSeg(85);
    expect(seg.bg).toEqual(cfg.colors.ctxCritical.bg);
  });

  it('boundary 61% is warning', () => {
    expect(ctxSeg(61).bg).toEqual(cfg.colors.ctxWarning.bg);
  });

  it('boundary 81% is critical', () => {
    expect(ctxSeg(81).bg).toEqual(cfg.colors.ctxCritical.bg);
  });

  it('computes percentage from tokens + size', () => {
    const segs = parser.buildSegments({ context_window: { tokens: 50, size: 100 } }, cfg);
    expect(segs.find(s => s.label === 'ctx')?.value).toBe('50%');
  });

  it('uses used_percentage from actual Claude Code context_window format', () => {
    const segs = parser.buildSegments({ context_window: { used_percentage: 60, total_input_tokens: 120000, context_window_size: 200000 } }, cfg);
    expect(segs.find(s => s.label === 'ctx')?.value).toBe('60%');
  });

  it('used_percentage takes priority over percentage', () => {
    const segs = parser.buildSegments({ context_window: { used_percentage: 60, percentage: 30 } }, cfg);
    expect(segs.find(s => s.label === 'ctx')?.value).toBe('60%');
  });

  it('rounds percentage to integer', () => {
    const segs = parser.buildSegments({ context_window: { percentage: 74.7 } }, cfg);
    expect(segs.find(s => s.label === 'ctx')?.value).toBe('75%');
  });

  it('omits context segment when visibility.context is false', () => {
    const config = makeConfig({ segments: { ...cfg.segments, context: false } });
    const segs = parser.buildSegments({ context_window: { percentage: 50 } }, config);
    expect(segs.find(s => s.label === 'ctx')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// buildSegments() — tokens + mini-bar
// ────────────────────────────────────────────────────────

describe('buildSegments() — tokens + mini-bar', () => {
  it('formats token count in k notation', () => {
    const segs = parser.buildSegments({ context_window: { tokens: 45200 } }, cfg);
    expect(segs.find(s => s.label === 'tokens')?.value).toContain('45.2k');
  });

  it('reads total_input_tokens from actual Claude Code context_window format', () => {
    const segs = parser.buildSegments({ context_window: { total_input_tokens: 120166, context_window_size: 200000 } }, cfg);
    expect(segs.find(s => s.label === 'tokens')?.value).toContain('120.2k');
  });

  it('total_input_tokens takes priority over tokens', () => {
    const segs = parser.buildSegments({ context_window: { total_input_tokens: 80000, tokens: 50000 } }, cfg);
    expect(segs.find(s => s.label === 'tokens')?.value).toContain('80.0k');
  });

  it('formats token count in M notation for millions', () => {
    const segs = parser.buildSegments({ context_window: { tokens: 1_500_000 } }, cfg);
    expect(segs.find(s => s.label === 'tokens')?.value).toContain('1.5M');
  });

  it('appends mini-bar when context percent is available', () => {
    const segs = parser.buildSegments({ context_window: { tokens: 45000, percentage: 45 } }, cfg);
    const val = segs.find(s => s.label === 'tokens')?.value ?? '';
    expect(val).toContain('45.0k');
    expect(val.length).toBeGreaterThan(6);
  });

  it('omits mini-bar when visibility.context is false even when percent is available', () => {
    const config = makeConfig({ segments: { ...cfg.segments, context: false } });
    const segs = parser.buildSegments({ context_window: { tokens: 45000, percentage: 45 } }, config);
    const val = segs.find(s => s.label === 'tokens')?.value ?? '';
    expect(val).not.toMatch(/[▏▎▍▌▋▊▉█]/);
  });

  it('omits mini-bar when context percent is unavailable (tokens only, no size)', () => {
    const segs = parser.buildSegments({ context_window: { tokens: 45000 } }, cfg);
    const val = segs.find(s => s.label === 'tokens')?.value ?? '';
    expect(val).not.toMatch(/[▏▎▍▌▋▊▉█]/);
  });

  it('uses tokens bg/fg from config', () => {
    const segs = parser.buildSegments({ context_window: { tokens: 10000 } }, cfg);
    const seg = segs.find(s => s.label === 'tokens')!;
    expect(seg.bg).toEqual(cfg.colors.tokens.bg);
    expect(seg.fg).toEqual(cfg.colors.tokens.fg);
  });

  it('omits tokens segment when visibility.tokens is false', () => {
    const config = makeConfig({ segments: { ...cfg.segments, tokens: false } });
    const segs = parser.buildSegments({ context_window: { tokens: 50000 } }, config);
    expect(segs.find(s => s.label === 'tokens')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// buildMiniBar()
// ────────────────────────────────────────────────────────

describe('buildMiniBar()', () => {
  it('returns 5 chars wide', () => {
    expect(parser.buildMiniBar(0).length).toBe(5);
    expect(parser.buildMiniBar(50).length).toBe(5);
    expect(parser.buildMiniBar(100).length).toBe(5);
  });

  it('0% returns 5 spaces', () => {
    expect(parser.buildMiniBar(0)).toBe('     ');
  });

  it('100% returns 5 full blocks', () => {
    expect(parser.buildMiniBar(100)).toBe('█████');
  });

  it('50% returns roughly 2–3 filled chars', () => {
    const bar = parser.buildMiniBar(50);
    const filled = (bar.match(/[▏▎▍▌▋▊▉█]/g) ?? []).length;
    expect(filled).toBeGreaterThanOrEqual(2);
    expect(filled).toBeLessThanOrEqual(3);
  });

  it('clamps negative input to 0 (all spaces)', () => {
    expect(parser.buildMiniBar(-10)).toBe('     ');
  });

  it('clamps over-100 to 5 full blocks', () => {
    expect(parser.buildMiniBar(110)).toBe('█████');
  });

  it('uses fractional block chars for partial fill', () => {
    const bar = parser.buildMiniBar(10);
    const fractional = '▏▎▍▌▋▊▉';
    const hasFractional = [...bar].some(c => fractional.includes(c));
    expect(hasFractional).toBe(true);
  });

  it('20% fills exactly 1 full block', () => {
    const bar = parser.buildMiniBar(20);
    expect(bar[0]).toBe('█');
    expect(bar[1]).not.toBe('█');
  });

  it('40% fills exactly 2 full blocks', () => {
    const bar = parser.buildMiniBar(40);
    expect(bar[0]).toBe('█');
    expect(bar[1]).toBe('█');
    expect(bar[2]).not.toBe('█');
  });
});

// ────────────────────────────────────────────────────────
// buildSegments() — rate limits
// ────────────────────────────────────────────────────────

describe('buildSegments() — rate limit segments', () => {
  it('uses cyan (rateHealthy) when remaining ≥ 50%', () => {
    const segs = parser.buildSegments({ rate_limits: { session: { remaining: 70, limit: 100 } } }, cfg);
    expect(segs.find(s => s.label === 'session')?.bg).toEqual(cfg.colors.rateHealthy.bg);
  });

  it('uses amber (rateWarning) when remaining 20–49%', () => {
    const segs = parser.buildSegments({ rate_limits: { session: { remaining: 30, limit: 100 } } }, cfg);
    expect(segs.find(s => s.label === 'session')?.bg).toEqual(cfg.colors.rateWarning.bg);
  });

  it('uses red (rateCritical) when remaining < 20%', () => {
    const segs = parser.buildSegments({ rate_limits: { session: { remaining: 10, limit: 100 } } }, cfg);
    expect(segs.find(s => s.label === 'session')?.bg).toEqual(cfg.colors.rateCritical.bg);
  });

  it('session icon is ⏱', () => {
    const segs = parser.buildSegments({ rate_limits: { session: { remaining: 80, limit: 100 } } }, cfg);
    expect(segs.find(s => s.label === 'session')?.icon).toBe('⏱ ');
  });

  it('week icon is 📅', () => {
    const segs = parser.buildSegments({ rate_limits: { week: { remaining: 80, limit: 100 } } }, cfg);
    expect(segs.find(s => s.label === 'week')?.icon).toBe('📅 ');
  });

  it('unknown key icon defaults to ⚡', () => {
    const segs = parser.buildSegments({ rate_limits: { custom: { remaining: 80, limit: 100 } } }, cfg);
    expect(segs.find(s => s.label === 'custom')?.icon).toBe('⚡ ');
  });

  it('calculates remaining from used + limit', () => {
    const segs = parser.buildSegments({ rate_limits: { session: { used: 25, limit: 100 } } }, cfg);
    expect(segs.find(s => s.label === 'session')?.value).toBe('25% used');
  });

  it('calculates remaining from percentage field (inverted)', () => {
    const segs = parser.buildSegments({ rate_limits: { session: { percentage: 40 } } }, cfg);
    expect(segs.find(s => s.label === 'session')?.value).toBe('40% used');
  });

  it('skips segment when limit is zero', () => {
    const segs = parser.buildSegments({ rate_limits: { session: { used: 50, limit: 0 } } }, cfg);
    expect(segs.find(s => s.label === 'session')).toBeUndefined();
  });

  it('emits known keys before unknown keys', () => {
    const segs = parser.buildSegments({
      rate_limits: { custom: { remaining: 80, limit: 100 }, session: { remaining: 50, limit: 100 }, week: { remaining: 60, limit: 100 } },
    }, cfg);
    const labels = segs.filter(s => ['session', 'week', 'custom'].includes(s.label)).map(s => s.label);
    expect(labels.indexOf('session')).toBeLessThan(labels.indexOf('custom'));
    expect(labels.indexOf('week')).toBeLessThan(labels.indexOf('custom'));
  });

  it('omits rate limit segments when visibility.rateLimits is false', () => {
    const config = makeConfig({ segments: { ...cfg.segments, rateLimits: false } });
    const segs = parser.buildSegments({ rate_limits: { session: { remaining: 80, limit: 100 } } }, config);
    expect(segs.find(s => s.label === 'session')).toBeUndefined();
  });

  it('handles actual Claude Code used_percentage field in rate limits', () => {
    const segs = parser.buildSegments({ rate_limits: { five_hour: { used_percentage: 13 } } }, cfg);
    const seg = segs.find(s => s.label === 'daily');
    expect(seg?.value).toBe('13% used');
    expect(seg?.icon).toBe('⏱ ');
  });

  it('seven_day rate limit uses 📅 icon', () => {
    const segs = parser.buildSegments({ rate_limits: { seven_day: { used_percentage: 2 } } }, cfg);
    const seg = segs.find(s => s.label === 'weekly');
    expect(seg?.icon).toBe('📅 ');
    expect(seg?.value).toBe('2% used');
  });

  it('appends reset time when resets_at is set (hours+mins)', () => {
    const nowSecs = 1_000_000;
    const resets_at = nowSecs + 2 * 3600 + 15 * 60; // 2h15m from now
    // use resets_at field — formatResetTime uses Date.now() internally, so we
    // verify the pattern rather than exact value since test time varies
    const segs = parser.buildSegments({ rate_limits: { five_hour: { used_percentage: 13, resets_at } } }, cfg);
    const val = segs.find(s => s.label === 'daily')?.value ?? '';
    expect(val).toMatch(/^13% used ~/);
  });

  it('shows "soon" when resets_at is in the past or immediate', () => {
    const resets_at = Math.floor(Date.now() / 1000) - 10;
    const segs = parser.buildSegments({ rate_limits: { five_hour: { used_percentage: 13, resets_at } } }, cfg);
    expect(segs.find(s => s.label === 'daily')?.value).toBe('13% used ~soon');
  });

  it('omits reset time when resets_at is absent', () => {
    const segs = parser.buildSegments({ rate_limits: { five_hour: { used_percentage: 13 } } }, cfg);
    expect(segs.find(s => s.label === 'daily')?.value).toBe('13% used');
  });
});

// ────────────────────────────────────────────────────────
// Segment ordering
// ────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────
// buildSegments() — auth
// ────────────────────────────────────────────────────────

describe('buildSegments() — auth segment', () => {
  const authCfg = makeConfig({ segments: { ...cfg.segments, auth: true } });
  const noAuthCfg = makeConfig({ segments: { ...cfg.segments, auth: false } });

  it('shows subscription icon and "Sub" when no env vars or api field', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_BASE_URL'];
    const segs = parser.buildSegments({}, authCfg);
    const seg = segs.find(s => s.label === 'auth');
    expect(seg?.icon).toBe('✨ ');
    expect(seg?.value).toBe('Sub');
  });

  it('shows plan name when status.api.plan is set', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_BASE_URL'];
    const segs = parser.buildSegments({ api: { plan: 'pro' } }, authCfg);
    const seg = segs.find(s => s.label === 'auth');
    expect(seg?.value).toBe('Pro');
  });

  it('shows API key prefix when ANTHROPIC_API_KEY env var is set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api-123456789';
    delete process.env['ANTHROPIC_BASE_URL'];
    const segs = parser.buildSegments({}, authCfg);
    const seg = segs.find(s => s.label === 'auth');
    expect(seg?.icon).toBe('🔑 ');
    expect(seg?.value).toContain('API Key:');
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('shows hostname when ANTHROPIC_BASE_URL env var is set', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_BASE_URL'] = 'https://my-proxy.example.com/v1';
    const segs = parser.buildSegments({}, authCfg);
    const seg = segs.find(s => s.label === 'auth');
    expect(seg?.icon).toBe('🌐 ');
    expect(seg?.value).toBe('my-proxy.example.com');
    delete process.env['ANTHROPIC_BASE_URL'];
  });

  it('shows bedrock/vertex type from status.api.type', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_BASE_URL'];
    const segs = parser.buildSegments({ api: { type: 'bedrock', base_url: 'https://bedrock.aws.com' } }, authCfg);
    const seg = segs.find(s => s.label === 'auth');
    expect(seg?.icon).toBe('🌐 ');
    expect(seg?.value).toBe('bedrock.aws.com');
  });

  it('uses ANTHROPIC_SERVER_NAME instead of hostname when ANTHROPIC_BASE_URL is set', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_BASE_URL'] = 'https://my-proxy.example.com/v1';
    process.env['ANTHROPIC_SERVER_NAME'] = 'My Proxy';
    const segs = parser.buildSegments({}, authCfg);
    const seg = segs.find(s => s.label === 'auth');
    expect(seg?.icon).toBe('🌐 ');
    expect(seg?.value).toBe('My Proxy');
    delete process.env['ANTHROPIC_BASE_URL'];
    delete process.env['ANTHROPIC_SERVER_NAME'];
  });

  it('uses ANTHROPIC_SERVER_NAME instead of hostname for bedrock/vertex', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_BASE_URL'];
    process.env['ANTHROPIC_SERVER_NAME'] = 'AWS Bedrock';
    const segs = parser.buildSegments({ api: { type: 'bedrock', base_url: 'https://bedrock.aws.com' } }, authCfg);
    const seg = segs.find(s => s.label === 'auth');
    expect(seg?.icon).toBe('🌐 ');
    expect(seg?.value).toBe('AWS Bedrock');
    delete process.env['ANTHROPIC_SERVER_NAME'];
  });

  it('omits auth segment when visibility.auth is false', () => {
    const segs = parser.buildSegments({}, noAuthCfg);
    expect(segs.find(s => s.label === 'auth')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// Segment ordering
// ────────────────────────────────────────────────────────

describe('buildSegments() — ordering', () => {
  it('emits segments in order: folder, git, model, ctx, tokens, auth, rate limits', () => {
    const slugEnvKeys = [
      'CURSOR_CONVERSATION_ID',
      'CLAUDE_CODE_SESSION_ID',
      'CODEX_THREAD_ID',
      'GROK_SESSION_ID',
      'GEMINI_SESSION_ID',
      'DSH_SESSION_ID',
      'DEEPSEEK_SESSION_ID',
    ] as const;
    const saved: Record<string, string | undefined> = {};
    for (const key of slugEnvKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      const p = new FakeParser('main');
      const segs = p.buildSegments({
        cwd: '/home/user/proj',
        model: 'claude',
        context_window: { percentage: 40, tokens: 40000 },
        rate_limits: { session: { remaining: 50, limit: 100 } },
      }, cfg);
      const icons = segs.map(s => s.icon);
      expect(icons[0]).toBe('📁 ');
      expect(icons[1]).toBe('⎇ ');
      expect(icons[2]).toBe('🤖 ');
      expect(icons[3]).toBe('⏳ ');
      expect(icons[4]).toBe('🔢 ');
      expect(icons[5]).toBe('✨ ');
      expect(icons[6]).toBe('⏱ ');
    } finally {
      for (const key of slugEnvKeys) {
        const prev = saved[key];
        if (prev === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = prev;
        }
      }
    }
  });
});
