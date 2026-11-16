import { describe, expect, it } from 'bun:test';
import { SessionTotals } from '../../claude-mods/summarize/hooks/sessionTotals.ts';
import type { IterationSummarizeEntry, IterationSummarizeLink } from '../../claude-mods/summarize/types';

const entry = (index: number, changedRepos: IterationSummarizeLink[], pullRequests: IterationSummarizeLink[]): IterationSummarizeEntry => ({
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
    entry(1, [{ label: 'web', url: 'file:///work/web' }], [created]),
    entry(2, [{ label: 'web', url: 'https://github.com/acme/web' }, { label: 'api' }], [{ label: 'acme/web#9', url: 'https://github.com/acme/web/pull/9' }, created]),
  ];

  it('unions changed repos across every iteration, preferring a web link', () => {
    expect(SessionTotals.changedRepos(iterations)).toEqual([{ label: 'web', url: 'https://github.com/acme/web' }, { label: 'api' }]);
  });

  it('unions skills across every iteration in first-seen order', () => {
    const withSkills = (index: number, skills: string[]): IterationSummarizeEntry => {
      const base = entry(index, [], []);
      return { ...base, artifacts: { ...base.artifacts, skills } };
    };

    expect(SessionTotals.skills([withSkills(1, ['/code-gen', '/cr']), withSkills(2, ['/cr', '/goal'])])).toEqual(['/code-gen', '/cr', '/goal']);
  });

  it('lists each created or branch PR once and skips mentioned ones', () => {
    expect(SessionTotals.pullRequests(iterations)).toEqual([created]);
  });

  it('tolerates summarizes stored before changed repos existed', () => {
    const legacy = entry(3, [], []);
    const { changedRepos, ...rest } = legacy.artifacts;
    expect(SessionTotals.changedRepos([{ ...legacy, artifacts: rest as IterationSummarizeEntry['artifacts'] }])).toEqual([]);
    expect(changedRepos).toEqual([]);
  });
});
