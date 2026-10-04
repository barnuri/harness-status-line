import { describe, expect, it } from 'bun:test';
import { GitFacts } from '../../claude-mods/summarize/hooks/gitFacts.ts';

describe('GitFacts.fromBashResult', () => {
  it('reads the engine git operation and shell-edited files', () => {
    const facts = GitFacts.fromBashResult({
      stdout: '',
      gitOperation: { commit: { sha: 'a728d9b1234', kind: 'committed' }, pr: { number: 418, url: 'https://github.com/chkp-genai/keystone/pull/418', action: 'created' } },
      bashEditDiff: { files: [{ filePath: '/w/k/a.ts', hunks: [] }], moreFiles: 1, changedFiles: ['/w/k/a.ts', '/w/k/b.ts'] },
    });

    expect(facts).toEqual({
      editedFiles: ['/w/k/a.ts', '/w/k/b.ts'],
      commitSha: 'a728d9b1234',
      pullRequest: { number: 418, url: 'https://github.com/chkp-genai/keystone/pull/418', action: 'created' },
    });
  });

  it('returns nothing for a plain result or a non-object', () => {
    expect(GitFacts.fromBashResult({ stdout: 'hi' })).toBeUndefined();
    expect(GitFacts.fromBashResult('text')).toBeUndefined();
    expect(GitFacts.fromBashResult(null)).toBeUndefined();
  });
});

describe('GitFacts.branchPullRequest', () => {
  it('turns gh pr view JSON into a branch PR link', () => {
    expect(GitFacts.branchPullRequest('{"number":418,"url":"https://github.com/chkp-genai/keystone/pull/418"}')).toEqual({
      label: 'chkp-genai/keystone#418',
      url: 'https://github.com/chkp-genai/keystone/pull/418',
      isBranch: true,
    });
  });

  it('returns null for gh errors or unrelated output', () => {
    expect(GitFacts.branchPullRequest('no pull requests found for branch "x"')).toBeNull();
    expect(GitFacts.branchPullRequest('{"number":1}')).toBeNull();
  });
});
