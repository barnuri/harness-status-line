import { describe, expect, it } from 'bun:test';
import { OverviewFacts } from '../../claude-mods/summarize/hooks/overviewFacts.ts';
import type { IterationRecapEntry, IterationRecapLink } from '../../claude-mods/summarize/types';

const entry = (index: number, artifacts: Partial<IterationRecapEntry['artifacts']> = {}, extra: Partial<IterationRecapEntry> = {}): IterationRecapEntry => ({
  index,
  turnId: `t${index}`,
  prompt: '',
  summary: '',
  startedAt: 0,
  durationMs: 0,
  outputTokens: 0,
  toolCounts: {},
  endReason: 'answer',
  artifacts: { files: [], skills: [], repos: [], changedRepos: [], pullRequests: [], reviews: [], plans: [], commits: [], questions: [], ...artifacts },
  ...extra,
});

const input = (iterations: IterationRecapEntry[], sessionHead: IterationRecapLink | null = null) => ({
  slug: 'session-overview',
  sessionId: 'sess-1',
  cwd: '/work/web',
  iterations,
  sessionHead,
});

const KEY_ORDER = ['schemaVersion', 'slug', 'sessionId', 'cwd', 'turns', 'durationMs', 'outputTokens', 'toolCounts', 'files', 'skills', 'changedRepos', 'pullRequests', 'commits', 'lastCommits', 'plans', 'reviews'];

describe('OverviewFacts', () => {
  it('writes keys in the data-contract order with two-space indent and a trailing newline', () => {
    const text = OverviewFacts.serialize(OverviewFacts.build(input([entry(1)])));

    expect(Object.keys(JSON.parse(text))).toEqual(KEY_ORDER);
    expect(text.startsWith('{\n  "schemaVersion": 1,\n  "slug": "session-overview",\n')).toBe(true);
    expect(text.endsWith('\n}\n')).toBe(true);
  });

  it('is byte-stable for the same input', () => {
    const iterations = [entry(1, { files: ['/work/web/a.ts'] }, { toolCounts: { Read: 1, Bash: 2 } })];

    expect(OverviewFacts.serialize(OverviewFacts.build(input(iterations)))).toBe(OverviewFacts.serialize(OverviewFacts.build(input(iterations))));
  });

  it('sorts toolCounts keys, summing across iterations', () => {
    const document = OverviewFacts.build(input([
      entry(1, {}, { toolCounts: { Edit: 1, Bash: 3 } }),
      entry(2, {}, { toolCounts: { Read: 2, Bash: 1 } }),
    ]));
    const parsed = JSON.parse(OverviewFacts.serialize(document)) as { toolCounts: Record<string, number> };

    expect(Object.keys(parsed.toolCounts)).toEqual(['Bash', 'Edit', 'Read']);
    expect(parsed.toolCounts).toEqual({ Bash: 4, Edit: 1, Read: 2 });
  });

  it('omits absent optional link keys instead of writing null', () => {
    const document = OverviewFacts.build(input([
      entry(1, { changedRepos: [{ label: 'api' }, { label: 'web', url: 'https://github.com/acme/web', repo: 'web', isBranch: false }] }),
    ]));
    const text = OverviewFacts.serialize(document);
    const parsed = JSON.parse(text) as { changedRepos: Record<string, unknown>[] };

    expect(parsed.changedRepos[0]).toEqual({ label: 'api' });
    expect(Object.keys(parsed.changedRepos[0] ?? {})).toEqual(['label']);
    expect(Object.keys(parsed.changedRepos[1] ?? {})).toEqual(['label', 'url', 'repo', 'isBranch']);
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });

  it('keeps link keys in the order label, url, repo, isCreated, isBranch', () => {
    const link: IterationRecapLink = { isBranch: true, repo: 'web', isCreated: true, url: 'https://github.com/acme/web/pull/4', label: 'acme/web#4' };
    const parsed = JSON.parse(OverviewFacts.serialize(OverviewFacts.build(input([entry(1, { pullRequests: [link] })])))) as { pullRequests: Record<string, unknown>[] };

    expect(Object.keys(parsed.pullRequests[0] ?? {})).toEqual(['label', 'url', 'repo', 'isCreated', 'isBranch']);
  });

  it('handles an empty session with no iterations and no head', () => {
    const document = OverviewFacts.build(input([]));

    expect(document).toEqual({
      schemaVersion: 1,
      slug: 'session-overview',
      sessionId: 'sess-1',
      cwd: '/work/web',
      turns: 0,
      durationMs: 0,
      outputTokens: 0,
      toolCounts: {},
      files: [],
      skills: [],
      changedRepos: [],
      pullRequests: [],
      commits: [],
      lastCommits: [],
      plans: [],
      reviews: [],
    });
    expect(OverviewFacts.serialize(document)).toContain('"toolCounts": {},\n  "files": [],');
  });

  it('sums turns, duration and output tokens', () => {
    const document = OverviewFacts.build(input([
      entry(1, {}, { durationMs: 1500, outputTokens: 200 }),
      entry(2, {}, { durationMs: 2500, outputTokens: 50 }),
      entry(3, {}, { durationMs: 0, outputTokens: 0 }),
    ]));

    expect(document.turns).toBe(3);
    expect(document.durationMs).toBe(4000);
    expect(document.outputTokens).toBe(250);
  });

  it('lists files, plans and reviews once each in first-seen order', () => {
    const document = OverviewFacts.build(input([
      entry(1, { files: ['/work/web/a.ts', '/work/web/b.ts'], plans: ['/work/web/agent-spec/x/plan.md'], reviews: ['/work/web/r1.md'] }),
      entry(2, { files: ['/work/web/b.ts', '/work/web/c.ts'], plans: ['/work/web/agent-spec/x/plan.md', '/work/web/agent-spec/x/tasks.md'], reviews: ['/work/web/r1.md', '/work/web/r2.md'] }),
    ]));

    expect(document.files).toEqual(['/work/web/a.ts', '/work/web/b.ts', '/work/web/c.ts']);
    expect(document.plans).toEqual(['/work/web/agent-spec/x/plan.md', '/work/web/agent-spec/x/tasks.md']);
    expect(document.reviews).toEqual(['/work/web/r1.md', '/work/web/r2.md']);
  });

  it('takes skills, changed repos, pull requests and commits from the pane helpers', () => {
    const created: IterationRecapLink = { label: 'acme/web#4', url: 'https://github.com/acme/web/pull/4', isCreated: true };
    const document = OverviewFacts.build(input([
      entry(1, { skills: ['/code-gen'], changedRepos: [{ label: 'web', url: 'file:///work/web' }], pullRequests: [created, { label: 'acme/web#9', url: 'https://github.com/acme/web/pull/9' }], commitLinks: [{ label: 'abc1234 fix', url: 'https://github.com/acme/web/commit/abc1234' }] }),
      entry(2, { skills: ['/cr', '/code-gen'], changedRepos: [{ label: 'web', url: 'https://github.com/acme/web' }, { label: 'api' }], pullRequests: [created], commitLinks: [{ label: 'abc1234 fix', url: 'https://github.com/acme/web/commit/abc1234' }, { label: 'def5678 add', url: 'https://github.com/acme/web/commit/def5678' }] }),
    ]));

    expect(document.skills).toEqual(['/code-gen', '/cr']);
    expect(document.changedRepos).toEqual([{ label: 'web', url: 'https://github.com/acme/web' }, { label: 'api' }]);
    expect(document.pullRequests).toEqual([created]);
    expect(document.commits.map(link => link.label)).toEqual(['abc1234 fix', 'def5678 add']);
  });

  it('lists lastCommits with the session head repo first, then one per repo in iteration order', () => {
    const iterations = [
      entry(1, { headCommits: [{ label: 'api@1111111', repo: 'api' }] }),
      entry(2, { headCommits: [{ label: 'worker@2222222', repo: 'worker' }, { label: 'api@3333333', repo: 'api' }] }),
    ];
    const document = OverviewFacts.build(input(iterations, { label: 'web@0000000', repo: 'web' }));

    expect(document.lastCommits.map(link => link.repo)).toEqual(['web', 'api', 'worker']);
  });

  it('keeps the session head in lastCommits when there are no iterations', () => {
    const document = OverviewFacts.build(input([], { label: 'web@0000000', repo: 'web' }));

    expect(document.lastCommits).toEqual([{ label: 'web@0000000', repo: 'web' }]);
  });
});
