import { describe, expect, it } from 'bun:test';
import { ArtifactExtractor } from '../../claude-mods/iteration-recap/hooks/artifactExtractor.ts';
import type { IterationRecapToolCall } from '../../claude-mods/iteration-recap/types';

const call = (tool: string, input: Record<string, unknown>, resultText = '', isError = false): IterationRecapToolCall => ({
  tool,
  input,
  resultText,
  isError,
});

describe('ArtifactExtractor.extract', () => {
  it('lists edited files once and skips failed edits', () => {
    const artifacts = ArtifactExtractor.extract([
      call('Edit', { file_path: '/repo/src/a.ts' }),
      call('Write', { file_path: '/repo/src/a.ts' }),
      call('NotebookEdit', { notebook_path: '/repo/n.ipynb' }),
      call('Edit', { file_path: '/repo/broken.ts' }, 'old_string not found', true),
    ], '', '');

    expect(artifacts.files).toEqual(['/repo/src/a.ts', '/repo/n.ipynb']);
  });

  it('finds PR links in gh output and the answer, plus numbered gh pr commands', () => {
    const artifacts = ArtifactExtractor.extract([
      call('Bash', { command: 'gh pr create --fill' }, 'https://github.com/acme/web/pull/42\n'),
      call('Bash', { command: 'gh pr merge 42 --squash' }),
      call('Bash', { command: 'gh pr checkout 7' }),
    ], 'Opened https://github.com/acme/api/pull/9 too.', '');

    expect(artifacts.pullRequests).toEqual([
      { label: 'acme/web#42', url: 'https://github.com/acme/web/pull/42', isCreated: true },
      { label: 'acme/api#9', url: 'https://github.com/acme/api/pull/9' },
      { label: '#7 (gh pr checkout)' },
    ]);
  });

  it('collects remote repos from URLs and gh --repo flags, ignoring API paths', () => {
    const artifacts = ArtifactExtractor.extract([
      call('Bash', { command: 'git clone git@github.com:acme/tools.git && gh issue list -R acme/infra' }),
      call('Bash', { command: 'curl https://api.github.com/repos/acme/x' }),
    ], 'See https://github.com/acme/web/pull/1', '');

    expect(artifacts.repos).toEqual(['acme/tools', 'acme/infra', 'acme/web']);
  });

  it('detects code reviews from skills, agents, findings and gh pr review', () => {
    const artifacts = ArtifactExtractor.extract([
      call('Skill', { skill: 'barnuri-dev-skills:cr' }),
      call('Skill', { skill: 'code-gen' }),
      call('Agent', { subagent_type: 'barnuri-dev-skills:bug-hunter', prompt: 'x' }),
      call('ReportFindings', { findings: [{}, {}] }),
      call('Bash', { command: 'gh pr review 12 --approve' }),
    ], '', '');

    expect(artifacts.reviews).toEqual([
      '/barnuri-dev-skills:cr',
      'agent barnuri-dev-skills:bug-hunter',
      '2 findings reported',
      'gh pr review 12 --approve',
    ]);
  });

  it('detects plans from plan mode, planning skills, tasks and plan files', () => {
    const artifacts = ArtifactExtractor.extract([
      call('ExitPlanMode', { plan: '\n# Migrate auth to OIDC\n\nsteps' }),
      call('Skill', { skill: 'barnuri-dev-skills:code-gen' }),
      call('Agent', { subagent_type: 'Plan' }),
      call('TaskCreate', { subject: 'Write tests' }),
      call('Write', { file_path: '/repo/agent-spec/x/plan.md' }),
      call('Write', { file_path: '/repo/src/planner.ts' }),
    ], '', '');

    expect(artifacts.plans).toEqual([
      'plan: Migrate auth to OIDC',
      '/barnuri-dev-skills:code-gen',
      'agent Plan',
      'task: Write tests',
      '/repo/agent-spec/x/plan.md',
    ]);
  });

  it('reads commits from git output and falls back to the -m message', () => {
    const artifacts = ArtifactExtractor.extract([
      call('Bash', { command: 'git commit -m "feat: a"' }, '[master 1a2b3c4d] feat: a\n 1 file changed'),
      call('Bash', { command: "git add x && git commit -m 'fix: b'" }, ''),
      call('Bash', { command: 'git commit -m "nope"' }, 'nothing to commit', true),
    ], '', '');

    expect(artifacts.commits).toEqual(['1a2b3c4 feat: a', 'fix: b']);
  });

  it('marks AskUserQuestion answers and keeps trailing answer questions open', () => {
    const artifacts = ArtifactExtractor.extract([
      call('AskUserQuestion', { questions: [{ question: 'Which database?' }] }, 'User answered: Postgres'),
      call('AskUserQuestion', { questions: [{ question: 'Deploy now?' }] }, '', true),
    ], [
      'Done.',
      '```',
      'is this code?',
      '```',
      '- **Q1** Should the cache expire hourly?',
      'Why?',
      'Want me to open the PR as well?',
    ].join('\n'), '');

    expect(artifacts.questions).toEqual([
      { text: 'Which database?', isAnswered: true },
      { text: 'Deploy now?', isAnswered: false },
      { text: 'Should the cache expire hourly?', isAnswered: false },
      { text: 'Want me to open the PR as well?', isAnswered: false },
    ]);
  });
});

describe('ArtifactExtractor skills and created PRs', () => {
  it('lists the typed slash command and every Skill tool call once', () => {
    const artifacts = ArtifactExtractor.extract([
      call('Skill', { skill: 'barnuri-dev-skills:cr' }),
      call('Skill', { skill: 'code-gen' }),
      call('Skill', { skill: 'code-gen' }),
    ], '', '/code-gen add a feature');

    expect(artifacts.skills).toEqual(['/code-gen', '/barnuri-dev-skills:cr']);
  });

  it('reads a command-name tag from an expanded slash command prompt', () => {
    const artifacts = ArtifactExtractor.extract([], '', '<command-name>/goal</command-name> ship it');

    expect(artifacts.skills).toEqual(['/goal']);
  });

  it('marks PRs from gh pr create and MCP create tools as created, others as mentioned', () => {
    const artifacts = ArtifactExtractor.extract([
      call('mcp__github__create_pull_request', { title: 'x' }, '{"html_url":"https://github.com/acme/api/pull/3"}'),
      call('Bash', { command: 'gh pr view 8' }, 'https://github.com/acme/web/pull/8'),
    ], '', '');

    expect(artifacts.pullRequests).toEqual([
      { label: 'acme/api#3', url: 'https://github.com/acme/api/pull/3', isCreated: true },
      { label: 'acme/web#8', url: 'https://github.com/acme/web/pull/8' },
    ]);
    expect(ArtifactExtractor.createdPullRequestRepos(artifacts)).toEqual(['acme/api']);
  });
});

describe('ArtifactExtractor.changeDirectories', () => {
  it('keeps edited folders and git write targets, defaulting to the session folder', () => {
    const directories = ArtifactExtractor.changeDirectories([
      call('Edit', { file_path: '/repo/src/a.ts' }),
      call('Bash', { command: 'cd /other && git commit -m x' }),
      call('Bash', { command: 'git push origin main' }),
      call('Bash', { command: 'cd /readonly && git status' }),
    ]);

    expect(directories).toEqual(['/repo/src', '/other', '.']);
  });
});

describe('ArtifactExtractor.candidateDirectories', () => {
  it('collects edited file folders, cd targets and git -C paths', () => {
    const directories = ArtifactExtractor.candidateDirectories([
      call('Edit', { file_path: '/repo/src/a.ts' }),
      call('Bash', { command: 'cd "/other repo" && git -C /third status; cd -' }),
    ]);

    expect(directories).toEqual(['/repo/src', '/other repo', '/third']);
  });
});
