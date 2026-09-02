import type { CreditBalance, RateLimit, RateLimits, UsageSnapshot } from '../types.ts';

export class CursorUsageMapper {
  private static readonly CENTS_PER_DOLLAR = 100;
  private static readonly PERCENT_MAX = 100;

  map(raw: unknown, capturedAt: string): UsageSnapshot | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return null;
    }
    const body = raw as Record<string, unknown>;
    const credits = this.mapCredits(body) ?? this.fromUsageSummary(body);
    const rateLimits = this.mapRateLimits(body);
    if (!credits && !rateLimits) {
      return null;
    }
    return {
      ...(credits ? { credits } : {}),
      ...(rateLimits ? { rate_limits: rateLimits } : {}),
      captured_at: capturedAt,
    };
  }

  merge(primary: UsageSnapshot | null, fallback: UsageSnapshot | null, capturedAt: string): UsageSnapshot | null {
    if (!primary && !fallback) {
      return null;
    }
    return {
      ...(fallback?.credits ? { credits: fallback.credits } : {}),
      ...(fallback?.rate_limits ? { rate_limits: fallback.rate_limits } : {}),
      ...(primary?.credits ? { credits: primary.credits } : {}),
      ...(primary?.rate_limits ? { rate_limits: { ...fallback?.rate_limits, ...primary.rate_limits } } : {}),
      captured_at: capturedAt,
    };
  }

  private fromUsageSummary(body: Record<string, unknown>): CreditBalance | null {
    const individual = this.asRecord(body['individualUsage']);
    if (!individual) {
      return null;
    }
    const plan = this.fromUsageSummaryPlan(this.asRecord(individual['plan']), body['billingCycleEnd']);
    if (plan && !this.isExhausted(plan)) {
      return plan;
    }
    const onDemand = this.fromUsageSummaryOnDemand(this.asRecord(individual['onDemand']));
    return onDemand ?? plan;
  }

  private isExhausted(credits: CreditBalance): boolean {
    if (typeof credits.used_percentage === 'number') {
      return credits.used_percentage >= CursorUsageMapper.PERCENT_MAX;
    }
    if (typeof credits.remaining === 'number') {
      return credits.remaining <= 0;
    }
    return false;
  }

  private fromUsageSummaryOnDemand(pool: Record<string, unknown> | null): CreditBalance | null {
    if (!pool || pool['enabled'] !== true) {
      return null;
    }
    const usedCents = this.asNumber(pool['used']);
    const limitCents = this.asNumber(pool['limit']);
    const remainingCents = this.asNumber(pool['remaining']);
    const credits = this.creditsFromCents(usedCents, limitCents, remainingCents, null);
    if (!credits) {
      return null;
    }
    return { ...credits, pool: 'on_demand' };
  }

  private fromUsageSummaryPlan(
    plan: Record<string, unknown> | null,
    billingCycleEnd: unknown,
  ): CreditBalance | null {
    if (!plan || plan['enabled'] !== true) {
      return null;
    }
    const percent = this.asNumber(plan['totalPercentUsed'])
      ?? this.asNumber(plan['apiPercentUsed'])
      ?? this.asNumber(plan['autoPercentUsed']);
    const breakdown = this.asRecord(plan['breakdown']);
    const bonusCents = breakdown ? this.asNumber(breakdown['bonus']) : null;
    const totalCents = breakdown ? this.asNumber(breakdown['total']) : null;
    const usedCents = this.asNumber(plan['used']);
    const limitCents = this.asNumber(plan['limit']);
    const remainingCents = this.asNumber(plan['remaining']);
    if (limitCents !== null && limitCents > 0) {
      const credits = this.creditsFromCents(usedCents, limitCents, remainingCents, percent);
      if (credits) {
        return { ...credits, pool: 'included' };
      }
    }
    if (percent !== null) {
      const resetsAt = this.billingCycleEndUnix(billingCycleEnd);
      const usedFromBreakdown = totalCents !== null
        ? Math.round((totalCents * percent) / CursorUsageMapper.PERCENT_MAX)
        : null;
      return {
        unit: 'usd',
        used_percentage: Math.round(percent),
        pool: 'included',
        ...(bonusCents !== null ? { limit: this.centsToDollars(bonusCents) } : {}),
        ...(usedFromBreakdown !== null ? { used: this.centsToDollars(usedFromBreakdown) } : {}),
        ...(bonusCents !== null && usedFromBreakdown !== null
          ? { remaining: this.centsToDollars(Math.max(0, bonusCents - usedFromBreakdown)) }
          : {}),
        ...(resetsAt !== null ? { resets_at: resetsAt } : {}),
      };
    }
    return null;
  }

  private billingCycleEndUnix(value: unknown): number | null {
    if (typeof value !== 'string' || value.length === 0) {
      return null;
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return Math.floor(parsed / 1000);
  }

  private mapCredits(body: Record<string, unknown>): CreditBalance | null {
    const plan = this.asRecord(body['planUsage']);
    const planCredits = plan ? this.fromPlanUsage(plan) : null;
    if (planCredits) {
      return planCredits;
    }
    const spend = this.asRecord(body['spendLimitUsage']);
    const spendCredits = spend ? this.fromSpendLimit(spend) : null;
    if (spendCredits) {
      return spendCredits;
    }
    return this.fromRequestBuckets(body);
  }

  private fromRequestBuckets(body: Record<string, unknown>): CreditBalance | null {
    const preferred = this.asRecord(body['gpt-4']) ?? this.firstRequestBucket(body);
    if (!preferred) {
      return null;
    }
    const used = this.asNumber(preferred['numRequests']) ?? this.asNumber(preferred['numRequestsTotal']);
    const limit = this.asNumber(preferred['maxRequestUsage']);
    if (used === null && limit === null) {
      return null;
    }
    const remaining = used !== null && limit !== null ? Math.max(0, limit - used) : null;
    const usedPercent = used !== null && limit !== null && limit > 0
      ? Math.round((used / limit) * CursorUsageMapper.PERCENT_MAX)
      : null;
    const resetsAt = this.monthResetUnix(body);
    return {
      unit: 'requests',
      pool: 'requests',
      ...(used !== null ? { used } : {}),
      ...(limit !== null ? { limit } : {}),
      ...(remaining !== null ? { remaining } : {}),
      ...(usedPercent !== null ? { used_percentage: usedPercent } : {}),
      ...(resetsAt !== null ? { resets_at: resetsAt } : {}),
    };
  }

  private monthResetUnix(body: Record<string, unknown>): number | null {
    const raw = body['startOfMonth'];
    if (typeof raw !== 'string' || raw.length === 0) {
      return null;
    }
    const startMs = Date.parse(raw);
    if (Number.isNaN(startMs)) {
      return null;
    }
    const reset = new Date(startMs);
    reset.setUTCMonth(reset.getUTCMonth() + 1);
    return Math.floor(reset.getTime() / 1000);
  }

  private firstRequestBucket(body: Record<string, unknown>): Record<string, unknown> | null {
    for (const value of Object.values(body)) {
      const record = this.asRecord(value);
      if (!record) {
        continue;
      }
      if (this.asNumber(record['numRequests']) !== null || this.asNumber(record['maxRequestUsage']) !== null) {
        return record;
      }
    }
    return null;
  }

  private fromPlanUsage(plan: Record<string, unknown>): CreditBalance | null {
    const limitCents = this.asNumber(plan['limit']);
    const usedCents = this.asNumber(plan['totalSpend']) ?? this.asNumber(plan['used']) ?? this.asNumber(plan['includedSpend']);
    const remainingCents = this.asNumber(plan['remaining']);
    const percent = this.asNumber(plan['totalPercentUsed']);
    return this.creditsFromCents(usedCents, limitCents, remainingCents, percent);
  }

  private fromSpendLimit(spend: Record<string, unknown>): CreditBalance | null {
    const limitCents = this.asNumber(spend['pooledLimit']);
    const usedCents = this.asNumber(spend['pooledUsed']);
    const remainingCents = this.asNumber(spend['pooledRemaining']);
    return this.creditsFromCents(usedCents, limitCents, remainingCents, null);
  }

  private creditsFromCents(
    usedCents: number | null,
    limitCents: number | null,
    remainingCents: number | null,
    percent: number | null,
  ): CreditBalance | null {
    const remaining = remainingCents ?? this.remainingCents(usedCents, limitCents);
    const usedPercent = percent !== null ? Math.round(percent) : this.usedPercent(usedCents, limitCents, remaining);
    if (remaining === null && usedPercent === null && usedCents === null && limitCents === null) {
      return null;
    }
    return {
      unit: 'usd',
      ...(usedCents !== null ? { used: this.centsToDollars(usedCents) } : {}),
      ...(limitCents !== null ? { limit: this.centsToDollars(limitCents) } : {}),
      ...(remaining !== null ? { remaining: this.centsToDollars(remaining) } : {}),
      ...(usedPercent !== null ? { used_percentage: usedPercent } : {}),
    };
  }

  private mapRateLimits(body: Record<string, unknown>): RateLimits | null {
    const limits: RateLimits = {
      ...(this.window(body, ['daily', 'day', 'fiveHour', 'five_hour']) ? { day: this.window(body, ['daily', 'day', 'fiveHour', 'five_hour']) } : {}),
      ...(this.window(body, ['weekly', 'week', 'sevenDay', 'seven_day']) ? { week: this.window(body, ['weekly', 'week', 'sevenDay', 'seven_day']) } : {}),
    };
    return Object.keys(limits).length > 0 ? limits : null;
  }

  private window(body: Record<string, unknown>, keys: readonly string[]): RateLimit | undefined {
    for (const key of keys) {
      const raw = this.asRecord(body[key]) ?? this.asRecord(this.asRecord(body['planUsage'])?.[key]);
      if (!raw) {
        continue;
      }
      const usedPercentage = this.asNumber(raw['used_percentage']) ?? this.asNumber(raw['usedPercentage']) ?? this.asNumber(raw['totalPercentUsed']);
      const remaining = this.asNumber(raw['remaining']);
      const limit = this.asNumber(raw['limit']);
      const used = this.asNumber(raw['used']) ?? this.asNumber(raw['totalSpend']);
      const resetsAt = this.asNumber(raw['resets_at']) ?? this.asNumber(raw['resetsAt']);
      if (usedPercentage === null && remaining === null && limit === null && used === null) {
        continue;
      }
      return {
        ...(usedPercentage !== null ? { used_percentage: usedPercentage } : {}),
        ...(remaining !== null ? { remaining } : {}),
        ...(limit !== null ? { limit } : {}),
        ...(used !== null ? { used } : {}),
        ...(resetsAt !== null ? { resets_at: resetsAt } : {}),
      };
    }
    return undefined;
  }

  private remainingCents(usedCents: number | null, limitCents: number | null): number | null {
    if (usedCents === null || limitCents === null) {
      return null;
    }
    return Math.max(0, limitCents - usedCents);
  }

  private usedPercent(usedCents: number | null, limitCents: number | null, remainingCents: number | null): number | null {
    if (typeof usedCents === 'number' && typeof limitCents === 'number' && limitCents > 0) {
      return Math.round((usedCents / limitCents) * CursorUsageMapper.PERCENT_MAX);
    }
    if (typeof remainingCents === 'number' && typeof limitCents === 'number' && limitCents > 0) {
      return Math.round(((limitCents - remainingCents) / limitCents) * CursorUsageMapper.PERCENT_MAX);
    }
    return null;
  }

  private centsToDollars(cents: number): number {
    return cents / CursorUsageMapper.CENTS_PER_DOLLAR;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
