import { describe, expect, it } from 'bun:test';
import { RecapCursor } from '../../claude-mods/iteration-recap/hooks/recapCursor.ts';
import type { IterationRecapEntry } from '../../claude-mods/iteration-recap/types';

const entry = (index: number): IterationRecapEntry => ({
  index,
  turnId: `t${index}`,
  prompt: '',
  summary: `s${index}`,
  isSummaryFromModel: false,
  startedAt: 0,
  durationMs: 0,
  outputTokens: 0,
  toolCounts: {},
  endReason: 'answer',
  artifacts: { files: [], repos: [], pullRequests: [], reviews: [], plans: [], commits: [], questions: [] },
});

const list = [entry(3), entry(4), entry(5)];

describe('RecapCursor', () => {
  it('follows the latest iteration while the cursor is null', () => {
    expect(RecapCursor.selected(list, null)?.index).toBe(5);
    expect(RecapCursor.selected([], null)).toBeUndefined();
  });

  it('falls back to the latest when the cursor points at a dropped iteration', () => {
    expect(RecapCursor.selected(list, 1)?.index).toBe(5);
  });

  it('steps within bounds and returns to following at the end', () => {
    expect(RecapCursor.step(list, null, -1)).toBe(4);
    expect(RecapCursor.step(list, 3, -1)).toBe(3);
    expect(RecapCursor.step(list, 4, 1)).toBeNull();
    expect(RecapCursor.step([], null, -1)).toBeNull();
  });

  it('jumps only to known iterations', () => {
    expect(RecapCursor.jump(list, 3)).toBe(3);
    expect(RecapCursor.jump(list, 5)).toBeNull();
    expect(RecapCursor.jump(list, 99)).toBeNull();
  });

  it('parses /recap arguments', () => {
    expect(RecapCursor.parse('prev', list, null)).toBe(4);
    expect(RecapCursor.parse('next', list, 3)).toBe(4);
    expect(RecapCursor.parse('latest', list, 3)).toBeNull();
    expect(RecapCursor.parse('#4', list, null)).toBe(4);
    expect(RecapCursor.parse('banana', list, 3)).toBe(3);
  });
});
