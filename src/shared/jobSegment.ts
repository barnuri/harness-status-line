import type { Segment, SegmentColorMap } from '../types.ts';
import type { JobItem, JobWork } from '../opencode/jobStateReader.ts';

/** Builds `bg N <cmd> <age>` and `agents: N <title> <age>`. Each shows only when its count is above 0. */
export class JobSegment {
  static readonly COMMAND_MAX = 24;
  static readonly TITLE_MAX = 24;

  build(work: JobWork, colors: SegmentColorMap, nowMs: number = Date.now()): Segment[] {
    const out: Segment[] = [];
    const color = colors.background;
    if (work.bgCount > 0) {
      out.push({ icon: '⟳ ', label: '', value: this.value('bg', work.bgCount, work.bgOldest, JobSegment.COMMAND_MAX, nowMs), fg: color.fg, bg: color.bg });
    }
    if (work.subCount > 0) {
      out.push({ icon: '⟳ ', label: '', value: this.value('agents:', work.subCount, work.subFirst, JobSegment.TITLE_MAX, nowMs), fg: color.fg, bg: color.bg });
    }
    return out;
  }

  static age(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) { return `${s}s`; }
    if (s < 3600) { return `${Math.floor(s / 60)}m`; }
    if (s < 86400) { return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`; }
    return `${Math.floor(s / 86400)}d`;
  }

  private value(label: string, count: number, item: JobItem | null, max: number, nowMs: number): string {
    if (!item) { return `${label} ${count}`; }
    const text = item.text.replace(/\s+/g, ' ').trim().slice(0, max);
    return `${label} ${count} ${text} ${JobSegment.age(nowMs - item.startedMs)}`.replace(/\s+/g, ' ');
  }
}
