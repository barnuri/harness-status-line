export interface ContextWindow {
  readonly percentage?: number;
  readonly used_percentage?: number | null;
  readonly remaining_percentage?: number | null;
  readonly tokens?: number;
  readonly token_count?: number;
  readonly total_input_tokens?: number;
  readonly total_output_tokens?: number | null;
  readonly size?: number;
  readonly context_window_size?: number;
  readonly input?: number;
  readonly output?: number;
  readonly cache_read?: number;
  readonly cache_creation?: number;
  readonly current_usage?: unknown;
  // Copilot CLI statusLine payload: reflects the *current* context fill,
  // as opposed to used_percentage/total_input_tokens which are cumulative.
  readonly current_context_used_percentage?: number | null;
  readonly current_context_tokens?: number;
  readonly displayed_context_limit?: number;
}

export interface RateLimit {
  readonly used?: number;
  readonly limit?: number;
  readonly percentage?: number;
  readonly used_percentage?: number;
  readonly reset_at?: string;
  readonly resets_at?: number;
  readonly remaining?: number;
}

export interface RateLimits {
  readonly session?: RateLimit;
  readonly week?: RateLimit;
  readonly day?: RateLimit;
  readonly [key: string]: RateLimit | undefined;
}

export interface Workspace {
  readonly current_dir?: string;
  readonly project_dir?: string;
  readonly added_dirs?: readonly string[];
}

export interface ModelInfo {
  readonly id?: string;
  readonly display_name?: string;
  readonly name?: string;
  readonly param_summary?: string;
  readonly max_mode?: boolean;
}

export interface VimState {
  readonly mode?: string;
}

export interface Worktree {
  readonly name?: string;
  readonly path?: string;
}

export interface OutputStyle {
  readonly name?: string;
}

export interface ApiInfo {
  readonly type?: 'subscription' | 'api_key' | 'bedrock' | 'vertex';
  readonly plan?: string;
  readonly base_url?: string;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Effort {
  readonly level?: EffortLevel;
}

export type CreditUnit = 'usd' | 'requests';

export type CreditPool = 'on_demand' | 'included' | 'requests';

export interface Cost {
  readonly total_cost_usd?: number;
  readonly total_duration_ms?: number;
  readonly total_api_duration_ms?: number;
  readonly total_lines_added?: number;
  readonly total_lines_removed?: number;
  // Copilot CLI reports usage in premium requests instead of a USD cost.
  readonly total_premium_requests?: number;
}

export interface CreditBalance {
  readonly remaining?: number;
  readonly used?: number;
  readonly limit?: number;
  readonly used_percentage?: number;
  readonly unit?: CreditUnit;
  readonly pool?: CreditPool;
  readonly resets_at?: number;
}

export interface CopilotQuotaEntry {
  readonly id: string;
  readonly used?: number;
  readonly entitlement?: number;
  readonly remainingPercentage: number;
  readonly resetDate?: string;
}

export interface CopilotQuotaState {
  readonly updatedAt: number;
  readonly polledAt?: number;
  readonly source?: string;
  readonly ghUpdatedAt?: number;
  readonly assistantUsageUpdatedAt?: number;
  readonly quotas: readonly CopilotQuotaEntry[];
}

export interface StatusJSON {
  readonly cwd?: string;
  readonly model?: string | ModelInfo;
  readonly context_window?: ContextWindow;
  readonly rate_limits?: RateLimits;
  readonly workspace?: Workspace;
  readonly session_id?: string;
  readonly session_name?: string;
  readonly transcript_path?: string;
  readonly render_width_chars?: number;
  readonly autorun?: boolean;
  readonly hook_event_name?: string;
  readonly version?: string;
  readonly api?: ApiInfo;
  readonly effort?: Effort;
  readonly output_style?: OutputStyle;
  readonly vim?: VimState;
  readonly worktree?: Worktree;
  readonly credits?: CreditBalance;
  readonly cost?: Cost;
  // Copilot CLI-only fields used to detect its statusLine payload shape.
  readonly username?: string | null;
  readonly allow_all_enabled?: boolean;
  readonly ai_used?: { readonly total_nano_aiu?: number; readonly formatted?: string };
  readonly copilot_quota?: CopilotQuotaState;
}

export interface SubagentTask {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly status?: string;
  readonly description?: string;
  readonly label?: string;
  readonly startTime?: string;
  readonly model?: string;
  readonly effort?: EffortLevel | number;
  readonly contextWindowSize?: number;
  readonly tokenCount?: number;
  readonly tokenSamples?: unknown;
  readonly cwd?: string;
  readonly costUsd?: number;
}

export interface SubagentStatusLineInput {
  readonly session_id?: string;
  readonly columns?: number;
  readonly tasks?: readonly SubagentTask[];
}

export interface SubagentRowOutput {
  readonly id: string;
  readonly content: string;
}

export interface OpencodeStatusInput {
  readonly directory?: string;
  readonly model?: string;
  readonly sessionId?: string;
  readonly contextTokens?: number;
  readonly contextWindowSize?: number;
  readonly version?: string;
  readonly sessionCostUsd?: number;
}

export interface UsageSnapshot {
  readonly api?: ApiInfo | null;
  readonly rate_limits?: RateLimits;
  readonly credits?: CreditBalance;
  readonly session_id?: string;
  readonly captured_at?: string;
}

export type RgbColor = readonly [number, number, number];

export interface SegmentColorConfig {
  readonly bg: RgbColor;
  readonly fg: RgbColor;
}

export type SeparatorStyle = 'powerline' | 'spaces';

export interface SegmentVisibility {
  readonly folder: boolean;
  readonly git: boolean;
  readonly model: boolean;
  readonly context: boolean;
  readonly auth: boolean;
  readonly rateLimits: boolean;
  readonly slug: boolean;
  readonly effort: boolean;
  readonly workflow: boolean;
  readonly vim: boolean;
  readonly worktree: boolean;
  readonly autorun: boolean;
  readonly yolo: boolean;
  readonly lines: boolean;
}

export interface SegmentColorMap {
  readonly folder: SegmentColorConfig;
  readonly git: SegmentColorConfig;
  readonly model: SegmentColorConfig;
  readonly ctxHealthy: SegmentColorConfig;
  readonly ctxWarning: SegmentColorConfig;
  readonly ctxCritical: SegmentColorConfig;
  readonly authSubscription: SegmentColorConfig;
  readonly authApi: SegmentColorConfig;
  readonly rateHealthy: SegmentColorConfig;
  readonly rateWarning: SegmentColorConfig;
  readonly rateCritical: SegmentColorConfig;
  readonly slug: SegmentColorConfig;
  readonly effort: SegmentColorConfig;
  readonly workflow: SegmentColorConfig;
  readonly vim: SegmentColorConfig;
  readonly worktree: SegmentColorConfig;
  readonly autorun: SegmentColorConfig;
  readonly yolo: SegmentColorConfig;
  readonly lines: SegmentColorConfig;
}

export interface Config {
  readonly separatorStyle: SeparatorStyle;
  readonly segments: SegmentVisibility;
  readonly refreshInterval: number;
  readonly colors: SegmentColorMap;
}

export interface Segment {
  readonly icon: string;
  readonly label: string;
  readonly value: string;
  readonly fg: RgbColor;
  readonly bg: RgbColor;
}

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',

  fgBlack: '\x1b[30m',
  fgRed: '\x1b[31m',
  fgGreen: '\x1b[32m',
  fgYellow: '\x1b[33m',
  fgBlue: '\x1b[34m',
  fgMagenta: '\x1b[35m',
  fgCyan: '\x1b[36m',
  fgWhite: '\x1b[37m',
  fgBrightBlack: '\x1b[90m',
  fgBrightWhite: '\x1b[97m',

  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgBrightBlack: '\x1b[100m',
} as const;

export type AnsiCode = keyof typeof ANSI;
