import type { SessionSpendEntry, SpendLimitCache } from '../types.ts';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class SpendLedger {
  private static readonly DEFAULT_DIR = path.join(os.homedir(), '.claude', 'harness-status-line', 'spend');
  private static readonly LIMIT_FILE = 'limit.json';
  private static readonly REFRESH_LOCK_FILE = 'refresh.lock';
  private static readonly API_FRESH_MS = 60 * 1000;
  private static readonly REFRESH_LOCK_STALE_MS = 15 * 1000;
  private static readonly SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
  private static readonly MONTH_PATTERN = /^\d{4}-\d{2}$/;

  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? SpendLedger.DEFAULT_DIR;
  }

  monthKey(nowMs: number): string {
    const date = new Date(nowMs);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  nextMonthStartSecs(nowMs: number): number {
    const date = new Date(nowMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
  }

  record(sessionId: string, costUsd: number, nowMs: number): void {
    if (!SpendLedger.SESSION_ID_PATTERN.test(sessionId) || !Number.isFinite(costUsd) || costUsd < 0) {
      return;
    }
    const month = this.monthKey(nowMs);
    const file = this.sessionFile(month, sessionId);
    const existing = this.readEntry(file);
    if (existing && existing.last_usd === costUsd) {
      return;
    }
    const next = existing
      ? this.advance(existing, costUsd, nowMs)
      : this.firstEntry(sessionId, month, costUsd, nowMs);
    this.writeJson(file, next);
  }

  monthTotal(nowMs: number): number {
    const dir = path.join(this.baseDir, this.monthKey(nowMs));
    let total = 0;
    for (const name of this.listJson(dir)) {
      const entry = this.readEntry(path.join(dir, name));
      if (entry) {
        total += this.entryValue(entry);
      }
    }
    return total;
  }

  readLimit(): SpendLimitCache | null {
    const parsed = this.readJson(path.join(this.baseDir, SpendLedger.LIMIT_FILE));
    if (!parsed) {
      return null;
    }
    return parsed as SpendLimitCache;
  }

  isApiFresh(nowMs: number): boolean {
    const api = this.readLimit()?.api;
    if (api?.month !== this.monthKey(nowMs)) {
      return false;
    }
    const capturedAt = api.captured_at;
    if (typeof capturedAt !== 'string') {
      return false;
    }
    const capturedAtMs = Date.parse(capturedAt);
    return Number.isFinite(capturedAtMs) && nowMs - capturedAtMs <= SpendLedger.API_FRESH_MS;
  }

  writeApiLimit(limitUsd: number, usedUsd: number, nowMs: number): void {
    if (!Number.isFinite(limitUsd) || limitUsd <= 0 || !Number.isFinite(usedUsd) || usedUsd < 0) {
      return;
    }
    const current = this.readLimit() ?? {};
    const next: SpendLimitCache = {
      ...current,
      limit_usd: limitUsd,
      api: {
        month: this.monthKey(nowMs),
        used_usd: usedUsd,
        captured_at: new Date(nowMs).toISOString(),
      },
    };
    this.writeJson(path.join(this.baseDir, SpendLedger.LIMIT_FILE), next);
  }

  claimApiRefresh(nowMs: number): boolean {
    if (this.isApiFresh(nowMs) || this.isRefreshAttemptFresh(nowMs)) {
      return false;
    }
    const lockFile = path.join(this.baseDir, SpendLedger.REFRESH_LOCK_FILE);
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
      const descriptor = fs.openSync(lockFile, 'wx');
      fs.writeFileSync(descriptor, String(nowMs), 'utf8');
      fs.closeSync(descriptor);
      this.writeRefreshAttempt(nowMs);
      return true;
    } catch (err: unknown) {
      if (!(err instanceof Error) || !('code' in err) || err.code !== 'EEXIST') {
        return false;
      }
    }
    if (!this.isRefreshLockStale(lockFile, nowMs)) {
      return false;
    }
    this.releaseApiRefresh();
    return this.claimApiRefresh(nowMs);
  }

  releaseApiRefresh(): void {
    try {
      fs.unlinkSync(path.join(this.baseDir, SpendLedger.REFRESH_LOCK_FILE));
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }

  private advance(existing: SessionSpendEntry, costUsd: number, nowMs: number): SessionSpendEntry {
    // A lower total means the session counter restarted; keep what it had spent so far.
    if (costUsd < existing.last_usd) {
      return {
        start_usd: 0,
        last_usd: costUsd,
        carried_usd: this.entryValue(existing),
        updated_at: new Date(nowMs).toISOString(),
      };
    }
    return { ...existing, last_usd: costUsd, updated_at: new Date(nowMs).toISOString() };
  }

  private firstEntry(sessionId: string, month: string, costUsd: number, nowMs: number): SessionSpendEntry {
    // A session that started last month counts only what it spent from this month on.
    const previous = this.readEntry(this.sessionFile(this.previousMonth(month), sessionId));
    const start = previous && previous.last_usd <= costUsd ? previous.last_usd : 0;
    return { start_usd: start, last_usd: costUsd, carried_usd: 0, updated_at: new Date(nowMs).toISOString() };
  }

  private entryValue(entry: SessionSpendEntry): number {
    return Math.max(0, entry.carried_usd + entry.last_usd - entry.start_usd);
  }

  private previousMonth(month: string): string {
    if (!SpendLedger.MONTH_PATTERN.test(month)) {
      return month;
    }
    const [year, mon] = month.split('-').map(Number) as [number, number];
    return this.monthKey(Date.UTC(year, mon - 2, 1));
  }

  private isRefreshLockStale(lockFile: string, nowMs: number): boolean {
    try {
      const startedAtMs = Number(fs.readFileSync(lockFile, 'utf8'));
      return !Number.isFinite(startedAtMs) || nowMs - startedAtMs > SpendLedger.REFRESH_LOCK_STALE_MS;
    } catch (err: unknown) {
      if (err instanceof Error) {
        return true;
      }
      throw err;
    }
  }

  private isRefreshAttemptFresh(nowMs: number): boolean {
    const attemptedAt = this.readLimit()?.refresh_attempted_at;
    if (typeof attemptedAt !== 'string') {
      return false;
    }
    const attemptedAtMs = Date.parse(attemptedAt);
    return Number.isFinite(attemptedAtMs) && nowMs - attemptedAtMs <= SpendLedger.API_FRESH_MS;
  }

  private writeRefreshAttempt(nowMs: number): void {
    const current = this.readLimit() ?? {};
    const next: SpendLimitCache = { ...current, refresh_attempted_at: new Date(nowMs).toISOString() };
    this.writeJson(path.join(this.baseDir, SpendLedger.LIMIT_FILE), next);
  }

  private sessionFile(month: string, sessionId: string): string {
    return path.join(this.baseDir, month, `${sessionId}.json`);
  }

  private readEntry(file: string): SessionSpendEntry | null {
    const parsed = this.readJson(file);
    if (!parsed) {
      return null;
    }
    const { start_usd, last_usd, carried_usd } = parsed as Partial<SessionSpendEntry>;
    if (typeof start_usd !== 'number' || typeof last_usd !== 'number') {
      return null;
    }
    return {
      start_usd,
      last_usd,
      carried_usd: typeof carried_usd === 'number' ? carried_usd : 0,
      updated_at: String((parsed as { updated_at?: unknown }).updated_at ?? ''),
    };
  }

  private readJson(file: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private listJson(dir: string): string[] {
    try {
      return fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    } catch {
      return [];
    }
  }

  private writeJson(file: string, value: object): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
      fs.renameSync(tmp, file);
    } catch {
      // Best effort: the status line must never fail on a ledger write.
    }
  }
}
