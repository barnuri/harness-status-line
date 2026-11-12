import type { FileOpener } from '../../../claude-mods/summarize/hooks/fileOpener.ts';

/** The herdr-mods pane calls that can hand the pane's terminal to another program (older herdr-mods have no `takeover`). */
export interface PaneTakeover {
  takeover?(argv: readonly string[]): Promise<number>;
  notice?(message: string): void;
}

/**
 * Opens the session overview page inside the summarize pane: terminal-browser takes over the pane, and the
 * preload script's "◀ Back" button quits it, so the recap draws again. Without `takeover`, or when
 * terminal-browser fails, it falls back to the split or the OS opener.
 */
export class PaneOverviewOpener {
  private static readonly BROWSER_COMMAND = ['terminal-browser', 'open'] as const;

  constructor(
    private readonly ui: PaneTakeover,
    private readonly backScript: string,
    private readonly fallback: () => Pick<FileOpener, 'openOverview'>,
  ) {}

  async open(html: string): Promise<void> {
    if (this.ui.takeover !== undefined) {
      const exitCode = await this.ui.takeover([...PaneOverviewOpener.BROWSER_COMMAND, html, `--preload=${this.backScript}`]);
      if (exitCode === 0) {
        return;
      }
      this.ui.notice?.(`terminal-browser exited ${exitCode}, opening the overview outside the pane`);
    }
    await this.fallback().openOverview(html);
  }
}
