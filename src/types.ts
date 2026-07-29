export interface ContextWindow {
  readonly percentage?: number;
  readonly used_percentage?: number;
  readonly remaining_percentage?: number;
  readonly tokens?: number;
  readonly token_count?: number;
  readonly total_input_tokens?: number;
  readonly size?: number;
  readonly context_window_size?: number;
  readonly input?: number;
  readonly output?: number;
  readonly cache_read?: number;
  readonly cache_creation?: number;
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
}

export interface ApiInfo {
  readonly type?: 'subscription' | 'api_key' | 'bedrock' | 'vertex';
  readonly plan?: string;
  readonly base_url?: string;
}

export interface StatusJSON {
  readonly cwd?: string;
  readonly model?: unknown;
  readonly context_window?: ContextWindow;
  readonly rate_limits?: RateLimits;
  readonly workspace?: Workspace;
  readonly session_id?: string;
  readonly hook_event_name?: string;
  readonly version?: string;
  readonly api?: ApiInfo;
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
  readonly tokens: boolean;
  readonly auth: boolean;
  readonly rateLimits: boolean;
  readonly slug: boolean;
}

export interface SegmentColorMap {
  readonly folder: SegmentColorConfig;
  readonly git: SegmentColorConfig;
  readonly model: SegmentColorConfig;
  readonly ctxHealthy: SegmentColorConfig;
  readonly ctxWarning: SegmentColorConfig;
  readonly ctxCritical: SegmentColorConfig;
  readonly tokens: SegmentColorConfig;
  readonly authSubscription: SegmentColorConfig;
  readonly authApi: SegmentColorConfig;
  readonly rateHealthy: SegmentColorConfig;
  readonly rateWarning: SegmentColorConfig;
  readonly rateCritical: SegmentColorConfig;
  readonly slug: SegmentColorConfig;
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
