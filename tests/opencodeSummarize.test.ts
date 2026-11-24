import { describe, expect, it } from 'bun:test';
import { OpencodeToolCall } from '../src/opencode/summarize/opencodeToolCall.ts';
import { OpencodeTurns } from '../src/opencode/summarize/opencodeTurns.ts';
import { OpencodeSessionSummarize } from '../src/opencode/summarize/opencodeSessionSummarize.ts';
import { SessionSummarizes } from '../src/opencode/summarize/sessionSummarizes.ts';
import { SummarizeText } from '../claude-mods/summarize/hooks/summarizeText.ts';
import type { SummarizeRepos } from '../claude-mods/summarize/hooks/summarizeRepos.ts';
import type { SummarizeSessionFiles } from '../claude-mods/summarize/hooks/summarizeSessionFiles.ts';
import type { IterationSummarizeEntry, IterationSummarizeScope } from '../claude-mods/summarize/types';
import type { OpencodeSessionMessage } from '../src/opencode/summarize/types.ts';

const writePart = {
  type: 'tool',
  name: 'write',
  state: { status: 'completed', input: { filePath: '/repo/a.ts', content: 'x' }, content: [{ type: 'text', text: 'Wrote file' }] },
};

const user = (id: string, text: string, created: number): OpencodeSessionMessage => ({ id, type: 'user', text, time: { created } });

const assistant = (parts: OpencodeSessionMessage['content'], completed: number): OpencodeSessionMessage => ({
  type: 'assistant',
  content: parts,
  time: { created: completed - 1, completed },
  tokens: { output: 42 },
  finish: 'stop',
});

describe('OpencodeToolCall.from()', () => {
  it('maps a finished opencode write to a Claude Write call with file_path', () => {
    expect(OpencodeToolCall.from(writePart)).toEqual({
      tool: 'Write',
      input: { filePath: '/repo/a.ts', content: 'x', file_path: '/repo/a.ts' },
      resultText: 'Wrote file',
      isError: false,
    });
  });

  it('maps skill, task and question to the names the extractor reads', () => {
    const done = (name: string, input: Record<string, unknown>) =>
      OpencodeToolCall.from({ type: 'tool', name, state: { status: 'completed', input, content: [] } });

    expect(done('skill', { name: 'code-gen' })).toMatchObject({ tool: 'Skill', input: { skill: 'code-gen' } });
    expect(done('task', { agent: 'planner' })).toMatchObject({ tool: 'Agent', input: { subagent_type: 'planner' } });
    expect(done('question', {})?.tool).toBe('AskUserQuestion');
    expect(done('custom_tool', {})?.tool).toBe('Custom_tool');
  });

  it('skips a running tool and reports an error result', () => {
    expect(OpencodeToolCall.from({ type: 'tool', name: 'bash', state: { status: 'running', input: {} } })).toBeNull();
    expect(
      OpencodeToolCall.from({ type: 'tool', name: 'bash', state: { status: 'error', input: { command: 'x' }, error: { message: 'boom' } } }),
    ).toMatchObject({ tool: 'Bash', isError: true, resultText: 'boom' });
  });
});

describe('OpencodeTurns.split()', () => {
  it('groups assistant messages under their user prompt and marks only a running last turn incomplete', () => {
    const messages = [
      user('m1', 'first', 1_000),
      assistant([writePart, { type: 'text', text: 'Done.' }], 4_000),
      user('m2', 'second', 5_000),
      assistant([{ type: 'text', text: 'Working' }], 6_000),
    ];

    const turns = OpencodeTurns.split(messages, true);

    expect(turns.map((turn) => [turn.turnId, turn.isComplete])).toEqual([
      ['m1', true],
      ['m2', false],
    ]);
    expect(turns[0]).toMatchObject({ prompt: 'first', answer: 'Done.', durationMs: 3_000, outputTokens: 42, reason: 'stop' });
    expect(turns[0]?.calls.map((call) => call.tool)).toEqual(['Write']);
  });

  it('collects attached and tool-loaded skills once', () => {
    const messages = [
      { ...user('m1', 'go', 0), skills: [{ name: 'code-gen' }] },
      assistant([{ type: 'tool', name: 'skill', state: { status: 'completed', input: { name: 'code-gen' }, content: [] } }], 10),
    ];

    expect(OpencodeTurns.split(messages, false)[0]?.skills).toEqual(['code-gen']);
  });
});

describe('SessionSummarizes.isMissingIterations()', () => {
  it('stays quiet for a transcript with only user messages', () => {
    const messages = [user('m1', 'hello', 0), user('m2', '', 1)];

    expect(SessionSummarizes.isMissingIterations(messages, 0)).toBe(false);
  });

  it('reports a session with assistant replies that recorded no iteration', () => {
    expect(SessionSummarizes.isMissingIterations([user('m1', 'a', 0), assistant([], 1)], 0)).toBe(true);
  });

  it('stays quiet once an iteration is recorded', () => {
    expect(SessionSummarizes.isMissingIterations([user('m1', 'a', 0), assistant([writePart], 1)], 1)).toBe(false);
  });
});

describe('OpencodeSessionSummarize', () => {
  const fakes = () => {
    const resolved: IterationSummarizeScope[] = [];
    const repos = {
      sessionDirectory: '/repo',
      snapshot: async () => ({ root: '/repo', state: 'before' }),
      resolve: async (entry: IterationSummarizeEntry, scope: IterationSummarizeScope) => {
        resolved.push(scope);
        return { ...entry, artifacts: { ...entry.artifacts, repos: ['repo'] } };
      },
      root: async () => null,
      headCommit: async () => null,
    } as unknown as SummarizeRepos;
    const overview = { slug: '2026-11-12-x', folder: '/repo/agent-spec/2026-11-12-x', html: '/repo/agent-spec/2026-11-12-x/session-overview.html' };
    const refreshed: number[] = [];
    const exchanges: { folder: string; prompt: string; answer: string }[] = [];
    const files = {
      answers: async () => null,
      overview: async () => overview,
      refreshOverview: async (list: readonly IterationSummarizeEntry[]) => (refreshed.push(list.length), overview),
      recordExchange: async (folder: string, prompt: string, answer: string) => void exchanges.push({ folder, prompt, answer }),
    } as unknown as SummarizeSessionFiles;
    return { summarize: new OpencodeSessionSummarize(repos, files), resolved, refreshed, overview, exchanges };
  };

  it('records history turns once, without repo lookups', async () => {
    const { summarize, resolved } = fakes();
    const turns = OpencodeTurns.split([user('m1', 'first', 0), assistant([writePart], 10)], false);

    expect(await summarize.record(turns, 20)).toBe(true);
    expect(await summarize.record(turns, 30)).toBe(false);
    expect(summarize.entries.map((entry) => entry.index)).toEqual([1]);
    expect(summarize.entries[0]?.artifacts.files).toEqual(['/repo/a.ts']);
    expect(resolved).toHaveLength(0);
  });

  it('resolves repos for the newest turn after its start was seen', async () => {
    const { summarize, resolved } = fakes();
    await summarize.noteTurnStart();

    await summarize.record(OpencodeTurns.split([user('m1', 'first', 0), assistant([writePart], 10)], false), 20);

    expect(resolved[0]).toMatchObject({ startRoot: '/repo', startState: 'before', changedDirectories: ['/repo'] });
    expect(summarize.entries[0]?.artifacts.repos).toEqual(['repo']);
  });

  it('refreshes the overview page only when a turn finished, and keeps the slug folder either way', async () => {
    const { summarize, refreshed, overview } = fakes();

    await summarize.refreshFiles(false);
    expect(summarize.overview).toEqual(overview);
    expect(refreshed).toEqual([]);

    await summarize.refreshFiles(true);
    expect(refreshed).toEqual([0]);
  });

  it('records a card for each finished turn whose prompt has a question', async () => {
    const { summarize, exchanges, overview } = fakes();
    const turns = OpencodeTurns.split(
      [user('m1', 'Which DB?', 0), assistant([writePart], 10), user('m2', 'Run the tests', 11), assistant([writePart], 20)],
      false,
    );

    await summarize.record(turns, 30);

    expect(exchanges).toEqual([{ folder: overview.folder, prompt: 'Which DB?', answer: turns[0]?.answer ?? '' }]);
  });

  it('moves the cursor with /summarize words', async () => {
    const { summarize } = fakes();
    await summarize.record(
      OpencodeTurns.split([user('m1', 'a', 0), assistant([], 1), user('m2', 'b', 2), assistant([], 3)], false),
      4,
    );

    summarize.moveCursor('1');

    expect(summarize.selected()?.index).toBe(1);
  });
});

describe('SummarizeText.commandText() label-only mode', () => {
  it('shows link labels instead of URLs', () => {
    const entry: IterationSummarizeEntry = {
      index: 1,
      turnId: 't',
      prompt: 'p',
      summary: 's',
      startedAt: 0,
      durationMs: 0,
      outputTokens: 0,
      toolCounts: {},
      endReason: 'stop',
      artifacts: {
        files: [], skills: [], repos: [], reviews: [], plans: [], commits: [], questions: [],
        changedRepos: [{ label: 'llm-hub', url: 'https://github.com/barnuri/llm-hub' }],
        pullRequests: [{ label: '#42', url: 'https://github.com/barnuri/llm-hub/pull/42' }],
      },
    };

    const head = { label: 'abc123 fix', url: 'https://github.com/barnuri/llm-hub/commit/abc123', repo: 'llm-hub' };
    const text = SummarizeText.commandText(entry, [entry], '/repo', null, false, head, true);

    expect(text).toContain('llm-hub');
    expect(text).toContain('abc123 fix');
    expect(text).not.toContain('https://');
  });
});

