import type { StatusJSON, Segment, RateLimit, Config, RgbColor, SegmentColorMap } from './types.ts';
import { formatTokenCount } from './shared/tokenFormat.ts';
import { resolveSessionSlug } from './shared/sessionSlug.ts';
import { readWorkflowActiveState } from './shared/workflowActiveState.ts';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class StatusParser {
  private static readonly MINI_BAR_BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'] as const;
  private static readonly MINI_BAR_WIDTH = 5;
  private static readonly KNOWN_RATE_LIMIT_KEYS: ReadonlyArray<string> = ['session', 'five_hour', 'week', 'seven_day', 'day'];
  private static readonly WORKFLOW_STALE_AFTER_SECONDS = 120;

  parse(raw: string): StatusJSON {
    if (!raw.trim()) {
      return {};
    }
    try {
      return JSON.parse(raw) as StatusJSON;
    } catch {
      return {};
    }
  }

  buildSegments(status: StatusJSON, config: Config): Segment[] {
    const segments: Segment[] = [];
    const { colors, segments: visibility } = config;

    if (visibility.folder) {
      const folder = this.extractFolder(status);
      if (folder) {
        segments.push({ icon: '📁 ', label: '', value: folder, fg: colors.folder.fg, bg: colors.folder.bg });
      }
    }

    if (visibility.slug) {
      const slug = this.extractSlug(status);
      if (slug) {
        segments.push({ icon: '🏷 ', label: '', value: slug, fg: colors.slug.fg, bg: colors.slug.bg });
      }
    }

    if (visibility.git) {
      const cwd = status.cwd ?? status.workspace?.current_dir;
      if (cwd) {
        const branch = this.detectGitBranch(cwd);
        if (branch && branch !== 'HEAD') {
          segments.push({ icon: '⎇ ', label: 'git', value: branch, fg: colors.git.fg, bg: colors.git.bg });
        }
      }
    }

    if (visibility.model) {
      const model = this.extractModel(status);
      if (model) {
        segments.push({ icon: '🤖 ', label: '', value: model, fg: colors.model.fg, bg: colors.model.bg });
      }
    }

    const contextPercent = this.extractContextPercent(status);

    if (visibility.context && contextPercent !== null) {
      const colorConfig = this.ctxColor(contextPercent, colors);
      segments.push({ icon: '⏳ ', label: 'ctx', value: `${contextPercent}%`, fg: colorConfig.fg, bg: colorConfig.bg });
    }

    if (visibility.tokens) {
      const tokenCount = this.extractTokenCount(status);
      if (tokenCount !== null) {
        const pctSuffix = visibility.context && contextPercent !== null ? ` ${contextPercent}%` : '';
        const value = `${formatTokenCount(tokenCount)}${pctSuffix}`;
        segments.push({ icon: '🔢 ', label: 'tokens', value, fg: colors.tokens.fg, bg: colors.tokens.bg });
      }
    }

    if (visibility.auth) {
      const authSeg = this.buildAuthSegment(status, colors);
      if (authSeg) {
        segments.push(authSeg);
      }
    }

    if (visibility.effort) {
      const effort = this.extractEffort(status);
      if (effort) {
        segments.push({ icon: '🧠 ', label: '', value: effort, fg: colors.effort.fg, bg: colors.effort.bg });
      }
    }

    if (visibility.workflow && this.extractWorkflowActive(status)) {
      segments.push({ icon: '⚙ ', label: 'workflow', value: 'active', fg: colors.workflow.fg, bg: colors.workflow.bg });
    }

    if (visibility.rateLimits) {
      segments.push(...this.extractRateLimits(status, colors));
    }

    return segments;
  }

  private buildAuthSegment(status: StatusJSON, colors: SegmentColorMap): Segment | null {
    const apiType = status.api?.type;
    const serverName = process.env['ANTHROPIC_SERVER_NAME'];

    if (apiType === 'bedrock' || apiType === 'vertex') {
      const hostname = serverName ?? (status.api?.base_url ? this.extractHostname(status.api.base_url) : apiType);
      return { icon: '🌐 ', label: 'auth', value: hostname, fg: colors.authApi.fg, bg: colors.authApi.bg };
    }

    if (apiType === 'api_key') {
      const key = process.env['ANTHROPIC_API_KEY'] ?? '';
      const display = key.length >= 8 ? `API Key: ${key.slice(0, 8)}...` : 'API Key';
      return { icon: '🔑 ', label: 'auth', value: display, fg: colors.authApi.fg, bg: colors.authApi.bg };
    }

    const baseUrl = process.env['ANTHROPIC_BASE_URL'];
    if (baseUrl) {
      const hostname = serverName ?? this.extractHostname(baseUrl);
      return { icon: '🌐 ', label: 'auth', value: hostname, fg: colors.authApi.fg, bg: colors.authApi.bg };
    }

    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (apiKey) {
      const display = apiKey.length >= 8 ? `API Key: ${apiKey.slice(0, 8)}...` : 'API Key';
      return { icon: '🔑 ', label: 'auth', value: display, fg: colors.authApi.fg, bg: colors.authApi.bg };
    }

    const plan = status.api?.plan;
    const value = plan ? (plan.charAt(0).toUpperCase() + plan.slice(1)) : 'Sub';
    return { icon: '✨ ', label: 'auth', value, fg: colors.authSubscription.fg, bg: colors.authSubscription.bg };
  }

  private extractHostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private ctxColor(percent: number, colors: SegmentColorMap): { fg: RgbColor; bg: RgbColor } {
    if (percent > 80) { return colors.ctxCritical; }
    if (percent > 60) { return colors.ctxWarning; }
    return colors.ctxHealthy;
  }

  buildMiniBar(percent: number): string {
    const clamped = Math.max(0, Math.min(100, percent));
    const totalEighths = Math.round((clamped / 100) * StatusParser.MINI_BAR_WIDTH * 8);
    const fullBlocks = Math.min(Math.floor(totalEighths / 8), StatusParser.MINI_BAR_WIDTH);
    const remainder = totalEighths % 8;
    const hasPartial = fullBlocks < StatusParser.MINI_BAR_WIDTH && remainder > 0;
    const partialChar = hasPartial ? (StatusParser.MINI_BAR_BLOCKS[remainder] ?? ' ') : '';
    const emptyCount = StatusParser.MINI_BAR_WIDTH - fullBlocks - (hasPartial ? 1 : 0);
    return '█'.repeat(fullBlocks) + partialChar + ' '.repeat(emptyCount);
  }

  protected detectGitBranch(cwd: string): string | null {
    try {
      if (!fs.statSync(cwd).isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }
    const result = Bun.spawnSync(['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0 || !result.stdout) {
      return null;
    }
    const branch = result.stdout.toString('utf-8').trim();
    if (!branch || branch === 'HEAD') {
      return null;
    }
    return branch;
  }

  private extractFolder(status: StatusJSON): string | null {
    const dir = status.cwd ?? status.workspace?.current_dir;
    if (!dir) {
      return null;
    }
    return path.basename(dir);
  }

  private extractSlug(status: StatusJSON): string | null {
    return resolveSessionSlug(this.resolveSessionId(status));
  }

  private resolveSessionId(status: StatusJSON): string | undefined {
    return status.session_id
      ?? process.env['CURSOR_CONVERSATION_ID']
      ?? process.env['CLAUDE_CODE_SESSION_ID']
      ?? process.env['CODEX_THREAD_ID']
      ?? process.env['GROK_SESSION_ID']
      ?? process.env['GEMINI_SESSION_ID']
      ?? process.env['DSH_SESSION_ID']
      ?? process.env['DEEPSEEK_SESSION_ID'];
  }

  private extractModel(status: StatusJSON): string | null {
    const raw = status.model;
    if (!raw) { return null; }
    if (typeof raw === 'string') { return raw; }
    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const val = obj['display_name'] ?? obj['name'] ?? obj['id'] ?? obj['modelId'] ?? obj['model'];
      if (typeof val === 'string') { return val; }
    }
    return null;
  }

  private extractEffort(status: StatusJSON): string | null {
    return status.effort?.level ?? null;
  }

  private extractWorkflowActive(status: StatusJSON): boolean {
    return readWorkflowActiveState(this.resolveSessionId(status), StatusParser.WORKFLOW_STALE_AFTER_SECONDS);
  }

  private extractContextPercent(status: StatusJSON): number | null {
    const ctx = status.context_window;
    if (!ctx) { return null; }
    if (typeof ctx.used_percentage === 'number') { return Math.round(ctx.used_percentage); }
    if (typeof ctx.percentage === 'number') { return Math.round(ctx.percentage); }
    const tokens = ctx.total_input_tokens ?? ctx.tokens ?? ctx.token_count ?? ctx.input;
    const size = ctx.context_window_size ?? ctx.size;
    if (typeof tokens === 'number' && typeof size === 'number' && size > 0) {
      return Math.round((tokens / size) * 100);
    }
    return null;
  }

  private extractTokenCount(status: StatusJSON): number | null {
    const ctx = status.context_window;
    if (!ctx) { return null; }
    return ctx.total_input_tokens ?? ctx.tokens ?? ctx.token_count ?? ctx.input ?? null;
  }

  private extractRateLimits(status: StatusJSON, colors: SegmentColorMap): Segment[] {
    const limits = status.rate_limits;
    if (!limits) {
      return [];
    }

    const segments: Segment[] = [];

    for (const key of StatusParser.KNOWN_RATE_LIMIT_KEYS) {
      const limit = limits[key];
      if (!limit) { continue; }
      const seg = this.buildRateLimitSegment(key, limit, colors);
      if (seg) { segments.push(seg); }
    }

    for (const key of Object.keys(limits)) {
      if (StatusParser.KNOWN_RATE_LIMIT_KEYS.includes(key)) { continue; }
      const limit = limits[key];
      if (!limit) { continue; }
      const seg = this.buildRateLimitSegment(key, limit, colors);
      if (seg) { segments.push(seg); }
    }

    return segments;
  }

  private buildRateLimitSegment(key: string, limit: RateLimit, colors: SegmentColorMap): Segment | null {
    const pct = this.calcUsedPercent(limit);
    if (pct === null) {
      return null;
    }
    const icon = (key === 'session' || key === 'five_hour') ? '⏱ ' : (key === 'week' || key === 'seven_day') ? '📅 ' : '⚡ ';
    const label = key === 'five_hour' ? 'daily' : key === 'seven_day' ? 'weekly' : key;
    const colorConfig = pct > 80 ? colors.rateCritical : pct > 50 ? colors.rateWarning : colors.rateHealthy;
    const reset = limit.resets_at ? ` ~${this.formatResetTime(limit.resets_at)}` : '';
    return { icon, label, value: `${pct}% used${reset}`, fg: colorConfig.fg, bg: colorConfig.bg };
  }

  private formatResetTime(resetsAt: number, nowSecs: number = Date.now() / 1000): string {
    const secs = Math.max(0, resetsAt - nowSecs);
    if (secs < 60) { return 'soon'; }
    const mins = Math.floor(secs / 60);
    if (mins < 60) { return `${mins}m`; }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 24) { return remMins > 0 ? `${hours}h${remMins}m` : `${hours}h`; }
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
  }

  private calcUsedPercent(limit: RateLimit): number | null {
    if (typeof limit.used_percentage === 'number') {
      return Math.round(limit.used_percentage);
    }
    if (typeof limit.percentage === 'number') {
      return Math.round(limit.percentage);
    }
    if (typeof limit.remaining === 'number' && typeof limit.limit === 'number' && limit.limit > 0) {
      return Math.round(((limit.limit - limit.remaining) / limit.limit) * 100);
    }
    if (typeof limit.used === 'number' && typeof limit.limit === 'number' && limit.limit > 0) {
      return Math.round((limit.used / limit.limit) * 100);
    }
    return null;
  }
}
