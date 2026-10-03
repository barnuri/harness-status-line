import { describe, expect, it } from 'bun:test';
import { IterationRecorder } from '../../claude-mods/iteration-recap/hooks/iterationRecorder.ts';

const end = (turnId: string, answer: string) => ({ turnId, answer, durationMs: 4200, reason: 'answer', outputTokens: 900 });

describe('IterationRecorder', () => {
  it('turns a started turn and its tool calls into an iteration', () => {
    const recorder = new IterationRecorder();
    recorder.start('t1', '  fix the login bug  ', 1000);
    recorder.record('Edit', { file_path: '/repo/login.ts' }, 'ok', false);
    recorder.record('Bash', { command: 'bun test' }, 'pass', false);
    recorder.record('Bash', { command: 'bun test' }, 'pass', false);

    const entry = recorder.finish(end('t1', 'Fixed the redirect loop. Tests pass.'), 3, 5200);

    expect(entry).toMatchObject({
      index: 3,
      turnId: 't1',
      prompt: 'fix the login bug',
      summary: 'Fixed the redirect loop.',
      isSummaryFromModel: false,
      startedAt: 1000,
      durationMs: 4200,
      outputTokens: 900,
      toolCounts: { Edit: 1, Bash: 2 },
      endReason: 'answer',
    });
    expect(entry?.artifacts.files).toEqual(['/repo/login.ts']);
  });

  it('ignores tool calls before any turn started', () => {
    const recorder = new IterationRecorder();
    recorder.record('Bash', { command: 'ls' }, '', false);

    expect(recorder.toolCalls).toHaveLength(0);
  });

  it('returns null for an empty turn', () => {
    const recorder = new IterationRecorder();

    expect(recorder.finish(end('t9', '   '), 1, 0)).toBeNull();
  });

  it('records a turn it did not see start without its prompt', () => {
    const recorder = new IterationRecorder();
    recorder.start('t1', 'first', 0);

    const entry = recorder.finish(end('t2', 'Continued work.'), 2, 10_000);

    expect(entry?.prompt).toBe('');
    expect(entry?.startedAt).toBe(5800);
  });

  it('caps stored tool output', () => {
    const recorder = new IterationRecorder();
    recorder.start('t1', 'x', 0);
    recorder.record('Bash', { command: 'cat big' }, 'y'.repeat(10_000), false);

    expect(recorder.toolCalls[0]?.resultText).toHaveLength(4000);
  });
});
