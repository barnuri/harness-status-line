import { describe, expect, it } from 'bun:test';
import { RecapSummarizer } from '../../claude-mods/iteration-recap/hooks/recapSummarizer.ts';
import type { IterationRecapEntry } from '../../claude-mods/iteration-recap/types';

const entry: IterationRecapEntry = {
  index: 1,
  turnId: 't1',
  prompt: 'open a PR',
  summary: '',
  isSummaryFromModel: false,
  startedAt: 0,
  durationMs: 1000,
  outputTokens: 10,
  toolCounts: { Bash: 2 },
  endReason: 'answer',
  artifacts: {
    files: ['/r/a.ts'],
    skills: [],
    repos: [],
    changedRepos: [],
    pullRequests: [{ label: 'acme/web#4', url: 'https://github.com/acme/web/pull/4' }],
    reviews: [],
    plans: [],
    commits: ['abc1234 feat: x'],
    questions: [],
  },
};

describe('RecapSummarizer.heuristic', () => {
  it('uses the first prose sentence, skipping code and markdown', () => {
    const answer = '## Result\n```ts\nconst x = 1\n```\n**Added** the band. It shows the recap.';

    expect(RecapSummarizer.heuristic(answer)).toBe('Result Added the band.');
  });

  it('falls back to a placeholder when the turn has no prose answer', () => {
    expect(RecapSummarizer.heuristic('')).toBe('(no final answer)');
    expect(RecapSummarizer.heuristic('```\ncode\n```')).toBe('(no final answer)');
  });

  it('clips long sentences', () => {
    const summary = RecapSummarizer.heuristic('a'.repeat(300));

    expect(summary).toHaveLength(160);
    expect(summary.endsWith('…')).toBe(true);
  });
});

describe('RecapSummarizer.buildPrompt', () => {
  it('lists the iteration facts the model needs', () => {
    const prompt = RecapSummarizer.buildPrompt(entry, 'Opened the PR.');

    expect(prompt).toContain('User prompt: open a PR');
    expect(prompt).toContain('Tools used: Bash×2');
    expect(prompt).toContain('Files changed: /r/a.ts');
    expect(prompt).toContain('PRs: acme/web#4');
    expect(prompt).toContain('Commits: abc1234 feat: x');
    expect(prompt).toContain('Final answer:\nOpened the PR.');
  });
});

describe('RecapSummarizer.clean', () => {
  it('keeps the first line without quotes', () => {
    expect(RecapSummarizer.clean('"Opened PR #4."\nextra')).toBe('Opened PR #4.');
  });

  it('rejects an empty reply', () => {
    expect(RecapSummarizer.clean('  \n ')).toBeNull();
  });
});
