import type { Segment, SegmentColorConfig, SegmentColorMap } from '../types.ts';
import type { BackgroundCounts } from './backgroundTaskReader.ts';

/** Builds the background segment: `⟳ 2 agents · 1 monitor · 1 cmd`. Returns null when nothing runs. */
export class BackgroundTaskSegment {
  private static readonly ICON = '⟳ ';
  private static readonly SEPARATOR = ' · ';

  build(counts: BackgroundCounts, colors: SegmentColorMap): Segment | null {
    const parts: string[] = [];
    if (counts.agents > 0) { parts.push(`${counts.agents} ${counts.agents === 1 ? 'agent' : 'agents'}`); }
    if (counts.monitors > 0) { parts.push(`${counts.monitors} ${counts.monitors === 1 ? 'monitor' : 'monitors'}`); }
    if (counts.commands > 0) { parts.push(`${counts.commands} ${counts.commands === 1 ? 'cmd' : 'cmds'}`); }
    if (parts.length === 0) {
      return null;
    }
    const color: SegmentColorConfig = colors.background;
    return {
      icon: BackgroundTaskSegment.ICON,
      label: '',
      value: parts.join(BackgroundTaskSegment.SEPARATOR),
      fg: color.fg,
      bg: color.bg,
    };
  }
}
