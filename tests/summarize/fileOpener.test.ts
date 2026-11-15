import { describe, expect, it } from 'bun:test';
import { FileOpener } from '../../claude-mods/summarize/hooks/fileOpener.ts';
import type { RecapErrorLog } from '../../claude-mods/summarize/hooks/recapErrorLog.ts';

const HTML = '/repo/agent-spec/2026-11-12-x/session-overview.html';

function opener(isInsideHerdr: boolean, mobileFocused: boolean, browserExitCode: number) {
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
  const route = { isMobilePanelFocused: async () => mobileFocused };
  return { fileOpener: new FileOpener(host, errors, route), runs, logged };
}

describe('FileOpener.openOverview()', () => {
  it('opens a terminal-browser split only for a focused phone viewer inside herdr', async () => {
    const { fileOpener, runs } = opener(true, true, 0);

    await fileOpener.openOverview(HTML);

    expect(runs).toEqual([['terminal-browser', 'open', HTML, '--split', 'down', '--size', '0.6']]);
  });

  it('opens the OS browser inside herdr when no phone viewer is focused', async () => {
    const { fileOpener, runs } = opener(true, false, 0);

    await fileOpener.openOverview(HTML);

    expect(runs).toEqual([['open', HTML]]);
  });

  it('falls back to the OS opener and logs when terminal-browser fails', async () => {
    const { fileOpener, runs, logged } = opener(true, true, 1);

    await fileOpener.openOverview(HTML);

    expect(runs.at(-1)).toEqual(['open', HTML]);
    expect(logged[0]).toContain('terminal-browser exited 1');
  });

  it('uses the OS opener outside herdr', async () => {
    const { fileOpener, runs } = opener(false, true, 0);

    await fileOpener.openOverview(HTML);

    expect(runs).toEqual([['open', HTML]]);
  });
});

const URL_LINK = 'https://github.com/acme/repo/pull/12';

function linkOpener(isInsideHerdr: boolean, mobileFocused: boolean, browserExitCode: number) {
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
  const route = { isMobilePanelFocused: async () => mobileFocused };
  return { fileOpener: new FileOpener(host, errors, route), runs, logged };
}

describe('FileOpener.openLink()', () => {
  it('opens the link in a terminal-browser split when a mobile viewer is focused inside herdr', async () => {
    const { fileOpener, runs } = linkOpener(true, true, 0);

    await fileOpener.openLink(URL_LINK);

    expect(runs).toEqual([['terminal-browser', 'open', URL_LINK, '--split', 'down', '--size', '0.6']]);
  });

  it('uses the OS opener when no mobile viewer is focused', async () => {
    const { fileOpener, runs } = linkOpener(true, false, 0);

    await fileOpener.openLink(URL_LINK);

    expect(runs).toEqual([['open', URL_LINK]]);
  });

  it('uses the OS opener outside herdr', async () => {
    const { fileOpener, runs } = linkOpener(false, true, 0);

    await fileOpener.openLink(URL_LINK);

    expect(runs).toEqual([['open', URL_LINK]]);
  });

  it('falls back to the OS opener and logs when terminal-browser fails', async () => {
    const { fileOpener, runs, logged } = linkOpener(true, true, 1);

    await fileOpener.openLink(URL_LINK);

    expect(runs.at(-1)).toEqual(['open', URL_LINK]);
    expect(logged[0]).toContain('terminal-browser exited 1');
  });

  it('keeps file paths on the OS opener even when a mobile viewer is focused', async () => {
    const { fileOpener, runs } = linkOpener(true, true, 0);

    await fileOpener.openFile(HTML);

    expect(runs).toEqual([['open', HTML]]);
  });
});
