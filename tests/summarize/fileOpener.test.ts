import { describe, expect, it } from 'bun:test';
import { FileOpener } from '../../claude-mods/summarize/hooks/fileOpener.ts';
import type { RecapErrorLog } from '../../claude-mods/summarize/hooks/recapErrorLog.ts';

const HTML = '/repo/agent-spec/2026-11-12-x/session-overview.html';

function opener(isInsideHerdr: boolean, browserExitCode: number) {
  const runs: string[][] = [];
  const logged: string[] = [];
  const host = {
    run: async (argv: readonly string[]) => {
      runs.push([...argv]);
      return { exitCode: argv[0] === 'terminal-browser' ? browserExitCode : 0, stdout: '', stderr: 'no tty' };
    },
    isInsideHerdr: async () => isInsideHerdr,
    osType: async () => 'darwin',
  };
  const errors = { log: async (text: string) => void logged.push(text) } as unknown as RecapErrorLog;
  return { fileOpener: new FileOpener(host, errors), runs, logged };
}

describe('FileOpener.openOverview()', () => {
  it('opens a terminal-browser split below the pane inside herdr', async () => {
    const { fileOpener, runs } = opener(true, 0);

    await fileOpener.openOverview(HTML);

    expect(runs).toEqual([['terminal-browser', 'open', HTML, '--split', 'down', '--size', '0.6']]);
  });

  it('falls back to the OS opener and logs when terminal-browser fails', async () => {
    const { fileOpener, runs, logged } = opener(true, 1);

    await fileOpener.openOverview(HTML);

    expect(runs.at(-1)).toEqual(['open', HTML]);
    expect(logged[0]).toContain('terminal-browser exited 1');
  });

  it('uses the OS opener outside herdr', async () => {
    const { fileOpener, runs } = opener(false, 0);

    await fileOpener.openOverview(HTML);

    expect(runs).toEqual([['open', HTML]]);
  });
});
