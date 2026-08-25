import { describe, expect, it } from 'bun:test';
import { formatTokenCount, formatTokenPair } from '../src/shared/tokenFormat.ts';

describe('formatTokenCount', () => {
  it('renders sub-thousand counts verbatim', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('renders thousands with a k suffix', () => {
    expect(formatTokenCount(1_000)).toBe('1.0k');
    expect(formatTokenCount(1_500)).toBe('1.5k');
    expect(formatTokenCount(999_999)).toBe('1000.0k');
  });

  it('renders millions with an M suffix', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M');
    expect(formatTokenCount(2_300_000)).toBe('2.3M');
  });
});

describe('formatTokenPair', () => {
  it('scales both numbers to the million unit when the total is at least 1M', () => {
    expect(formatTokenPair(420_000, 1_000_000)).toBe('0.42M/1M');
    expect(formatTokenPair(500_000, 1_000_000)).toBe('0.5M/1M');
    expect(formatTokenPair(1_000_000, 1_000_000)).toBe('1M/1M');
  });

  it('scales both numbers to the thousand unit when the total is under 1M', () => {
    expect(formatTokenPair(84_000, 200_000)).toBe('84k/200k');
    expect(formatTokenPair(120_500, 200_000)).toBe('120.5k/200k');
  });

  it('renders raw counts when the total is under a thousand', () => {
    expect(formatTokenPair(7, 500)).toBe('7/500');
  });

  it('trims trailing zeros rather than padding to two decimals', () => {
    expect(formatTokenPair(1_800_000, 2_000_000)).toBe('1.8M/2M');
    expect(formatTokenPair(0, 1_000_000)).toBe('0M/1M');
  });

  it('rounds to two decimals in the chosen unit', () => {
    expect(formatTokenPair(123_456, 1_000_000)).toBe('0.12M/1M');
    expect(formatTokenPair(126_000, 1_000_000)).toBe('0.13M/1M');
  });

  it('falls back to a single compact count when the total is not usable', () => {
    expect(formatTokenPair(420_000, 0)).toBe('420.0k');
    expect(formatTokenPair(420_000, -1)).toBe('420.0k');
  });
});
