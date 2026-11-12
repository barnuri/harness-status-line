import { describe, expect, it } from 'bun:test';
import { PaneOverviewOpener } from '../../src/opencode/summarize/paneOverviewOpener.ts';
import type { PaneTakeover } from '../../src/opencode/summarize/paneOverviewOpener.ts';

const HTML = '/repo/agent-spec/2026-11-12-x/session-overview.html';
const BACK = '/mods/summarize/overviewBack.js';

function opener(ui: PaneTakeover) {
  const fallbacks: string[] = [];
  const paneOpener = new PaneOverviewOpener(ui, BACK, () => ({ openOverview: async (html: string) => void fallbacks.push(html) }));
  return { paneOpener, fallbacks };
}

describe('PaneOverviewOpener.open()', () => {
  it('hands the pane to terminal-browser with the Back preload script', async () => {
    const runs: (readonly string[])[] = [];
    const { paneOpener, fallbacks } = opener({ takeover: async (argv) => (runs.push(argv), 0) });

    await paneOpener.open(HTML);

    expect(runs).toEqual([['terminal-browser', 'open', HTML, `--preload=${BACK}`]]);
    expect(fallbacks).toEqual([]);
  });

  it('shows a notice and falls back when terminal-browser fails', async () => {
    const notices: string[] = [];
    const { paneOpener, fallbacks } = opener({ takeover: async () => 1, notice: (message) => void notices.push(message) });

    await paneOpener.open(HTML);

    expect(notices[0]).toContain('exited 1');
    expect(fallbacks).toEqual([HTML]);
  });

  it('falls back when the pane cannot be taken over', async () => {
    const { paneOpener, fallbacks } = opener({});

    await paneOpener.open(HTML);

    expect(fallbacks).toEqual([HTML]);
  });
});
