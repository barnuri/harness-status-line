import { OverviewFacts } from './overviewFacts'
import { OverviewReader } from './overviewReader'
import { RecapErrorLog } from './recapErrorLog'

import type { RecapHost } from './recapHost'
import type { RecapRepos } from './recapRepos'
import type { IterationRecapEntry, IterationRecapLink, SessionAnswers } from '../types'

/** The session's `agent-spec/<slug>/` folder: its `overview.md` answers, `overview-facts.json` and overview page. */
export class RecapSessionFiles {
  private static readonly SLUG_DIRECTORY = '.claude/session-slugs'
  private static readonly OVERVIEW_FACTS_FILE = 'overview-facts.json'
  private static readonly SESSION_OVERVIEW_SCRIPT = '.agents/skills/session-overview/scripts/render_overview.py'
  private static readonly RENDER_TIMEOUT_MS = 10000
  private static readonly OPEN_TIMEOUT_MS = 3000

  public constructor(
    private readonly host: RecapHost,
    private readonly repos: RecapRepos,
    private readonly errors: RecapErrorLog,
  ) {}

  /** The session's Q&A from the published `overview.md`, else the newest one the session wrote. Null when none exists. */
  public async answers(list: readonly IterationRecapEntry[]): Promise<SessionAnswers | null> {
    const path = (await this.publishedOverviewPath(list)) ?? (await this.sessionAnswersPath(list))
    if (path === null) {
      return null
    }
    try {
      return OverviewReader.parse(await this.host.read(path), path)
    } catch (error) {
      void this.errors.log(`answers read failed for ${path}: ${RecapErrorLog.describe(error)}`)

      return null
    }
  }

  /**
   * The folder `agent-spec/<slug>/` the session-slug skill published for this session, in the session
   * repo or a repo the session edited. Null when the session published none.
   */
  public async publishedSlugFolder(list: readonly IterationRecapEntry[]): Promise<string | null> {
    try {
      const home = await this.host.home()
      if (home === undefined) {
        return null
      }
      const slugFile = `${home}/${RecapSessionFiles.SLUG_DIRECTORY}/${await this.host.sessionId()}`
      if (!(await this.host.exists(slugFile))) {
        return null
      }
      const slug = (await this.host.read(slugFile)).trim()
      if (slug === '') {
        return null
      }
      const editedDirectories = list.flatMap(entry => entry.artifacts.files).map(file => file.slice(0, file.lastIndexOf('/')))
      const roots = await this.repos.roots([this.repos.sessionDirectory, ...new Set(editedDirectories)])
      for (const root of roots) {
        const folder = `${root}/agent-spec/${slug}`
        if (await this.host.exists(folder)) {
          return folder
        }
      }

      return null
    } catch (error) {
      void this.errors.log(`published slug lookup failed: ${RecapErrorLog.describe(error)}`)

      return null
    }
  }

  /**
   * Writes `overview-facts.json` into `folder`, built from the iterations and the session HEAD. Returns
   * false after logging the error when the write fails.
   */
  public async writeOverviewFacts(folder: string, list: readonly IterationRecapEntry[], sessionHead: IterationRecapLink | null): Promise<boolean> {
    try {
      const document = OverviewFacts.build({
        slug: folder.slice(folder.lastIndexOf('/') + 1),
        sessionId: await this.host.sessionId(),
        cwd: await this.host.cwd(),
        iterations: list,
        sessionHead,
      })
      await this.host.write(`${folder}/${RecapSessionFiles.OVERVIEW_FACTS_FILE}`, OverviewFacts.serialize(document))

      return true
    } catch (error) {
      void this.errors.log(`overview facts write failed for ${folder}: ${RecapErrorLog.describe(error)}`)

      return false
    }
  }

  /** Writes the facts, renders `session-overview.html` in the slug folder, and opens it. Returns a one-line status. */
  public async renderOverview(list: readonly IterationRecapEntry[], sessionHead: IterationRecapLink | null): Promise<string> {
    const folder = await this.publishedSlugFolder(list)
    if (folder === null) {
      return 'No published slug folder for this session.'
    }
    if (!(await this.writeOverviewFacts(folder, list, sessionHead))) {
      return 'Overview not written.'
    }
    const script = await this.overviewScript()
    if (script === null) {
      return 'session-overview skill not installed.'
    }
    try {
      const { exitCode, stdout, stderr } = await this.host.run(['python3', '-I', script, folder], { timeoutMs: RecapSessionFiles.RENDER_TIMEOUT_MS })
      const html = stdout.trim()
      if (exitCode !== 0 || html === '') {
        void this.errors.log(`render_overview exited ${exitCode} for ${folder}: ${stderr.trim()}`)

        return 'Overview not written.'
      }
      await this.openFile(html)

      return `Overview: ${html}`
    } catch (error) {
      void this.errors.log(`render_overview failed for ${folder}: ${RecapErrorLog.describe(error)}`)

      return 'Overview not written.'
    }
  }

  /** Opens a file with the OS default app (`open` on macOS, `xdg-open` elsewhere). */
  public async openFile(path: string): Promise<void> {
    try {
      const opener = (await this.host.osType())?.startsWith('darwin') === false ? 'xdg-open' : 'open'
      await this.host.run([opener, path], { timeoutMs: RecapSessionFiles.OPEN_TIMEOUT_MS })
    } catch (error) {
      void this.errors.log(`open failed for ${path}: ${RecapErrorLog.describe(error)}`)
    }
  }

  /** The newest `overview.md` the session wrote or rendered that exists on disk. */
  private async sessionAnswersPath(list: readonly IterationRecapEntry[]): Promise<string | null> {
    const paths = list
      .flatMap(entry => [...entry.artifacts.files, ...(entry.artifacts.overviewFiles ?? [])])
      .filter(path => OverviewReader.slugOf(path) !== null)
    for (const path of [...new Set(paths)].reverse()) {
      if (await this.host.exists(path).catch(() => false)) {
        return path
      }
    }

    return null
  }

  /** The `overview.md` of the published slug folder, when that file exists. */
  private async publishedOverviewPath(list: readonly IterationRecapEntry[]): Promise<string | null> {
    const folder = await this.publishedSlugFolder(list)
    if (folder === null) {
      return null
    }
    const path = `${folder}/${OverviewReader.FILE_NAME}`

    return (await this.host.exists(path)) ? path : null
  }

  /** The session-overview renderer under `~/.agents/skills`, or null when the skill is not installed. */
  private async overviewScript(): Promise<string | null> {
    const home = await this.host.home()
    if (home === undefined) {
      return null
    }
    const script = `${home}/${RecapSessionFiles.SESSION_OVERVIEW_SCRIPT}`

    return (await this.host.exists(script)) ? script : null
  }
}
