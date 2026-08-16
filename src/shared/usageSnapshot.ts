import type { UsageSnapshot } from '../types.ts';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class UsageSnapshotReader {
  private static readonly DEFAULT_FILE_PATH = path.join(os.homedir(), '.claude', 'usage-snapshot.json');
  private static readonly DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

  private readonly filePath: string;
  private readonly maxAgeMs: number;

  constructor(filePath?: string, maxAgeMs?: number) {
    this.filePath = filePath ?? UsageSnapshotReader.DEFAULT_FILE_PATH;
    this.maxAgeMs = maxAgeMs ?? UsageSnapshotReader.DEFAULT_MAX_AGE_MS;
  }

  read(nowMs: number): UsageSnapshot | null {
    const snapshot = this.parse(this.readRaw());
    if (!snapshot) {
      return null;
    }

    const capturedAtMs = this.resolveCapturedAtMs(snapshot);
    if (capturedAtMs === null) {
      return null;
    }
    if (nowMs - capturedAtMs > this.maxAgeMs) {
      return null;
    }
    return snapshot;
  }

  private readRaw(): string | null {
    try {
      return fs.readFileSync(this.filePath, 'utf8');
    } catch {
      return null;
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
    } catch {
      return null;
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
    return this.fileModifiedMs();
  }

  private fileModifiedMs(): number | null {
    try {
      return fs.statSync(this.filePath).mtimeMs;
    } catch {
      return null;
    }
  }
}
