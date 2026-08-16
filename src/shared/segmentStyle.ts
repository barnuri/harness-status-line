import type { RgbColor, Segment } from '../types.ts';

/** Harness-neutral segment presentation: the display text and colours, without any renderer. */
export class SegmentStyle {
  private static readonly HEX_RADIX = 16;
  private static readonly HEX_PAIR_LENGTH = 2;
  private static readonly MAX_CHANNEL = 255;

  text(segment: Segment): string {
    if (segment.label) {
      return `${segment.icon}${segment.label}: ${segment.value}`;
    }
    return `${segment.icon}${segment.value}`;
  }

  padded(segment: Segment): string {
    return ` ${this.text(segment)} `;
  }

  hex(color: RgbColor): string {
    return `#${color.map((channel) => this.channelHex(channel)).join('')}`;
  }

  private channelHex(channel: number): string {
    const safe = Number.isFinite(channel) ? channel : 0;
    const clamped = Math.max(0, Math.min(SegmentStyle.MAX_CHANNEL, Math.round(safe)));
    return clamped.toString(SegmentStyle.HEX_RADIX).padStart(SegmentStyle.HEX_PAIR_LENGTH, '0');
  }
}
