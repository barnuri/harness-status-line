import type { RecapHost } from './recapHost'

export type ViewerRouteHost = Pick<RecapHost, 'run' | 'read' | 'now' | 'home'> & { env(name: string): Promise<string | undefined> }

/** Decides whether a link opens in the herdr pane: a phone herdr-web client is attached and this pane is focused. */
export class ViewerRoute {
  private static readonly STATE_FILE = 'mobile-viewer.json'
  private static readonly STATE_RELATIVE_DIRECTORY = ['.local', 'state', 'herdr-web'] as const
  private static readonly FRESH_MS = 90_000
  private static readonly SNAPSHOT_TIMEOUT_MS = 5000
  private static readonly SNAPSHOT_COMMAND = ['herdr', 'api', 'snapshot'] as const

  public constructor(private readonly host: ViewerRouteHost) {}

  /** True when a fresh mobile-attached state exists and this pane is the focused herdr pane. */
  public async isMobilePanelFocused(): Promise<boolean> {
    if (!(await this.isMobileAttached())) {
      return false
    }
    return this.isThisPaneFocused()
  }

  private async isMobileAttached(): Promise<boolean> {
    try {
      const state: unknown = JSON.parse(await this.host.read(await this.stateFile()))
      if (!ViewerRoute.isRecord(state) || typeof state.mobileAttached !== 'number' || typeof state.updatedAt !== 'string') {
        return false
      }
      const updated = Date.parse(state.updatedAt)
      if (Number.isNaN(updated) || state.mobileAttached <= 0) {
        return false
      }
      const age = (await this.host.now()) - updated
      return age >= 0 && age <= ViewerRoute.FRESH_MS
    } catch {
      return false
    }
  }

  private async stateFile(): Promise<string> {
    const directory = await this.host.env('HERDR_PLUGIN_STATE_DIR')
    if (directory) {
      return `${directory}/${ViewerRoute.STATE_FILE}`
    }
    return [(await this.host.home()) ?? '', ...ViewerRoute.STATE_RELATIVE_DIRECTORY, ViewerRoute.STATE_FILE].join('/')
  }

  private async isThisPaneFocused(): Promise<boolean> {
    try {
      const paneId = await this.host.env('HERDR_PANE_ID')
      if (!paneId) {
        return false
      }
      const { exitCode, stdout } = await this.host.run(ViewerRoute.SNAPSHOT_COMMAND, { timeoutMs: ViewerRoute.SNAPSHOT_TIMEOUT_MS })
      if (exitCode !== 0) {
        return false
      }
      const parsed: unknown = JSON.parse(stdout)
      const focused = ViewerRoute.isRecord(parsed) && ViewerRoute.isRecord(parsed.result) && ViewerRoute.isRecord(parsed.result.snapshot)
        ? parsed.result.snapshot.focused_pane_id
        : undefined
      return focused === paneId
    } catch {
      return false
    }
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }
}
