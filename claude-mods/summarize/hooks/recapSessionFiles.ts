import { FileOpener } from './fileOpener'
import { OverviewFacts } from './overviewFacts'
import { OverviewReader } from './overviewReader'
import { RecapErrorLog } from './recapErrorLog'

import type { RecapHost } from './recapHost'
import type { RecapRepos } from './recapRepos'
import type { IterationRecapEntry, IterationRecapLink, SessionAnswers, SessionOverview } from '../types'

/** The session's `agent-spec/<slug>/` folder: its `overview.md` answers, `overview-facts.json` and overview page. */
export class RecapSessionFiles {
  private static readonly SLUG_DIRECTORY = '.claude/session-slugs'
  /** Holds the absolute `agent-spec/<slug>` folder the session-slug skill resolved, one file per session id. */
  private static readonly SLUG_FOLDER_DIRECTORY = '.claude/session-slug-folders'
  private static readonly OVERVIEW_FACTS_FILE = 'overview-facts.json'
  private static readonly OVERVIEW_HTML_FILE = 'session-overview.html'
  private static readonly SESSION_OVERVIEW_SCRIPT = '.agents/skills/session-overview/scripts/render_overview.py'
  private static readonly RENDER_TIMEOUT_MS = 10000
  private static readonly SLUG_FOLDER = /^(.*\/agent-spec\/[^/]+)\/[^/]+$/

  private readonly opener: FileOpener

  public constructor(
    private readonly host: RecapHost,
    private readonly repos: RecapRepos,
    private readonly errors: RecapErrorLog,
  ) {
    this.opener = new FileOpener(host, errors)
  }

  /**
   * The session's slug folder: the one session-slug published, else the `agent-spec/<slug>/` folder of
   * the newest file the session wrote there. Null when neither exists.
   */
  public async overview(list: readonly IterationRecapEntry[]): Promise<SessionOverview | null> {
    const folder = (await this.publishedSlugFolder(list)) ?? (await this.writtenSlugFolder(list))
    if (folder === null) {
      return null
    }

    return { slug: folder.slice(folder.lastIndexOf('/') + 1), folder, html: `${folder}/${RecapSessionFiles.OVERVIEW_HTML_FILE}` }
  }

  /** At a turn end: writes `overview-facts.json` and renders `session-overview.html` in the slug folder. */
  public async refreshOverview(list: readonly IterationRecapEntry[], sessionHead: IterationRecapLink | null): Promise<SessionOverview | null> {
    const overview = await this.overview(list)
    if (overview !== null && (await this.writeOverviewFacts(overview.folder, list, sessionHead))) {
      await this.render(overview.folder)
    }

    return overview
  }

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
      const folder = await this.recordedSlugFolder(home)
      if (folder !== null) {
        return folder
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

  /** The folder the session-slug skill recorded for this session, when it still exists. */
  private async recordedSlugFolder(home: string): Promise<string | null> {
    const folderFile = `${home}/${RecapSessionFiles.SLUG_FOLDER_DIRECTORY}/${await this.host.sessionId()}`
    if (!(await this.host.exists(folderFile))) {
      return null
    }
    const folder = (await this.host.read(folderFile)).trim()
    return folder !== '' && (await this.host.exists(folder)) ? folder : null
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
    const overview = await this.overview(list)
    if (overview === null) {
      return 'No slug folder for this session.'
    }
    if (!(await this.writeOverviewFacts(overview.folder, list, sessionHead))) {
      return 'Overview not written.'
    }
    const html = await this.render(overview.folder)
    if (html === null) {
      return 'Overview not written.'
    }
    await this.opener.openOverview(html)

    return `Overview: ${html}`
  }

  /** Opens a file with the OS default app. */
  public async openFile(path: string): Promise<void> {
    await this.opener.openFile(path)
  }

  /** Opens the overview page, in a terminal-browser split when inside herdr. */
  public async openOverview(html: string): Promise<void> {
    await this.opener.openOverview(html)
  }

  /** Runs the session-overview renderer on `folder`. Returns the html path, or null after logging why it failed. */
  private async render(folder: string): Promise<string | null> {
    const script = await this.overviewScript()
    if (script === null) {
      void this.errors.log('session-overview skill not installed.')

      return null
    }
    try {
      const { exitCode, stdout, stderr } = await this.host.run(['python3', '-I', script, folder], { timeoutMs: RecapSessionFiles.RENDER_TIMEOUT_MS })
      const html = stdout.trim()
      if (exitCode !== 0 || html === '') {
        void this.errors.log(`render_overview exited ${exitCode} for ${folder}: ${stderr.trim()}`)

        return null
      }

      return html
    } catch (error) {
      void this.errors.log(`render_overview failed for ${folder}: ${RecapErrorLog.describe(error)}`)

      return null
    }
  }

  /** The `agent-spec/<slug>/` folder of the newest file the session wrote or rendered there that still exists. */
  private async writtenSlugFolder(list: readonly IterationRecapEntry[]): Promise<string | null> {
    const folders = list
      .flatMap(entry => [...entry.artifacts.files, ...(entry.artifacts.overviewFiles ?? [])])
      .map(path => RecapSessionFiles.SLUG_FOLDER.exec(path)?.[1])
      .filter((folder): folder is string => folder !== undefined)
    for (const folder of [...new Set(folders)].reverse()) {
      if (await this.host.exists(folder).catch(() => false)) {
        return folder
      }
    }

    return null
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
