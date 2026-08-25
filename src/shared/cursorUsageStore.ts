import type { UsageSnapshot } from '../types.ts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class CursorUsageStore {
  static readonly DEFAULT_FILE_PATH = path.join(os.homedir(), '.config', 'harness-status-line', 'cursor-usage.json');
  static readonly DEFAULT_FRESH_MS = 2 * 60 * 1000;

  private readonly filePath: string;
  private readonly freshMs: number;

  constructor(filePath?: string, freshMs?: number) {
    this.filePath = filePath ?? CursorUsageStore.DEFAULT_FILE_PATH;
    this.freshMs = freshMs ?? CursorUsageStore.DEFAULT_FRESH_MS;
  }

  read(): UsageSnapshot | null {
    const snapshot = this.parse(this.readRaw());
    return snapshot;
  }

  isFresh(nowMs: number): boolean {
    const snapshot = this.read();
    if (!snapshot) {
      return false;
    }
    const capturedAtMs = this.resolveCapturedAtMs(snapshot);
    if (capturedAtMs === null) {
      return false;
    }
    return nowMs - capturedAtMs <= this.freshMs;
  }

  write(snapshot: UsageSnapshot): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot) + '\n', 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  private readRaw(): string | null {
    try {
      return fs.readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }

  private parse(raw: string | null): UsageSnapshot | null {
    if (raw === null || !raw.trim()) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return parsed as UsageSnapshot;
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }

  private resolveCapturedAtMs(snapshot: UsageSnapshot): number | null {
    const capturedAt = snapshot.captured_at;
    if (typeof capturedAt === 'string') {
      const parsed = Date.parse(capturedAt);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    try {
      return fs.statSync(this.filePath).mtimeMs;
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }
}
