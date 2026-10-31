import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CopilotQuotaState, LlmHubAuto } from '../types.ts';
import { CopilotQuotaReader } from './copilotQuotaReader.ts';

interface StoredUsage {
  readonly fetchedAt: number;
  readonly state: CopilotQuotaState;
}

interface StoredDecision {
  readonly fetchedAt: number;
  readonly decision: LlmHubAuto;
}

interface LlmHubStoreData {
  readonly usage: Readonly<Record<string, StoredUsage>>;
  readonly decisions: Readonly<Record<string, StoredDecision>>;
  readonly failedAt?: number;
}

// One file per hub base, because the status line is a new process on every refresh.
export class LlmHubStore {
  static readonly DEFAULT_DIR = path.join(os.homedir(), '.config', 'harness-status-line', 'llm-hub');
  static readonly USAGE_FRESH_MS = 60 * 1000;
  static readonly FAILURE_BACKOFF_MS = 30 * 1000;
  private static readonly MAX_SESSIONS = 50;
  private static readonly EMPTY: LlmHubStoreData = { usage: {}, decisions: {} };

  private readonly filePath: string;
  private readonly quotaReader = new CopilotQuotaReader();

  constructor(baseUrl: string, dirPath?: string) {
    const fileName = `${baseUrl.replace(/[^A-Za-z0-9]+/g, '_')}.json`;
    this.filePath = path.join(dirPath ?? LlmHubStore.DEFAULT_DIR, fileName);
  }

  readUsage(profile: string): StoredUsage | null {
    const stored = this.read().usage[profile];
    if (!this.isRecord(stored) || typeof stored['fetchedAt'] !== 'number') {
      return null;
    }
    const state = this.quotaReader.parseState(JSON.stringify(stored['state']));
    return state ? { fetchedAt: stored['fetchedAt'], state } : null;
  }

  isUsageFresh(usage: StoredUsage, nowMs: number): boolean {
    return nowMs - usage.fetchedAt <= LlmHubStore.USAGE_FRESH_MS && usage.fetchedAt <= nowMs;
  }

  writeUsage(profile: string, state: CopilotQuotaState, nowMs: number): void {
    const data = this.read();
    this.write({ ...data, usage: { ...data.usage, [profile]: { fetchedAt: nowMs, state } } });
  }

  readDecision(session: string): LlmHubAuto | null {
    const decision: unknown = this.read().decisions[session]?.decision;
    if (!this.isRecord(decision) || typeof decision['model'] !== 'string') {
      return null;
    }
    const complexity = typeof decision['complexity'] === 'string' ? decision['complexity'] : null;
    const tier = typeof decision['tier'] === 'string' && decision['tier'].length > 0 ? decision['tier'] : null;
    return { model: decision['model'], complexity, tier };
  }

  writeDecision(session: string, decision: LlmHubAuto, nowMs: number): void {
    const data = this.read();
    const stored = data.decisions[session]?.decision;
    if (stored?.model === decision.model && stored.complexity === decision.complexity && stored.tier === decision.tier) {
      return;
    }
    const kept = Object.entries(data.decisions)
      .filter(([key]) => key !== session)
      .sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt)
      .slice(0, LlmHubStore.MAX_SESSIONS - 1);
    const decisions = Object.fromEntries([...kept, [session, { fetchedAt: nowMs, decision }]]);
    this.write({ ...data, decisions });
  }

  isBackingOff(nowMs: number): boolean {
    const failedAt = this.read().failedAt;
    return failedAt !== undefined && nowMs - failedAt < LlmHubStore.FAILURE_BACKOFF_MS && failedAt <= nowMs;
  }

  recordFailure(nowMs: number): void {
    this.write({ ...this.read(), failedAt: nowMs });
  }

  private read(): LlmHubStoreData {
    const raw = this.readRaw();
    if (raw === null) {
      return LlmHubStore.EMPTY;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!this.isRecord(parsed) || !this.isRecord(parsed['usage']) || !this.isRecord(parsed['decisions'])) {
        return LlmHubStore.EMPTY;
      }
      return parsed as unknown as LlmHubStoreData;
    } catch (err) {
      if (err instanceof Error) {
        return LlmHubStore.EMPTY;
      }
      throw err;
    }
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

  private write(data: LlmHubStoreData): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(data) + '\n', 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      if (err instanceof Error) {
        process.stderr.write(`[llm-hub] store write failed: ${err.message}\n`);
        return;
      }
      throw err;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
