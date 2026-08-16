import { jsx } from '@opentui/solid/jsx-runtime';
import type { JSX } from '@opentui/solid/jsx-runtime';
import type { Segment } from '../types.ts';
import { SegmentStyle } from '../shared/segmentStyle.ts';

/**
 * Renders segments as padded coloured boxes. Powerline separators are deliberately not used:
 * an opentui slot is a component tree, not a character stream, so glyph joins would fight the
 * renderer's layout.
 */
export class OpencodeStatusRenderer {
  private readonly style = new SegmentStyle();

  render(segments: ReadonlyArray<Segment>): JSX.Element | null {
    if (segments.length === 0) {
      return null;
    }
    return jsx('box', {
      style: { flexDirection: 'row', flexWrap: 'wrap' },
      children: segments.map((segment) => this.renderSegment(segment)),
    });
  }

  private renderSegment(segment: Segment): JSX.Element {
    return jsx('text', {
      content: this.style.padded(segment),
      bg: this.style.hex(segment.bg),
      fg: this.style.hex(segment.fg),
    });
  }
}
