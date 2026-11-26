import type { Segment, SegmentColorMap } from '../types.ts';
import type { AutomationWork, GoalWork, SessionGoal } from '../opencode/scheduleStateReader.ts';

/** Builds `⏰ 2 scheduled · next 28m` (plus a warning chip `1 failed`) `☑ 3/7 · current item` (todos) and `🎯 goal 3/50 · objective` (/goal). */
export class ScheduleSegment {
  static readonly CURRENT_MAX = 30;
  private static readonly SEPARATOR = ' · ';

  buildAutomations(work: AutomationWork, colors: SegmentColorMap, nowMs: number = Date.now(), enabled = true): Segment[] {
    if (!enabled || work.count === 0) {
      return [];
    }
    const parts = [`${work.count} scheduled`];
    if (work.nextDueMs !== null) {
      parts.push(`next ${ScheduleSegment.until(work.nextDueMs - nowMs)}`);
    }
    const color = colors.background;
    const out: Segment[] = [{ icon: '⏰ ', label: '', value: parts.join(ScheduleSegment.SEPARATOR), fg: color.fg, bg: color.bg }];
    if (work.failed > 0) {
      const warning = colors.rateWarning;
      out.push({ icon: '', label: '', value: `${work.failed} failed`, fg: warning.fg, bg: warning.bg });
    }
    return out;
  }

  buildGoals(work: GoalWork, colors: SegmentColorMap, enabled = true): Segment | null {
    if (!enabled || work.total === 0 || work.completed === work.total) {
      return null;
    }
    const parts = [`${work.completed}/${work.total}`];
    if (work.current) {
      parts.push(work.current.replace(/\s+/g, ' ').trim().slice(0, ScheduleSegment.CURRENT_MAX).trimEnd());
    }
    const color = colors.activityRunning;
    return { icon: '☑ ', label: '', value: parts.join(ScheduleSegment.SEPARATOR), fg: color.fg, bg: color.bg };
  }

  /** The `/goal` chip. Active is normal, paused is warning colored, complete or none is hidden. */
  buildGoal(goal: SessionGoal | null, colors: SegmentColorMap, enabled = true): Segment | null {
    if (!enabled || !goal || goal.status === 'complete') {
      return null;
    }
    const objective = goal.objective.replace(/\s+/g, ' ').trim().slice(0, ScheduleSegment.CURRENT_MAX).trimEnd();
    const parts = [`goal ${goal.rounds}/${goal.maxRounds}`, objective];
    if (goal.status === 'paused') {
      parts.splice(1, 0, 'paused');
    }
    const color = goal.status === 'paused' ? colors.rateWarning : colors.activityRunning;
    return { icon: '🎯 ', label: '', value: parts.join(ScheduleSegment.SEPARATOR), fg: color.fg, bg: color.bg };
  }

  /** Short time until a due time: `28m`, `2h5m`, `3d`. A time in the past is `due`. */
  static until(ms: number): string {
    if (ms <= 0) { return 'due'; }
    const s = Math.floor(ms / 1000);
    if (s < 60) { return `${s}s`; }
    if (s < 3600) { return `${Math.floor(s / 60)}m`; }
    if (s < 86400) { return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`; }
    return `${Math.floor(s / 86400)}d`;
  }
}
