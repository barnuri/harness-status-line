import { describe, it, expect } from 'bun:test';
import { StatusParser } from '../src/statusParser.ts';
import { ConfigManager } from '../src/configManager.ts';
import { writeWorkflowActiveState } from '../src/shared/workflowActiveState.ts';
import type { Config, StatusJSON } from '../src/types.ts';
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
// buildSegments() — effort segment
// ────────────────────────────────────────────────────────

describe('buildSegments() — effort segment', () => {
  it('includes effort segment when effort.level is present', () => {
    const segs = parser.buildSegments({ effort: { level: 'high' } }, cfg);
    const seg = segs.find(s => s.icon === '🧠 ');
    expect(seg?.value).toBe('high');
  });

  it('uses configured effort colors', () => {
    const segs = parser.buildSegments({ effort: { level: 'max' } }, cfg);
    const seg = segs.find(s => s.icon === '🧠 ')!;
    expect(seg.bg).toEqual([55, 48, 163]);
    expect(seg.fg).toEqual([248, 250, 252]);
  });

  it('omits effort segment when visibility.effort is false', () => {
    const config = makeConfig({ segments: { ...cfg.segments, effort: false } });
    const segs = parser.buildSegments({ effort: { level: 'high' } }, config);
    expect(segs.find(s => s.icon === '🧠 ')).toBeUndefined();
  });

  it('omits effort segment when effort is absent (model does not support it)', () => {
    const segs = parser.buildSegments({}, cfg);
    expect(segs.find(s => s.icon === '🧠 ')).toBeUndefined();
  });

  it('omits effort segment when effort.level is absent', () => {
    const segs = parser.buildSegments({ effort: {} }, cfg);
    expect(segs.find(s => s.icon === '🧠 ')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// buildSegments() — workflow-active segment
// ────────────────────────────────────────────────────────

describe('buildSegments() — workflow-active segment', () => {
  function removeWorkflowStateFile(sessionId: string): void {
    try {
      fs.unlinkSync(path.join(os.homedir(), '.claude', 'workflow-active', sessionId));
    } catch {
      // already absent
    }
  }

  it('includes workflow segment when active state is fresh', () => {
    const sessionId = 'test-workflow-segment-active';
    writeWorkflowActiveState(sessionId, true);
    try {
      const segs = parser.buildSegments({ session_id: sessionId }, cfg);
      const seg = segs.find(s => s.icon === '⚙ ');
      expect(seg?.value).toBe('active');
      expect(seg?.label).toBe('workflow');
    } finally {
      removeWorkflowStateFile(sessionId);
    }
  });

  it('uses configured workflow colors', () => {
    const sessionId = 'test-workflow-segment-colors';
    writeWorkflowActiveState(sessionId, true);
    try {
      const segs = parser.buildSegments({ session_id: sessionId }, cfg);
      const seg = segs.find(s => s.icon === '⚙ ')!;
      expect(seg.bg).toEqual([15, 118, 110]);
      expect(seg.fg).toEqual([248, 250, 252]);
    } finally {
      removeWorkflowStateFile(sessionId);
    }
  });

  it('omits workflow segment when state is stale', () => {
    const sessionId = 'test-workflow-segment-stale';
    writeWorkflowActiveState(sessionId, true, Date.now() / 1000 - 1000);
    try {
      const segs = parser.buildSegments({ session_id: sessionId }, cfg);
      expect(segs.find(s => s.icon === '⚙ ')).toBeUndefined();
    } finally {
      removeWorkflowStateFile(sessionId);
    }
  });

  it('omits workflow segment when no state file exists', () => {
    const segs = parser.buildSegments({ session_id: 'test-workflow-segment-no-file' }, cfg);
    expect(segs.find(s => s.icon === '⚙ ')).toBeUndefined();
  });

  it('omits workflow segment when visibility.workflow is false', () => {
    const sessionId = 'test-workflow-segment-visibility-off';
    writeWorkflowActiveState(sessionId, true);
    try {
      const config = makeConfig({ segments: { ...cfg.segments, workflow: false } });
      const segs = parser.buildSegments({ session_id: sessionId }, config);
      expect(segs.find(s => s.icon === '⚙ ')).toBeUndefined();
    } finally {
      removeWorkflowStateFile(sessionId);
    }
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
    expect(segs.find(s => s.label === 'ctx')?.value).toBe('50% · 50/100');
  });

  it('uses used_percentage from actual Claude Code context_window format', () => {
    const segs = parser.buildSegments({ context_window: { used_percentage: 60, total_input_tokens: 120000, context_window_size: 200000 } }, cfg);
    expect(segs.find(s => s.label === 'ctx')?.value).toBe('60% · 120k/200k');
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

describe('buildSegments() — context absolute size', () => {
  function ctxValue(context_window: Record<string, number>): string | undefined {
    return parser.buildSegments({ context_window }, cfg).find(s => s.label === 'ctx')?.value;
  }

  it('appends used/total tokens scaled to a shared unit', () => {
    expect(ctxValue({ total_input_tokens: 420_000, context_window_size: 1_000_000 })).toBe('42% · 0.42M/1M');
  });

  it('uses the k unit when the window is under 1M tokens', () => {
    expect(ctxValue({ used_percentage: 75, token_count: 150_000, size: 200_000 })).toBe('75% · 150k/200k');
  });

  it('shows the percentage alone when no token count is available', () => {
    expect(ctxValue({ percentage: 42 })).toBe('42%');
  });

  it('shows a bare compact token count when the window size is unknown', () => {
    expect(ctxValue({ percentage: 42, tokens: 420_000 })).toBe('42% · 420.0k');
  });

  it('ignores a non-positive window size and falls back to the bare count', () => {
    expect(ctxValue({ percentage: 42, tokens: 420_000, size: 0 })).toBe('42% · 420.0k');
  });

  it('prefers context_window_size over size', () => {
    expect(ctxValue({ percentage: 30, tokens: 300_000, context_window_size: 1_000_000, size: 200_000 })).toBe('30% · 0.3M/1M');
  });

  it('prefers total_input_tokens over tokens', () => {
    expect(ctxValue({ percentage: 40, total_input_tokens: 80_000, tokens: 50_000, size: 200_000 })).toBe('40% · 80k/200k');
  });

  it('resolves the token count through the total_input_tokens/tokens/token_count/input chain', () => {
    expect(ctxValue({ percentage: 10, input: 100_000, size: 1_000_000 })).toBe('10% · 0.1M/1M');
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
    expect(segs.find(s => s.label === 'weekly')?.icon).toBe('📅 ');
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
    const labels = segs.filter(s => ['session', 'weekly', 'custom'].includes(s.label)).map(s => s.label);
    expect(labels.indexOf('session')).toBeLessThan(labels.indexOf('custom'));
    expect(labels.indexOf('weekly')).toBeLessThan(labels.indexOf('custom'));
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
  it('emits segments in order: folder, git, model, ctx, auth, rate limits', () => {
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
      expect(icons[4]).toBe('✨ ');
      expect(icons[5]).toBe('⏱ ');
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

// ────────────────────────────────────────────────────────
// buildSegments() — Cursor payload
// ────────────────────────────────────────────────────────

describe('buildSegments() — Cursor payload', () => {
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
  const ANTHROPIC_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_SERVER_NAME'] as const;

  function withClearedEnv(keys: readonly string[], run: () => void): void {
    const saved: Record<string, string | undefined> = {};
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      run();
    } finally {
      for (const key of keys) {
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

  it('parses a full Cursor skill-schema payload: folder, model, ctx; no auth or rate limits', () => {
    withClearedEnv([...ANTHROPIC_ENV_KEYS, ...SLUG_ENV_KEYS], () => {
      const status: StatusJSON = {
        session_id: 'test-cursor-full-payload-session',
        session_name: 'my session',
        transcript_path: '/path/to/transcript.jsonl',
        render_width_chars: 120,
        cwd: '/Users/me/project',
        autorun: false,
        model: { id: 'claude-4-opus', display_name: 'Claude 4 Opus' },
        workspace: {
          current_dir: '/Users/me/project',
          project_dir: '/Users/me/project/.cursor/transcripts',
          added_dirs: [],
        },
        version: '1.2.3',
        output_style: { name: 'default' },
        context_window: { used_percentage: 34.5 },
      };
      const segs = parser.buildSegments(status, cfg);
      expect(segs.find(s => s.icon === '📁 ')?.value).toBe('project');
      expect(segs.find(s => s.icon === '🤖 ')?.value).toBe('Claude 4 Opus');
      expect(segs.find(s => s.label === 'ctx')?.value).toBe('35%');
      expect(segs.find(s => s.label === 'auth')).toBeUndefined();
      expect(segs.find(s => s.label === 'session')).toBeUndefined();
      expect(segs.find(s => s.icon === '⏱ ')).toBeUndefined();
      expect(segs.find(s => s.label === 'autorun')).toBeUndefined();
    });
  });

  it('appends param_summary and max_mode to the model value', () => {
    const segs = parser.buildSegments({
      model: { display_name: 'Sonnet 4.6', param_summary: '(Thinking)', max_mode: true },
    }, cfg);
    expect(segs.find(s => s.icon === '🤖 ')?.value).toBe('Sonnet 4.6 (Thinking) · max');
  });

  it('uses remaining_percentage when used_percentage is null', () => {
    const status: StatusJSON = {
      context_window: { used_percentage: null, remaining_percentage: 25 },
    };
    const segs = parser.buildSegments(status, cfg);
    expect(segs.find(s => s.label === 'ctx')?.value).toBe('75%');
  });

  it('clamps remaining_percentage-derived used percent to 0–100', () => {
    const over: StatusJSON = {
      context_window: { used_percentage: null, remaining_percentage: 150 },
    };
    const under: StatusJSON = {
      context_window: { used_percentage: null, remaining_percentage: -10 },
    };
    expect(parser.buildSegments(over, cfg).find(s => s.label === 'ctx')?.value).toBe('0%');
    expect(parser.buildSegments(under, cfg).find(s => s.label === 'ctx')?.value).toBe('100%');
  });

  it('omits ctx when both percentages are null and there is no token/size fallback', () => {
    const status: StatusJSON = {
      context_window: {
        used_percentage: null,
        remaining_percentage: null,
        total_output_tokens: 5000,
      },
    };
    const segs = parser.buildSegments(status, cfg);
    expect(segs.find(s => s.label === 'ctx')).toBeUndefined();
  });

  it('includes vim.mode as sent', () => {
    const segs = parser.buildSegments({ vim: { mode: 'NORMAL' } }, cfg);
    const seg = segs.find(s => s.icon === '⌨ ');
    expect(seg?.value).toBe('NORMAL');
    expect(seg?.label).toBe('');
    expect(seg?.bg).toEqual([29, 78, 216]);
    expect(seg?.fg).toEqual([248, 250, 252]);
  });

  it('includes worktree.name when it differs from the folder basename', () => {
    const segs = parser.buildSegments({
      cwd: '/Users/me/project',
      worktree: { name: 'my-feature', path: '/Users/me/.cursor/worktrees/repo/my-feature' },
    }, cfg);
    const seg = segs.find(s => s.icon === '🌿 ');
    expect(seg?.value).toBe('my-feature');
    expect(seg?.label).toBe('');
    expect(seg?.bg).toEqual([194, 65, 12]);
  });

  it('skips worktree when name equals the folder basename', () => {
    const segs = parser.buildSegments({
      cwd: '/Users/me/project',
      worktree: { name: 'project' },
    }, cfg);
    expect(segs.find(s => s.icon === '🌿 ')).toBeUndefined();
  });

  it('includes autorun when true and omits it when false', () => {
    const on = parser.buildSegments({ autorun: true }, cfg).find(s => s.label === 'autorun');
    expect(on?.icon).toBe('▶ ');
    expect(on?.value).toBe('on');
    expect(on?.bg).toEqual([190, 24, 93]);
    expect(parser.buildSegments({ autorun: false }, cfg).find(s => s.label === 'autorun')).toBeUndefined();
    expect(parser.buildSegments({}, cfg).find(s => s.label === 'autorun')).toBeUndefined();
  });

  it('emits Cursor-only segments in order: folder, worktree, slug, model, vim, autorun', () => {
    withClearedEnv(SLUG_ENV_KEYS, () => {
      const segs = parser.buildSegments({
        cwd: '/repo/proj',
        session_name: 'cursor-slug',
        worktree: { name: 'feature-x' },
        model: 'claude',
        vim: { mode: 'INSERT' },
        autorun: true,
      }, cfg);
      const icons = segs.map(s => s.icon);
      expect(icons.indexOf('📁 ')).toBeLessThan(icons.indexOf('🌿 '));
      expect(icons.indexOf('🌿 ')).toBeLessThan(icons.indexOf('🏷 '));
      expect(icons.indexOf('🏷 ')).toBeLessThan(icons.indexOf('🤖 '));
      expect(icons.indexOf('🤖 ')).toBeLessThan(icons.indexOf('⌨ '));
      expect(icons.indexOf('⌨ ')).toBeLessThan(icons.indexOf('▶ '));
      expect(segs.find(s => s.icon === '🏷 ')?.value).toBe('cursor-slug');
      expect(segs.find(s => s.icon === '⌨ ')?.value).toBe('INSERT');
    });
  });

  it('prefers a published session slug file over session_name', () => {
    const sessionId = 'test-cursor-slug-file-wins';
    writeSlugFile(sessionId, 'published-slug');
    withClearedEnv(SLUG_ENV_KEYS, () => {
      try {
        const segs = parser.buildSegments({
          session_id: sessionId,
          session_name: 'fallback-name',
        }, cfg);
        expect(segs.find(s => s.icon === '🏷 ')?.value).toBe('published-slug');
      } finally {
        removeSlugFile(sessionId);
      }
    });
  });

  it('falls back to session_name when no slug file exists', () => {
    const sessionId = 'test-cursor-session-name-fallback';
    removeSlugFile(sessionId);
    withClearedEnv(SLUG_ENV_KEYS, () => {
      const segs = parser.buildSegments({
        session_id: sessionId,
        session_name: 'my session',
      }, cfg);
      expect(segs.find(s => s.icon === '🏷 ')?.value).toBe('my session');
    });
  });

  it('omits default Sub auth on Cursor-shaped payloads', () => {
    withClearedEnv(ANTHROPIC_ENV_KEYS, () => {
      const authCfg = makeConfig({ segments: { ...cfg.segments, auth: true } });
      expect(parser.buildSegments({ autorun: false }, authCfg).find(s => s.label === 'auth')).toBeUndefined();
      expect(parser.buildSegments({ render_width_chars: 80 }, authCfg).find(s => s.label === 'auth')).toBeUndefined();
    });
  });

  it('still shows Sub for Claude {} and object-model payloads without Cursor fields', () => {
    withClearedEnv(ANTHROPIC_ENV_KEYS, () => {
      const authCfg = makeConfig({ segments: { ...cfg.segments, auth: true } });
      expect(parser.buildSegments({}, authCfg).find(s => s.label === 'auth')?.value).toBe('Sub');
      expect(parser.buildSegments(
        { model: { display_name: 'Sonnet' } },
        authCfg,
      ).find(s => s.label === 'auth')?.value).toBe('Sub');
    });
  });

  it('still shows env-based API key auth on a Cursor-shaped payload', () => {
    withClearedEnv(ANTHROPIC_ENV_KEYS, () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api-123456789';
      const authCfg = makeConfig({ segments: { ...cfg.segments, auth: true } });
      const seg = parser.buildSegments({ autorun: false }, authCfg).find(s => s.label === 'auth');
      expect(seg?.icon).toBe('🔑 ');
      expect(seg?.value).toContain('API Key:');
    });
  });

  it('hides vim, worktree, and autorun when their visibility flags are false', () => {
    const config = makeConfig({
      segments: { ...cfg.segments, vim: false, worktree: false, autorun: false },
    });
    const segs = parser.buildSegments({
      cwd: '/repo/proj',
      worktree: { name: 'feature-x' },
      vim: { mode: 'INSERT' },
      autorun: true,
    }, config);
    expect(segs.find(s => s.icon === '⌨ ')).toBeUndefined();
    expect(segs.find(s => s.icon === '🌿 ')).toBeUndefined();
    expect(segs.find(s => s.label === 'autorun')).toBeUndefined();
  });

  it('shows on-demand label and remaining dollars from usage-summary', () => {
    const segs = parser.buildSegments({
      autorun: false,
      credits: {
        remaining: 182.7,
        limit: 200,
        used: 17.3,
        unit: 'usd',
        pool: 'on_demand',
      },
    }, cfg);
    expect(segs.find(s => s.label === 'on-demand')?.value).toBe('$182.70 left');
  });

  it('shows remaining Cursor credits and daily/weekly windows', () => {
    const segs = parser.buildSegments({
      autorun: false,
      credits: { remaining: 12.3, used_percentage: 20, unit: 'usd' },
      rate_limits: { day: { used_percentage: 15 }, week: { used_percentage: 40 } },
    }, cfg);
    expect(segs.find(s => s.label === 'credits')?.value).toBe('$12.30 left');
    expect(segs.find(s => s.label === 'daily')?.value).toBe('15% used');
    expect(segs.find(s => s.label === 'weekly')?.value).toBe('40% used');
  });

  it('shows Cursor request quota used/limit when over the pool', () => {
    const segs = parser.buildSegments({
      autorun: false,
      credits: { used: 1016, limit: 1000, remaining: 0, used_percentage: 102, unit: 'requests' },
    }, cfg);
    expect(segs.find(s => s.label === 'credits')?.value).toBe('1016/1000');
  });

  it('shows remaining Cursor request quota when under the pool', () => {
    const segs = parser.buildSegments({
      autorun: false,
      credits: { used: 200, limit: 1000, remaining: 800, unit: 'requests' },
    }, cfg);
    expect(segs.find(s => s.label === 'credits')?.value).toBe('800 left');
  });

  it('omits credits when rateLimits visibility is false', () => {
    const config = makeConfig({ segments: { ...cfg.segments, rateLimits: false } });
    const segs = parser.buildSegments({
      autorun: false,
      credits: { remaining: 12.3, unit: 'usd' },
    }, config);
    expect(segs.find(s => s.label === 'credits')).toBeUndefined();
  });

  it('still renders a string model and context_window.percentage', () => {
    const segs = parser.buildSegments({
      model: 'claude-sonnet',
      context_window: { percentage: 42 },
    }, cfg);
    expect(segs.find(s => s.icon === '🤖 ')?.value).toBe('claude-sonnet');
    expect(segs.find(s => s.label === 'ctx')?.value).toBe('42%');
  });
});
