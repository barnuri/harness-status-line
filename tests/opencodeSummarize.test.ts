import { describe, expect, it } from 'bun:test';
import { OpencodeToolCall } from '../src/opencode/summarize/opencodeToolCall.ts';
import { OpencodeTurns } from '../src/opencode/summarize/opencodeTurns.ts';
import { OpencodeSessionRecap } from '../src/opencode/summarize/opencodeSessionRecap.ts';
import { RecapText } from '../claude-mods/summarize/hooks/recapText.ts';
import type { RecapRepos } from '../claude-mods/summarize/hooks/recapRepos.ts';
import type { RecapSessionFiles } from '../claude-mods/summarize/hooks/recapSessionFiles.ts';
import type { IterationRecapEntry, IterationRecapScope } from '../claude-mods/summarize/types';
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

describe('OpencodeSessionRecap', () => {
  const fakes = () => {
    const resolved: IterationRecapScope[] = [];
    const repos = {
      sessionDirectory: '/repo',
      snapshot: async () => ({ root: '/repo', state: 'before' }),
      resolve: async (entry: IterationRecapEntry, scope: IterationRecapScope) => {
        resolved.push(scope);
        return { ...entry, artifacts: { ...entry.artifacts, repos: ['repo'] } };
      },
      root: async () => null,
      headCommit: async () => null,
    } as unknown as RecapRepos;
    const files = { publishedSlugFolder: async () => null, answers: async () => null } as unknown as RecapSessionFiles;
    return { recap: new OpencodeSessionRecap(repos, files), resolved };
  };

  it('records history turns once, without repo lookups', async () => {
    const { recap, resolved } = fakes();
    const turns = OpencodeTurns.split([user('m1', 'first', 0), assistant([writePart], 10)], false);

    expect(await recap.record(turns, 20)).toBe(true);
    expect(await recap.record(turns, 30)).toBe(false);
    expect(recap.entries.map((entry) => entry.index)).toEqual([1]);
    expect(recap.entries[0]?.artifacts.files).toEqual(['/repo/a.ts']);
    expect(resolved).toHaveLength(0);
  });

  it('resolves repos for the newest turn after its start was seen', async () => {
    const { recap, resolved } = fakes();
    await recap.noteTurnStart();

    await recap.record(OpencodeTurns.split([user('m1', 'first', 0), assistant([writePart], 10)], false), 20);

    expect(resolved[0]).toMatchObject({ startRoot: '/repo', startState: 'before', changedDirectories: ['/repo'] });
    expect(recap.entries[0]?.artifacts.repos).toEqual(['repo']);
  });

  it('moves the cursor with /summarize words', async () => {
    const { recap } = fakes();
    await recap.record(
      OpencodeTurns.split([user('m1', 'a', 0), assistant([], 1), user('m2', 'b', 2), assistant([], 3)], false),
      4,
    );

    recap.moveCursor('1');

    expect(recap.selected()?.index).toBe(1);
  });
});

describe('RecapText.commandText() label-only mode', () => {
  it('shows link labels instead of URLs', () => {
    const entry: IterationRecapEntry = {
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
    const text = RecapText.commandText(entry, [entry], '/repo', null, false, head, true);

    expect(text).toContain('llm-hub');
    expect(text).toContain('abc123 fix');
    expect(text).not.toContain('https://');
  });
});

