import { describe, it, expect } from 'bun:test';
import { StatusRenderer } from '../src/statusRenderer.ts';
import { ConfigManager } from '../src/configManager.ts';
import type { Segment, Config } from '../src/types.ts';

const renderer = new StatusRenderer();
const spacesCfg: Config = { ...ConfigManager.DEFAULT_CONFIG, separatorStyle: 'spaces' };
const powerlineCfg: Config = { ...ConfigManager.DEFAULT_CONFIG, separatorStyle: 'powerline' };

function makeSeg(value: string): Segment {
  return { icon: '', label: '', value, fg: [248, 250, 252], bg: [30, 41, 59] };
}

// Visible text of a rendered row: ANSI colour and style codes removed.
function visible(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/g, '');
}

// ────────────────────────────────────────────────────────
// Row that fits stays on one line
// ────────────────────────────────────────────────────────

describe('StatusRenderer wrap — a row that fits stays on one line', () => {
  it('spaces mode: three short segments with an exact-fit width stay on one row', () => {
    // Each 'a' segment is 3 columns (' a '), so three of them need exactly 9 columns.
    const out = renderer.render([makeSeg('a'), makeSeg('a'), makeSeg('a')], 9, spacesCfg);
    expect(out.includes('\n')).toBe(false);
    expect(visible(out)).toBe(' a  a  a ');
  });

  it('spaces mode: a row well inside the terminal width is not wrapped', () => {
    const out = renderer.render([makeSeg('alpha'), makeSeg('beta')], 200, spacesCfg);
    expect(out.includes('\n')).toBe(false);
  });

  it('powerline mode: a row with its trailing arrow exactly fitting stays on one row', () => {
    // ' a ' + '❯' + ' a ' + '❯' is 8 columns.
    const out = renderer.render([makeSeg('a'), makeSeg('a')], 8, powerlineCfg);
    expect(out.includes('\n')).toBe(false);
    expect(visible(out).length).toBe(8);
  });
});

// ────────────────────────────────────────────────────────
// Row that does not fit wraps at a segment boundary
// ────────────────────────────────────────────────────────

describe('StatusRenderer wrap — a row that does not fit wraps at a segment boundary', () => {
  it('spaces mode: the next whole segment moves to a new row', () => {
    // alpha = 7 columns, beta = 6, gamma = 7. alpha + beta = 13 fits in 14; adding gamma gives 20.
    const out = renderer.render([makeSeg('alpha'), makeSeg('beta'), makeSeg('gamma')], 14, spacesCfg);
    const lines = out.split('\n');

    expect(lines.length).toBe(2);
    expect(visible(lines[0]!)).toBe(' alpha  beta ');
    expect(visible(lines[1]!)).toBe(' gamma ');
  });

  it('spaces mode: every row stays within the terminal width', () => {
    const segs = [makeSeg('alpha'), makeSeg('beta'), makeSeg('gamma'), makeSeg('delta')];
    const out = renderer.render(segs, 14, spacesCfg);
    for (const line of out.split('\n')) {
      expect(visible(line).length).toBeLessThanOrEqual(14);
    }
  });

  it('spaces mode: each segment keeps its own colours on the wrapped row', () => {
    const gamma: Segment = { icon: '', label: '', value: 'gamma', fg: [1, 2, 3], bg: [9, 8, 7] };
    const out = renderer.render([makeSeg('alpha'), makeSeg('beta'), gamma], 14, spacesCfg);
    const second = out.split('\n')[1]!;
    expect(second).toContain('\x1b[48;2;9;8;7m');
    expect(second).toContain('\x1b[38;2;1;2;3m');
  });

  it('powerline mode: the trailing arrow is counted, so a too-wide row wraps', () => {
    // Without the trailing arrow reserved, [a, a] would fit in 7 columns. Its row is 8.
    const out = renderer.render([makeSeg('a'), makeSeg('a')], 7, powerlineCfg);
    expect(out.split('\n').length).toBe(2);
  });

  it('powerline mode: the wrapped row ends with its own trailing arrow', () => {
    const out = renderer.render([makeSeg('alpha'), makeSeg('beta'), makeSeg('gamma')], 14, powerlineCfg);
    for (const line of out.split('\n')) {
      expect(visible(line).endsWith('❯')).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────
// A segment wider than the terminal is not split
// ────────────────────────────────────────────────────────

describe('StatusRenderer wrap — a segment wider than the terminal is not split', () => {
  const wide = 'x'.repeat(50); // 52 columns with padding, wider than a 20-column terminal

  it('a lone oversized segment is rendered whole on a single row', () => {
    const out = renderer.render([makeSeg(wide)], 20, spacesCfg);
    expect(out.includes('\n')).toBe(false);
    expect(visible(out)).toBe(` ${wide} `);
  });

  it('an oversized segment after a short one gets its own row, unbroken', () => {
    const out = renderer.render([makeSeg('a'), makeSeg(wide)], 20, spacesCfg);
    const lines = out.split('\n');

    expect(lines.length).toBe(2);
    expect(visible(lines[0]!)).toBe(' a ');
    expect(visible(lines[1]!)).toBe(` ${wide} `);
  });

  it('an oversized segment before a short one keeps its row, and the short one wraps after it', () => {
    const out = renderer.render([makeSeg(wide), makeSeg('a')], 20, spacesCfg);
    const lines = out.split('\n');

    expect(lines.length).toBe(2);
    expect(visible(lines[0]!)).toBe(` ${wide} `);
    expect(visible(lines[1]!)).toBe(' a ');
  });
});
