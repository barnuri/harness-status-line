import type { SessionSpendEntry, SpendLimitCache } from '../types.ts';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class SpendLedger {
  private static readonly DEFAULT_DIR = path.join(os.homedir(), '.claude', 'harness-status-line', 'spend');
  private static readonly LIMIT_FILE = 'limit.json';
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

  private writeJson(file: string, value: SessionSpendEntry): void {
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
