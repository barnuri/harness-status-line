import { RecapErrorLog } from './recapErrorLog'

import type { RecapHost } from './recapHost'

/** Opens files with the OS opener, and the session overview page in a terminal-browser split inside herdr. */
export class FileOpener {
  private static readonly OPEN_TIMEOUT_MS = 3000
  private static readonly BROWSER_TIMEOUT_MS = 20000
  private static readonly BROWSER_COMMAND = ['terminal-browser', 'open'] as const
  private static readonly BROWSER_SPLIT = ['--split', 'down', '--size', '0.6'] as const

  public constructor(
    private readonly host: Pick<RecapHost, 'run' | 'isInsideHerdr' | 'osType'>,
    private readonly errors: RecapErrorLog,
  ) {}

  /** Opens a file with the OS default app (`open` on macOS, `xdg-open` elsewhere). */
  public async openFile(path: string): Promise<void> {
    try {
      const opener = (await this.host.osType())?.startsWith('darwin') === false ? 'xdg-open' : 'open'
      await this.host.run([opener, path], { timeoutMs: FileOpener.OPEN_TIMEOUT_MS })
    } catch (error) {
      void this.errors.log(`open failed for ${path}: ${RecapErrorLog.describe(error)}`)
    }
  }

  /** Inside herdr, opens the page in a terminal-browser split below the pane; elsewhere, or when that fails, with the OS opener. */
  public async openOverview(html: string): Promise<void> {
    if ((await this.host.isInsideHerdr()) && (await this.openInTerminalBrowser(html))) {
      return
    }
    await this.openFile(html)
  }

  private async openInTerminalBrowser(html: string): Promise<boolean> {
    try {
      const { exitCode, stderr } = await this.host.run([...FileOpener.BROWSER_COMMAND, html, ...FileOpener.BROWSER_SPLIT], { timeoutMs: FileOpener.BROWSER_TIMEOUT_MS })
      if (exitCode === 0) {
        return true
      }
      void this.errors.log(`terminal-browser exited ${exitCode} for ${html}: ${stderr.trim()}`)

      return false
    } catch (error) {
      void this.errors.log(`terminal-browser failed for ${html}: ${RecapErrorLog.describe(error)}`)

      return false
    }
  }
}
