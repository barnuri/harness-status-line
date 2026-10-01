import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CopilotQuotaEntry, CopilotQuotaState } from '../types.ts';

export class CopilotQuotaReader {
  private static readonly DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  private static readonly DEFAULT_FILE_PATH = path.join(
    process.env['COPILOT_HOME'] ?? path.join(os.homedir(), '.copilot'),
    'harness-status-line-quota.json',
  );

  private readonly filePath: string;
  private readonly maxAgeMs: number;

  constructor(filePath?: string, maxAgeMs?: number) {
    this.filePath = filePath ?? CopilotQuotaReader.DEFAULT_FILE_PATH;
    this.maxAgeMs = maxAgeMs ?? CopilotQuotaReader.DEFAULT_MAX_AGE_MS;
  }

  read(nowMs: number = Date.now()): CopilotQuotaState | null {
    const raw = this.readRaw();
    if (raw === null) {
      return null;
    }

    const state = this.parse(raw);
    if (!state || nowMs - state.updatedAt > this.maxAgeMs || state.updatedAt > nowMs) {
      return null;
    }

    const quotas = state.quotas.filter((quota) =>
      quota.resetDate === undefined || Date.parse(quota.resetDate) > nowMs,
    );
    return quotas.length > 0 ? { ...state, quotas } : null;
  }

  private readRaw(): string | null {
    try {
      return fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error instanceof Error) {
        return null;
      }
      throw error;
    }
  }

  private parse(raw: string): CopilotQuotaState | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!this.isRecord(parsed) || !this.isFiniteNumber(parsed['updatedAt']) || !Array.isArray(parsed['quotas'])) {
        return null;
      }

      const quotas = parsed['quotas']
        .map((quota): CopilotQuotaEntry | null => this.parseQuota(quota))
        .filter((quota): quota is CopilotQuotaEntry => quota !== null);
      const polledAt = this.isFiniteNumber(parsed['polledAt']) ? parsed['polledAt'] : undefined;
      return quotas.length > 0
        ? { updatedAt: parsed['updatedAt'], ...(polledAt !== undefined ? { polledAt } : {}), quotas }
        : null;
    } catch (error) {
      if (error instanceof Error) {
        return null;
      }
      throw error;
    }
  }

  private parseQuota(value: unknown): CopilotQuotaEntry | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const id = value['id'];
    const remainingPercentage = value['remainingPercentage'];
    const resetDate = value['resetDate'];
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      !this.isFiniteNumber(remainingPercentage) ||
      remainingPercentage < 0 ||
      remainingPercentage > 100 ||
      (resetDate !== undefined && (typeof resetDate !== 'string' || Number.isNaN(Date.parse(resetDate))))
    ) {
      return null;
    }

    const used = this.isFiniteNumber(value['used']) ? value['used'] : undefined;
    const entitlement = this.isFiniteNumber(value['entitlement']) ? value['entitlement'] : undefined;
    return {
      id,
      remainingPercentage,
      ...(used !== undefined ? { used } : {}),
      ...(entitlement !== undefined ? { entitlement } : {}),
      ...(typeof resetDate === 'string' ? { resetDate } : {}),
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }
}
