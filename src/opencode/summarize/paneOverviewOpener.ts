import type { FileOpener } from '../../../claude-mods/summarize/hooks/fileOpener.ts';

/** The herdr-mods pane calls that can hand the pane's terminal to another program (older herdr-mods have no `takeover`). */
export interface PaneTakeover {
  takeover?(argv: readonly string[]): Promise<number>;
  notice?(message: string): void;
}

/**
 * Opens the session overview page. Inside the summarize pane, terminal-browser takes over the pane only for a
 * focused phone viewer, and the preload script's "◀ Back" button quits it. Otherwise, or when that fails, the
 * fallback opens the page with the OS browser (or the split, when a phone viewer is focused).
 */
export class PaneOverviewOpener {
  private static readonly BROWSER_COMMAND = ['terminal-browser', 'open'] as const;

  constructor(
    private readonly ui: PaneTakeover,
    private readonly backScript: string,
    private readonly isMobileFocused: () => Promise<boolean>,
    private readonly fallback: () => Pick<FileOpener, 'openOverview'>,
  ) {}

  async open(html: string): Promise<void> {
    if (this.ui.takeover !== undefined && (await this.isMobileFocused())) {
      const exitCode = await this.ui.takeover([...PaneOverviewOpener.BROWSER_COMMAND, html, `--preload=${this.backScript}`]);
      if (exitCode === 0) {
        return;
      }
      this.ui.notice?.(`terminal-browser exited ${exitCode}, opening the overview outside the pane`);
    }
    await this.fallback().openOverview(html);
  }
}

