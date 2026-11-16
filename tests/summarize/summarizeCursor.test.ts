import { describe, expect, it } from 'bun:test';
import { SummarizeCursor } from '../../claude-mods/summarize/hooks/summarizeCursor.ts';
import type { IterationSummarizeEntry } from '../../claude-mods/summarize/types';

const entry = (index: number): IterationSummarizeEntry => ({
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
  artifacts: { files: [], skills: [], repos: [], changedRepos: [], pullRequests: [], reviews: [], plans: [], commits: [], questions: [] },
});

const list = [entry(3), entry(4), entry(5)];

describe('SummarizeCursor', () => {
  it('follows the latest iteration while the cursor is null', () => {
    expect(SummarizeCursor.selected(list, null)?.index).toBe(5);
    expect(SummarizeCursor.selected([], null)).toBeUndefined();
  });

  it('falls back to the latest when the cursor points at a dropped iteration', () => {
    expect(SummarizeCursor.selected(list, 1)?.index).toBe(5);
  });

  it('steps within bounds and returns to following at the end', () => {
    expect(SummarizeCursor.step(list, null, -1)).toBe(4);
    expect(SummarizeCursor.step(list, 3, -1)).toBe(3);
    expect(SummarizeCursor.step(list, 4, 1)).toBeNull();
    expect(SummarizeCursor.step([], null, -1)).toBeNull();
  });

  it('jumps only to known iterations', () => {
    expect(SummarizeCursor.jump(list, 3)).toBe(3);
    expect(SummarizeCursor.jump(list, 5)).toBeNull();
    expect(SummarizeCursor.jump(list, 99)).toBeNull();
  });

  it('parses /summarize arguments', () => {
    expect(SummarizeCursor.parse('prev', list, null)).toBe(4);
    expect(SummarizeCursor.parse('next', list, 3)).toBe(4);
    expect(SummarizeCursor.parse('latest', list, 3)).toBeNull();
    expect(SummarizeCursor.parse('#4', list, null)).toBe(4);
    expect(SummarizeCursor.parse('banana', list, 3)).toBe(3);
  });
});
