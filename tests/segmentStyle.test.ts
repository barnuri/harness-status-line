import { describe, expect, it } from 'bun:test';
import { SegmentStyle } from '../src/shared/segmentStyle.ts';
import type { Segment } from '../src/types.ts';

const style = new SegmentStyle();

const segment = (overrides: Partial<Segment> = {}): Segment => ({
  icon: '📁 ',
  label: '',
  value: 'my-project',
  fg: [255, 255, 255],
  bg: [30, 102, 245],
  ...overrides,
});

describe('SegmentStyle', () => {
  describe('text()', () => {
    it('omits the label when it is empty', () => {
      expect(style.text(segment())).toBe('📁 my-project');
    });

    it('includes the label with a colon when present', () => {
      expect(style.text(segment({ icon: '⎇ ', label: 'git', value: 'master' }))).toBe('⎇ git: master');
    });

    it('handles an empty value', () => {
      expect(style.text(segment({ value: '' }))).toBe('📁 ');
    });
  });

  describe('padded()', () => {
    it('surrounds the text with single spaces', () => {
      expect(style.padded(segment())).toBe(' 📁 my-project ');
    });
  });

  describe('hex()', () => {
    it('formats a colour as a six-digit hex string', () => {
      expect(style.hex([30, 102, 245])).toBe('#1e66f5');
    });

    it('zero-pads single-digit channels', () => {
      expect(style.hex([0, 0, 0])).toBe('#000000');
      expect(style.hex([1, 2, 3])).toBe('#010203');
    });

    it('formats pure white', () => {
      expect(style.hex([255, 255, 255])).toBe('#ffffff');
    });

    it('clamps channels above 255', () => {
      expect(style.hex([300, 255, 256])).toBe('#ffffff');
    });

    it('clamps negative channels to zero', () => {
      expect(style.hex([-5, 10, -1])).toBe('#000a00');
    });

    it('rounds fractional channels', () => {
      expect(style.hex([1.4, 1.6, 2.5])).toBe('#010203');
    });

    it('treats non-finite channels (NaN, Infinity) as zero rather than emitting garbage', () => {
      expect(style.hex([Number.NaN, Number.POSITIVE_INFINITY, 16])).toBe('#000010');
      expect(style.hex([Number.NEGATIVE_INFINITY, 16, Number.NaN])).toBe('#001000');
    });
  });
});
