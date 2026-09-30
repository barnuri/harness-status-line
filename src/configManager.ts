import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Config, RgbColor } from './types.ts';

export class ConfigManager {
  static readonly CONFIG_DIR = path.join(os.homedir(), '.config', 'harness-status-line');
  static readonly CONFIG_FILE = path.join(ConfigManager.CONFIG_DIR, 'config.json');

  static readonly DEFAULT_CONFIG: Config = {
    separatorStyle: 'spaces',
    refreshInterval: 2000,
    segments: {
      folder: true,
      git: true,
      model: true,
      context: true,
      auth: true,
      rateLimits: true,
      slug: true,
      effort: true,
      workflow: true,
      vim: true,
      worktree: true,
      autorun: true,
      yolo: true,
    },
    colors: {
      folder:           { bg: [30, 41, 59],   fg: [248, 250, 252] },
      git:              { bg: [47, 58, 97],   fg: [248, 250, 252] },
      model:            { bg: [51, 65, 85],   fg: [248, 250, 252] },
      ctxHealthy:       { bg: [21, 128, 61],  fg: [248, 250, 252] },
      ctxWarning:       { bg: [180, 83, 9],   fg: [15, 23, 42]    },
      ctxCritical:      { bg: [185, 28, 28],  fg: [248, 250, 252] },
      authSubscription: { bg: [30, 70, 30],   fg: [248, 250, 252] },
      authApi:          { bg: [70, 30, 70],   fg: [248, 250, 252] },
      rateHealthy:      { bg: [21, 94, 117],  fg: [248, 250, 252] },
      rateWarning:      { bg: [180, 83, 9],   fg: [15, 23, 42]    },
      rateCritical:     { bg: [185, 28, 28],  fg: [248, 250, 252] },
      slug:             { bg: [88, 28, 135],  fg: [248, 250, 252] },
      effort:           { bg: [55, 48, 163],  fg: [248, 250, 252] },
      workflow:         { bg: [15, 118, 110], fg: [248, 250, 252] },
      vim:              { bg: [29, 78, 216],  fg: [248, 250, 252] },
      worktree:         { bg: [194, 65, 12],  fg: [248, 250, 252] },
      autorun:          { bg: [190, 24, 93],  fg: [248, 250, 252] },
      yolo:             { bg: [185, 28, 28],  fg: [248, 250, 252] },
    },
  };

  load(): Config {
    const raw = this.loadRaw();
    return this.mergeWithDefaults(raw);
  }

  save(config: Config): void {
    fs.mkdirSync(ConfigManager.CONFIG_DIR, { recursive: true });
    fs.writeFileSync(ConfigManager.CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }

  set(key: string, rawValue: string): Config {
    const raw = this.loadRaw();
    const parts = key.split('.');
    this.deepSet(raw as Record<string, unknown>, parts, this.coerceValue(rawValue));
    const merged = this.mergeWithDefaults(raw);
    this.save(merged);
    return merged;
  }

  reset(): Config {
    this.save(ConfigManager.DEFAULT_CONFIG);
    return ConfigManager.DEFAULT_CONFIG;
  }

  private loadRaw(): Record<string, unknown> {
    if (!fs.existsSync(ConfigManager.CONFIG_FILE)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(ConfigManager.CONFIG_FILE, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (_err) {
      return {};
    }
  }

  private mergeWithDefaults(raw: Record<string, unknown>): Config {
    const defaults = JSON.parse(JSON.stringify(ConfigManager.DEFAULT_CONFIG)) as Record<string, unknown>;
    return this.mergeDeep(defaults, raw) as unknown as Config;
  }

  private mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...target };
    for (const key of Object.keys(source)) {
      const srcVal = source[key];
      const tgtVal = result[key];
      const srcIsPlainObject = srcVal !== null && typeof srcVal === 'object' && !Array.isArray(srcVal);
      const tgtIsPlainObject = tgtVal !== null && typeof tgtVal === 'object' && !Array.isArray(tgtVal);
      if (srcIsPlainObject && tgtIsPlainObject) {
        result[key] = this.mergeDeep(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
      } else {
        result[key] = srcVal;
      }
    }
    return result;
  }

  private deepSet(obj: Record<string, unknown>, parts: string[], value: unknown): void {
    if (parts.length === 0) {
      return;
    }
    const [head, ...tail] = parts;
    if (!head) {
      return;
    }
    if (tail.length === 0) {
      obj[head] = value;
      return;
    }
    if (Array.isArray(obj[head])) {
      return;
    }
    if (typeof obj[head] !== 'object' || obj[head] === null) {
      obj[head] = {};
    }
    this.deepSet(obj[head] as Record<string, unknown>, tail, value);
  }

  private coerceValue(value: string): unknown {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^\d+,\d+,\d+$/.test(value)) {
      return value.split(',').map(Number) as RgbColor;
    }
    return value;
  }
}
