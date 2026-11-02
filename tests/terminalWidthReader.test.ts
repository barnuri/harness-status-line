import { describe, expect, test } from 'bun:test';
import { TerminalWidthReader } from '../src/shared/terminalWidthReader.ts';

describe('TerminalWidthReader.parseSttySize', () => {
  const reader = new TerminalWidthReader();

  test('reads columns from "rows cols" output', () => {
    expect(reader.parseSttySize('50 180\n')).toBe(180);
  });

  test('tolerates surrounding whitespace', () => {
    expect(reader.parseSttySize('  24   80  ')).toBe(80);
  });

  test('returns null for empty or malformed output', () => {
    expect(reader.parseSttySize('')).toBeNull();
    expect(reader.parseSttySize('stty: not a tty')).toBeNull();
    expect(reader.parseSttySize('50')).toBeNull();
  });

  test('returns null for a zero column count', () => {
    expect(reader.parseSttySize('50 0')).toBeNull();
  });
});
