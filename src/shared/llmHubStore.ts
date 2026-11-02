import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CopilotQuotaState, LlmHubAuto } from '../types.ts';
import { CopilotQuotaReader } from './copilotQuotaReader.ts';
import { isRecord } from './isRecord.ts';

interface StoredUsage {
  readonly fetchedAt: number;
  readonly state: CopilotQuotaState;
}

interface StoredDecision {
  readonly fetchedAt: number;
  readonly decision: LlmHubAuto;
}

interface StoredSelection {
  readonly fetchedAt: number;
  readonly selection: LlmHubAuto;
}

interface LlmHubStoreData {
  readonly usage: Readonly<Record<string, StoredUsage>>;
  readonly decisions: Readonly<Record<string, StoredDecision>>;
  readonly selections: Readonly<Record<string, StoredSelection>>;
  readonly failedAt?: number;
}

// One file per hub base, because the status line is a new process on every refresh.
export class LlmHubStore {
  static readonly DEFAULT_DIR = path.join(os.homedir(), '.config', 'harness-status-line', 'llm-hub');
  static readonly USAGE_FRESH_MS = 60 * 1000;
  static readonly FAILURE_BACKOFF_MS = 30 * 1000;
  // A Smart Auto selection older than this is shown as last-known and marked stale.
  static readonly SELECTION_STALE_AFTER_MS = 60 * 1000;
  // An unchanged selection is rewritten at this interval so its fetch time stays current.
  static readonly SELECTION_TOUCH_MS = 60 * 1000;
  private static readonly MAX_SESSIONS = 50;
  private static readonly EMPTY: LlmHubStoreData = { usage: {}, decisions: {}, selections: {} };

  private readonly filePath: string;
  private readonly quotaReader = new CopilotQuotaReader();

  constructor(baseUrl: string, dirPath?: string) {
    const fileName = `${baseUrl.replace(/[^A-Za-z0-9]+/g, '_')}.json`;
    this.filePath = path.join(dirPath ?? LlmHubStore.DEFAULT_DIR, fileName);
  }

  readUsage(profile: string): StoredUsage | null {
    const stored = this.read().usage[profile];
    if (!isRecord(stored) || typeof stored['fetchedAt'] !== 'number') {
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
    if (!isRecord(decision) || typeof decision['model'] !== 'string') {
      return null;
    }
    const complexity = typeof decision['complexity'] === 'string' ? decision['complexity'] : null;
    const tier = typeof decision['tier'] === 'string' && decision['tier'].length > 0 ? decision['tier'] : null;
    const effort = typeof decision['effort'] === 'string' && decision['effort'].length > 0 ? decision['effort'] : undefined;
    return { model: decision['model'], complexity, tier, mode: 'auto', effort };
  }

  writeDecision(session: string, decision: LlmHubAuto, nowMs: number): void {
    const data = this.read();
    const stored = data.decisions[session]?.decision;
    if (stored?.model === decision.model && stored.complexity === decision.complexity && stored.tier === decision.tier && stored.effort === decision.effort) {
      return;
    }
    const decisions = LlmHubStore.keepNewest(data.decisions, session, { fetchedAt: nowMs, decision });
    this.write({ ...data, decisions });
  }

  // The last Smart Auto selection of one session; `stale` is set once the stored copy is older than its limit.
  readSelection(session: string, nowMs: number): LlmHubAuto | null {
    const stored: unknown = this.read().selections[session];
    if (!isRecord(stored)) {
      return null;
    }
    const fetchedAt = stored['fetchedAt'];
    const selection: unknown = stored['selection'];
    if (typeof fetchedAt !== 'number' || !isRecord(selection) || typeof selection['model'] !== 'string') {
      return null;
    }
    const ageMs = Math.max(0, nowMs - fetchedAt);
    return {
      ...(selection as unknown as LlmHubAuto),
      ageMs,
      stale: selection['stale'] === true || ageMs > LlmHubStore.SELECTION_STALE_AFTER_MS,
    };
  }

  // Keeps the newest observation per session; a write older than the stored one is dropped.
  writeSelection(session: string, selection: LlmHubAuto, nowMs: number): void {
    const data = this.read();
    const stored = data.selections[session];
    if (stored !== undefined && stored.fetchedAt > nowMs) {
      return;
    }
    if (stored !== undefined && LlmHubStore.comparable(stored.selection) === LlmHubStore.comparable(selection)
      && nowMs - stored.fetchedAt < LlmHubStore.SELECTION_TOUCH_MS) {
      return;
    }
    const fetchedAt = nowMs - (selection.ageMs ?? 0);
    const selections = LlmHubStore.keepNewest(data.selections, session, { fetchedAt, selection: LlmHubStore.withoutAge(selection) });
    this.write({ ...data, selections });
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
      if (!isRecord(parsed) || !isRecord(parsed['usage']) || !isRecord(parsed['decisions'])) {
        return LlmHubStore.EMPTY;
      }
      // Files written before Smart Auto was stored have no selections key.
      const selections = isRecord(parsed['selections']) ? parsed['selections'] : {};
      return { ...(parsed as unknown as LlmHubStoreData), selections: selections as Record<string, StoredSelection> };
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

  private static keepNewest<T extends { readonly fetchedAt: number }>(
    entries: Readonly<Record<string, T>>,
    session: string,
    value: T,
  ): Record<string, T> {
    const kept = Object.entries(entries)
      .filter(([key]) => key !== session)
      .sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt)
      .slice(0, LlmHubStore.MAX_SESSIONS - 1);
    return Object.fromEntries([...kept, [session, value]]);
  }

  // The age is derived from the fetch time, so only the hub's stale flag is kept with the selection.
  private static withoutAge(selection: LlmHubAuto): LlmHubAuto {
    return { ...selection, ageMs: undefined };
  }

  private static comparable(selection: LlmHubAuto): string {
    return JSON.stringify(LlmHubStore.withoutAge(selection));
  }

}
