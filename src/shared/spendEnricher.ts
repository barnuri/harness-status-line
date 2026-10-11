import type { StatusJSON, RateLimit } from '../types.ts';
import { SpendLedger } from './spendLedger.ts';

export class SpendEnricher {
  private static readonly SPEND_LIMIT_KEY = 'spend_limit';
  private static readonly PERCENT_MAX = 100;

  private readonly ledger: SpendLedger;

  constructor(ledger?: SpendLedger) {
    this.ledger = ledger ?? new SpendLedger();
  }

  apply(status: StatusJSON, nowMs: number = Date.now()): StatusJSON {
    const cost = status.cost?.total_cost_usd;
    if (!this.isClaudePayload(status) || typeof cost !== 'number' || !status.session_id) {
      return status;
    }
    this.ledger.record(status.session_id, cost, nowMs);
    const spendLimit = this.buildSpendLimit(status.rate_limits?.[SpendEnricher.SPEND_LIMIT_KEY], nowMs);
    if (!spendLimit) {
      return status;
    }
    return { ...status, rate_limits: { ...status.rate_limits, [SpendEnricher.SPEND_LIMIT_KEY]: spendLimit } };
  }

  private buildSpendLimit(fromStdin: RateLimit | undefined, nowMs: number): RateLimit | null {
    const cache = this.ledger.readLimit();
    const limitUsd = fromStdin?.limit_usd ?? cache?.limit_usd;
    if (typeof limitUsd !== 'number' || limitUsd <= 0) {
      return fromStdin ?? null;
    }
    const month = this.ledger.monthKey(nowMs);
    const cachedApiUsd = cache?.api?.month === month ? cache.api.used_usd : undefined;
    const stdinPctUsd = typeof fromStdin?.used_percentage === 'number'
      ? (fromStdin.used_percentage / SpendEnricher.PERCENT_MAX) * limitUsd
      : undefined;
    const apiUsd = fromStdin?.used_usd ?? stdinPctUsd ?? cachedApiUsd ?? 0;
    const usedUsd = Math.max(apiUsd, this.ledger.monthTotal(nowMs));
    return {
      ...fromStdin,
      used_usd: usedUsd,
      limit_usd: limitUsd,
      used_percentage: (usedUsd / limitUsd) * SpendEnricher.PERCENT_MAX,
      resets_at: fromStdin?.resets_at ?? this.ledger.nextMonthStartSecs(nowMs),
      period: fromStdin?.period ?? 'monthly',
    };
  }

  private isClaudePayload(status: StatusJSON): boolean {
    const isCursor = typeof status.render_width_chars === 'number' || typeof status.autorun === 'boolean';
    const isCopilot = status.ai_used !== undefined || status.allow_all_enabled !== undefined || status.username !== undefined;
    return !isCursor && !isCopilot;
  }
}
