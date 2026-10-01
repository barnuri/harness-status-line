import type { StatusJSON, Segment, RateLimit, Config, RgbColor, SegmentColorMap, CreditBalance, CopilotQuotaState, CopilotQuotaEntry } from './types.ts';
import { formatTokenCount, formatTokenLimit, formatTokenPair } from './shared/tokenFormat.ts';
import { resolveSessionSlug } from './shared/sessionSlug.ts';
import { readWorkflowActiveState } from './shared/workflowActiveState.ts';
import { CursorAutoModelReader } from './shared/cursorAutoModelReader.ts';
import { CopilotEffortReader } from './shared/copilotEffortReader.ts';
import * as path from 'path';
import * as fs from 'fs';

export class StatusParser {
  private static readonly MINI_BAR_BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'] as const;
  private static readonly MINI_BAR_WIDTH = 5;
  private static readonly KNOWN_RATE_LIMIT_KEYS: ReadonlyArray<string> = ['session', 'five_hour', 'week', 'seven_day', 'day'];
  private static readonly WORKFLOW_STALE_AFTER_SECONDS = 120;
  private static readonly CTX_VALUE_SEPARATOR = '·';
  private static readonly CONTEXT_SIZE_IN_NAME = /\b\d+(?:\.\d+)?\s*[kKmM]\b/;
  private static readonly MAX_MODE_SUFFIX = ' · max';
  private static readonly AUTO_MODEL_NAMES: ReadonlyArray<string> = ['auto', 'default'];
  private static readonly AUTORUN_LABEL = 'autorun';
  private static readonly AUTORUN_VALUE = 'on';
  private static readonly YOLO_LABEL = 'yolo';
  private static readonly YOLO_VALUE = 'on';
  private static readonly CTX_PERCENT_MIN = 0;
  private static readonly CTX_PERCENT_MAX = 100;
  private static readonly CREDITS_LABEL = 'credits';
  private static readonly ON_DEMAND_LABEL = 'on-demand';
  private static readonly INCLUDED_LABEL = 'included';
  private static readonly CREDITS_ICON = '💳 ';
  private static readonly DOLLAR_DECIMALS = 2;
  private static readonly SESSION_COST_LABEL = 'cost';
  private static readonly SESSION_COST_ICON = '💵 ';
  private static readonly LINES_LABEL = 'lines';
  private static readonly LINES_ICON = '✏ ';
  private static readonly NANO_PER_AI_CREDIT = 1_000_000_000;
  private static readonly USD_PER_AI_CREDIT = 0.01;

  private readonly autoModelReader: CursorAutoModelReader;
  private readonly copilotEffortReader: CopilotEffortReader;

  constructor(autoModelReader?: CursorAutoModelReader, copilotEffortReader?: CopilotEffortReader) {
    this.autoModelReader = autoModelReader ?? new CursorAutoModelReader();
    this.copilotEffortReader = copilotEffortReader ?? new CopilotEffortReader();
  }

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

    if (visibility.worktree) {
      const worktree = this.extractWorktree(status);
      if (worktree) {
        segments.push({ icon: '🌿 ', label: '', value: worktree, fg: colors.worktree.fg, bg: colors.worktree.bg });
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

    const effort = visibility.effort ? this.extractEffort(status) : null;

    if (visibility.model) {
      const model = this.extractModel(status, effort);
      if (model) {
        segments.push({ icon: '🤖 ', label: '', value: model, fg: colors.model.fg, bg: colors.model.bg });
      }
    }

    if (effort) {
      segments.push({ icon: '🧠 ', label: '', value: effort, fg: colors.effort.fg, bg: colors.effort.bg });
    }

    if (visibility.vim) {
      const vimMode = this.extractVimMode(status);
      if (vimMode) {
        segments.push({ icon: '⌨ ', label: '', value: vimMode, fg: colors.vim.fg, bg: colors.vim.bg });
      }
    }

    const contextPercent = this.extractContextPercent(status);

    if (visibility.context && contextPercent !== null) {
      const colorConfig = this.ctxColor(contextPercent, colors);
      const value = this.formatContextValue(status, contextPercent);
      segments.push({ icon: '⏳ ', label: 'ctx', value, fg: colorConfig.fg, bg: colorConfig.bg });
    }

    if (visibility.auth) {
      const authSeg = this.buildAuthSegment(status, colors);
      if (authSeg) {
        segments.push(authSeg);
      }
    }

    if (visibility.workflow && this.extractWorkflowActive(status)) {
      segments.push({ icon: '⚙ ', label: 'workflow', value: 'active', fg: colors.workflow.fg, bg: colors.workflow.bg });
    }

    if (visibility.autorun && status.autorun === true) {
      segments.push({
        icon: '▶ ',
        label: StatusParser.AUTORUN_LABEL,
        value: StatusParser.AUTORUN_VALUE,
        fg: colors.autorun.fg,
        bg: colors.autorun.bg,
      });
    }

    if (visibility.yolo && status.allow_all_enabled === true) {
      segments.push({
        icon: '🔥 ',
        label: StatusParser.YOLO_LABEL,
        value: StatusParser.YOLO_VALUE,
        fg: colors.yolo.fg,
        bg: colors.yolo.bg,
      });
    }

    if (visibility.lines) {
      const lines = this.buildLinesSegment(status, colors);
      if (lines) {
        segments.push(lines);
      }
    }

    if (visibility.rateLimits) {
      const copilotQuota = this.buildCopilotQuotaSegment(status.copilot_quota, colors);
      if (copilotQuota) {
        segments.push(copilotQuota);
      }
      const credits = this.buildCreditsSegment(status, colors);
      if (credits) {
        segments.push(credits);
      }
      const rateLimits = this.extractRateLimits(status, colors);
      segments.push(...rateLimits);

      if (!credits && rateLimits.length === 0) {
        const sessionCost = this.buildSessionCostSegment(status, colors);
        if (sessionCost) {
          segments.push(sessionCost);
        }
      }
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

    if (this.isCursorPayload(status) && !status.api) {
      return null;
    }

    if (this.isCopilotCliPayload(status) && !status.api) {
      return null;
    }

    const plan = status.api?.plan;
    const value = plan ? (plan.charAt(0).toUpperCase() + plan.slice(1)) : 'Sub';
    return { icon: '✨ ', label: 'auth', value, fg: colors.authSubscription.fg, bg: colors.authSubscription.bg };
  }

  private isCursorPayload(status: StatusJSON): boolean {
    return typeof status.render_width_chars === 'number' || typeof status.autorun === 'boolean';
  }

  private isCopilotCliPayload(status: StatusJSON): boolean {
    return status.ai_used !== undefined || status.allow_all_enabled !== undefined || status.username !== undefined;
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
    const sessionName = typeof status.session_name === 'string' && status.session_name.length > 0
      ? status.session_name
      : null;
    return resolveSessionSlug(this.resolveSessionId(status)) ?? sessionName;
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

  private extractModel(status: StatusJSON, shownEffort: string | null): string | null {
    const raw = status.model;
    if (!raw) { return null; }
    if (typeof raw === 'string') { return this.withResolvedAutoModel(raw, status); }
    const name = raw.display_name ?? raw.name ?? raw.id;
    if (typeof name !== 'string' || name.length === 0) { return null; }
    let value = this.withResolvedAutoModel(name, status);
    const summary = raw.param_summary;
    if (typeof summary === 'string' && summary.length > 0) {
      value = `${value} ${summary}`;
    }
    if (raw.max_mode === true) {
      value = `${value}${StatusParser.MAX_MODE_SUFFIX}`;
    }
    return this.withCopilotContextSize(value, status, shownEffort);
  }

  // Copilot's display_name embeds the effort (e.g. "claude-opus-5.5 · medium"); drop it when the 🧠 segment shows it.
  private withCopilotContextSize(rawName: string, status: StatusJSON, shownEffort: string | null): string {
    if (!this.isCopilotCliPayload(status)) { return rawName; }
    const effortSuffix = shownEffort === null ? null : ` ${StatusParser.CTX_VALUE_SEPARATOR} ${shownEffort}`;
    const name = effortSuffix !== null && rawName.endsWith(effortSuffix) ? rawName.slice(0, -effortSuffix.length) : rawName;
    const size = this.extractContextWindowSize(status);
    if (size === null || StatusParser.CONTEXT_SIZE_IN_NAME.test(name)) { return name; }
    return `${name} (${formatTokenLimit(size)})`;
  }

  private withResolvedAutoModel(name: string, status: StatusJSON): string {
    if (!StatusParser.AUTO_MODEL_NAMES.includes(name.trim().toLowerCase())) { return name; }
    const label = this.autoModelReader.readResolvedLabel(this.resolveSessionId(status));
    if (label === null) { return name; }
    return `${name} (${label})`;
  }

  private extractWorktree(status: StatusJSON): string | null {
    const name = status.worktree?.name;
    if (!name) { return null; }
    const folder = this.extractFolder(status);
    if (folder !== null && name === folder) { return null; }
    return name;
  }

  private extractVimMode(status: StatusJSON): string | null {
    const mode = status.vim?.mode;
    if (!mode) { return null; }
    return mode;
  }

  private extractEffort(status: StatusJSON): string | null {
    if (status.effort?.level) { return status.effort.level; }
    if (!this.isCopilotCliPayload(status)) { return null; }
    return this.copilotEffortReader.readEffort(status.session_id);
  }

  private extractWorkflowActive(status: StatusJSON): boolean {
    return readWorkflowActiveState(this.resolveSessionId(status), StatusParser.WORKFLOW_STALE_AFTER_SECONDS);
  }

  private extractContextPercent(status: StatusJSON): number | null {
    const ctx = status.context_window;
    if (!ctx) { return null; }
    const isCopilotCli = this.isCopilotCliPayload(status);
    if (isCopilotCli) {
      const currentPercent = this.normalizeCopilotContextPercent(ctx.current_context_used_percentage);
      if (currentPercent !== null) { return Math.round(currentPercent); }
    }
    const currentSize = this.extractContextWindowSize(status);
    if (!isCopilotCli
      && typeof ctx.current_context_tokens === 'number' && Number.isFinite(ctx.current_context_tokens)
      && ctx.current_context_tokens >= 0 && currentSize !== null) {
      return Math.round((ctx.current_context_tokens / currentSize) * 100);
    }
    if (typeof ctx.current_context_used_percentage === 'number'
      && Number.isFinite(ctx.current_context_used_percentage)
      && ctx.current_context_used_percentage >= StatusParser.CTX_PERCENT_MIN
      && ctx.current_context_used_percentage <= StatusParser.CTX_PERCENT_MAX) {
      return Math.round(ctx.current_context_used_percentage);
    }
    if (typeof ctx.used_percentage === 'number') { return Math.round(ctx.used_percentage); }
    if (typeof ctx.percentage === 'number') { return Math.round(ctx.percentage); }
    if (typeof ctx.remaining_percentage === 'number') {
      const used = Math.round(StatusParser.CTX_PERCENT_MAX - ctx.remaining_percentage);
      return Math.max(StatusParser.CTX_PERCENT_MIN, Math.min(StatusParser.CTX_PERCENT_MAX, used));
    }
    const tokens = ctx.total_input_tokens ?? ctx.tokens ?? ctx.token_count ?? ctx.input;
    const size = ctx.context_window_size ?? ctx.size;
    if (typeof tokens === 'number' && typeof size === 'number' && size > 0) {
      return Math.round((tokens / size) * 100);
    }
    return null;
  }

  private normalizeCopilotContextPercent(percent: number | null | undefined): number | null {
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < StatusParser.CTX_PERCENT_MIN) {
      return null;
    }
    const normalized = percent > StatusParser.CTX_PERCENT_MAX ? percent / 10 : percent;
    if (normalized > StatusParser.CTX_PERCENT_MAX) { return null; }
    return normalized;
  }

  private formatContextValue(status: StatusJSON, percent: number): string {
    if (this.isCopilotCliPayload(status)) { return this.formatCopilotContextValue(status, percent); }
    const tokens = this.extractTokenCount(status);
    if (typeof tokens !== 'number' || !Number.isFinite(tokens)) { return `${percent}%`; }
    const size = this.extractContextWindowSize(status);
    const absolute = size === null ? formatTokenCount(tokens) : formatTokenPair(tokens, size);
    return `${percent}% ${StatusParser.CTX_VALUE_SEPARATOR} ${absolute}`;
  }

  // Copilot's current_context_tokens is cumulative, so derive live usage from the live percentage.
  private formatCopilotContextValue(status: StatusJSON, percent: number): string {
    const livePercent = this.normalizeCopilotContextPercent(status.context_window?.current_context_used_percentage);
    const size = this.extractContextWindowSize(status);
    if (livePercent === null || size === null) { return `${percent}%`; }
    const used = Math.round((livePercent / StatusParser.CTX_PERCENT_MAX) * size);
    return `${percent}% ${StatusParser.CTX_VALUE_SEPARATOR} ${formatTokenPair(used, size)}`;
  }

  private extractContextWindowSize(status: StatusJSON): number | null {
    const ctx = status.context_window;
    if (!ctx) { return null; }
    const size = ctx.displayed_context_limit ?? ctx.context_window_size ?? ctx.size;
    if (typeof size !== 'number' || size <= 0) { return null; }
    return size;
  }

  private extractTokenCount(status: StatusJSON): number | null {
    const ctx = status.context_window;
    if (!ctx) { return null; }
    return ctx.current_context_tokens ?? ctx.total_input_tokens ?? ctx.tokens ?? ctx.token_count ?? ctx.input ?? null;
  }

  private buildCreditsSegment(status: StatusJSON, colors: SegmentColorMap): Segment | null {
    const credits = status.credits;
    if (!credits) {
      return null;
    }
    const value = this.formatCredits(credits);
    if (!value) {
      return null;
    }
    const pct = this.creditUsedPercent(credits);
    const colorConfig = pct === null
      ? colors.rateHealthy
      : pct > 80
        ? colors.rateCritical
        : pct > 50
          ? colors.rateWarning
          : colors.rateHealthy;
    const reset = credits.resets_at ? ` ~${this.formatResetTime(credits.resets_at)}` : '';
    return {
      icon: StatusParser.CREDITS_ICON,
      label: this.creditsLabel(credits),
      value: `${value}${reset}`,
      fg: colorConfig.fg,
      bg: colorConfig.bg,
    };
  }

  private buildCopilotQuotaSegment(quota: CopilotQuotaState | undefined, colors: SegmentColorMap): Segment | null {
    const entry = quota?.quotas
      .filter((item) => item.remainingPercentage >= 0 && item.remainingPercentage <= 100)
      .sort((left, right) => left.remainingPercentage - right.remainingPercentage)[0];
    if (!entry) {
      return null;
    }

    const used = Math.round((StatusParser.CTX_PERCENT_MAX - entry.remainingPercentage) * 10) / 10;
    const colorConfig = used > 80
      ? colors.rateCritical
      : used > 50
        ? colors.rateWarning
        : colors.rateHealthy;
    const reset = entry.resetDate ? this.formatCopilotQuotaReset(entry) : null;
    return {
      icon: StatusParser.CREDITS_ICON,
      label: 'quota',
      value: `${used}% used${reset ? ` · reset ${reset}` : ''}`,
      fg: colorConfig.fg,
      bg: colorConfig.bg,
    };
  }

  private formatCopilotQuotaReset(entry: CopilotQuotaEntry): string | null {
    if (!entry.resetDate) {
      return null;
    }
    const resetMs = Date.parse(entry.resetDate);
    if (Number.isNaN(resetMs)) {
      return null;
    }
    return `in ${this.formatResetTime(resetMs / 1000)}`;
  }

  private creditsLabel(credits: CreditBalance): string {
    if (credits.pool === 'on_demand') {
      return StatusParser.ON_DEMAND_LABEL;
    }
    if (credits.pool === 'included' || credits.pool === 'requests') {
      return StatusParser.INCLUDED_LABEL;
    }
    return StatusParser.CREDITS_LABEL;
  }

  private formatCredits(credits: CreditBalance): string | null {
    if (typeof credits.used === 'number' && typeof credits.limit === 'number') {
      return credits.unit === 'requests'
        ? `${Math.round(credits.used)}/${Math.round(credits.limit)}`
        : `$${credits.used.toFixed(StatusParser.DOLLAR_DECIMALS)}/$${credits.limit.toFixed(StatusParser.DOLLAR_DECIMALS)}`;
    }
    if (typeof credits.remaining === 'number') {
      return credits.unit === 'requests'
        ? `${Math.round(credits.remaining)} left`
        : `$${credits.remaining.toFixed(StatusParser.DOLLAR_DECIMALS)} left`;
    }
    if (typeof credits.used_percentage === 'number') {
      return `${Math.round(credits.used_percentage)}% used`;
    }
    return null;
  }

  private buildSessionCostSegment(status: StatusJSON, colors: SegmentColorMap): Segment | null {
    const totalUsd = status.cost?.total_cost_usd ?? this.aiUsedUsd(status);
    if (typeof totalUsd === 'number' && Number.isFinite(totalUsd)) {
      return {
        icon: StatusParser.SESSION_COST_ICON,
        label: StatusParser.SESSION_COST_LABEL,
        value: `$${totalUsd.toFixed(StatusParser.DOLLAR_DECIMALS)} session`,
        fg: colors.rateHealthy.fg,
        bg: colors.rateHealthy.bg,
      };
    }

    return null;
  }

  private aiUsedUsd(status: StatusJSON): number | null {
    const nano = status.ai_used?.total_nano_aiu;
    if (typeof nano === 'number' && Number.isFinite(nano)) {
      return (nano / StatusParser.NANO_PER_AI_CREDIT) * StatusParser.USD_PER_AI_CREDIT;
    }
    const credits = Number.parseFloat(status.ai_used?.formatted ?? '');
    return Number.isFinite(credits) ? credits * StatusParser.USD_PER_AI_CREDIT : null;
  }

  private buildLinesSegment(status: StatusJSON, colors: SegmentColorMap): Segment | null {
    if (!this.isCopilotCliPayload(status)) {
      return null;
    }
    const added = status.cost?.total_lines_added;
    const removed = status.cost?.total_lines_removed;
    if (typeof added !== 'number' || typeof removed !== 'number') {
      return null;
    }
    if (added === 0 && removed === 0) {
      return null;
    }
    return {
      icon: StatusParser.LINES_ICON,
      label: StatusParser.LINES_LABEL,
      value: `+${added}/-${removed}`,
      fg: colors.lines.fg,
      bg: colors.lines.bg,
    };
  }

  private creditUsedPercent(credits: CreditBalance): number | null {
    if (typeof credits.used_percentage === 'number') {
      return Math.round(credits.used_percentage);
    }
    if (typeof credits.used === 'number' && typeof credits.limit === 'number' && credits.limit > 0) {
      return Math.round((credits.used / credits.limit) * StatusParser.CTX_PERCENT_MAX);
    }
    if (typeof credits.remaining === 'number' && typeof credits.limit === 'number' && credits.limit > 0) {
      return Math.round(((credits.limit - credits.remaining) / credits.limit) * StatusParser.CTX_PERCENT_MAX);
    }
    return null;
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
    const icon = (key === 'session' || key === 'five_hour' || key === 'day') ? '⏱ ' : (key === 'week' || key === 'seven_day') ? '📅 ' : '⚡ ';
    const label = key === 'five_hour' || key === 'day' ? 'daily' : key === 'week' || key === 'seven_day' ? 'weekly' : key;
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
