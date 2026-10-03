import { describe, expect, it } from 'bun:test';
import { SessionTotals } from '../../claude-mods/iteration-recap/hooks/sessionTotals.ts';
import type { IterationRecapEntry, IterationRecapLink } from '../../claude-mods/iteration-recap/types';

const entry = (index: number, changedRepos: string[], pullRequests: IterationRecapLink[]): IterationRecapEntry => ({
  index,
  turnId: `t${index}`,
  prompt: '',
  summary: '',
  isSummaryFromModel: false,
  startedAt: 0,
  durationMs: 0,
  outputTokens: 0,
  toolCounts: {},
  endReason: 'answer',
  artifacts: { files: [], skills: [], repos: [], changedRepos, pullRequests, reviews: [], plans: [], commits: [], questions: [] },
});

describe('SessionTotals', () => {
  const created = { label: 'acme/web#4', url: 'https://github.com/acme/web/pull/4', isCreated: true };
  const iterations = [
    entry(1, ['web'], [created]),
    entry(2, ['web', 'api'], [{ label: 'acme/web#9', url: 'https://github.com/acme/web/pull/9' }, created]),
  ];

  it('unions changed repos across every iteration', () => {
    expect(SessionTotals.changedRepos(iterations)).toEqual(['web', 'api']);
  });

  it('lists each created PR once and skips mentioned ones', () => {
    expect(SessionTotals.createdPullRequests(iterations)).toEqual([created]);
  });

  it('tolerates recaps stored before changed repos existed', () => {
    const legacy = entry(3, [], []);
    const { changedRepos, ...rest } = legacy.artifacts;
    expect(SessionTotals.changedRepos([{ ...legacy, artifacts: rest as IterationRecapEntry['artifacts'] }])).toEqual([]);
    expect(changedRepos).toEqual([]);
  });
});
