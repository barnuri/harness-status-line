import type { ActivityState, Segment, SegmentColorConfig, SegmentColorMap } from '../types.ts';

/** Builds the first-from-left segment: a spinner while the agent works, an icon for every other state. */
export class ActivitySegment {
  static readonly SPINNER_FRAMES: ReadonlyArray<string> = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  // Not a divisor of the 2 s Claude refresh, so each refresh shows a different frame.
  static readonly FRAME_MS = 130;
  private static readonly ICONS: Readonly<Record<Exclude<ActivityState, 'running' | 'compacting'>, string>> = {
    permission: '⏸',
    question: '❓',
    idle: '✓',
    error: '✗',
    interrupted: '⏹',
  };
  private static readonly VALUES: Readonly<Record<ActivityState, string>> = {
    running: 'running',
    compacting: 'compacting',
    permission: 'approve',
    question: 'question',
    idle: 'ready',
    error: 'error',
    interrupted: 'interrupted',
  };

  static isAnimated(state: ActivityState): boolean {
    return state === 'running' || state === 'compacting';
  }

  build(state: ActivityState, colors: SegmentColorMap, nowMs: number = Date.now()): Segment {
    const color = this.color(state, colors);
    return { icon: `${this.glyph(state, nowMs)} `, label: '', value: ActivitySegment.VALUES[state], fg: color.fg, bg: color.bg };
  }

  private glyph(state: ActivityState, nowMs: number): string {
    if (state === 'running' || state === 'compacting') {
      const frames = ActivitySegment.SPINNER_FRAMES;
      return frames[Math.floor(nowMs / ActivitySegment.FRAME_MS) % frames.length]!;
    }
    return ActivitySegment.ICONS[state];
  }

  private color(state: ActivityState, colors: SegmentColorMap): SegmentColorConfig {
    switch (state) {
      case 'running':
      case 'compacting':
        return colors.activityRunning;
      case 'permission':
      case 'question':
        return colors.activityWaiting;
      case 'idle':
        return colors.activityIdle;
      case 'error':
        return colors.activityError;
      case 'interrupted':
        return colors.activityStopped;
    }
  }
}
