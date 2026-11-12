import type { RecapHost } from './recapHost'

/**
 * Appends errors to `~/.claude/mod-errors/summarize.jsonl` (newest lines kept), so an audit can find
 * and fix them, instead of printing them into the transcript.
 */
export class RecapErrorLog {
  private static readonly PLUGIN = 'summarize'
  private static readonly ERROR_LOG = '.claude/mod-errors/summarize.jsonl'
  private static readonly MAX_ERROR_LINES = 500

  public constructor(private readonly host: RecapHost) {}

  public static describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  public async log(text: string): Promise<void> {
    try {
      const home = await this.host.home()
      if (home === undefined) {
        return
      }
      const path = `${home}/${RecapErrorLog.ERROR_LOG}`
      const previous = (await this.host.exists(path)) ? await this.host.read(path) : ''
      const line = JSON.stringify({ ts: new Date(await this.host.now()).toISOString(), plugin: RecapErrorLog.PLUGIN, error: text })
      const lines = [...previous.split('\n').filter(entry => entry !== ''), line].slice(-RecapErrorLog.MAX_ERROR_LINES)
      await this.host.write(path, `${lines.join('\n')}\n`)
    } catch {
      // Logging must never break the mod.
    }
  }
}
