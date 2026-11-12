import { ArtifactExtractor } from './artifactExtractor'
import { GitFacts } from './gitFacts'
import { RecapErrorLog } from './recapErrorLog'
import { RepoLink } from './repoLink'

import type { RecapHost } from './recapHost'
import type { IterationRecapEntry, IterationRecapLink, IterationRecapScope } from '../types'

/** Git and `gh` lookups for the repos a session touched. Every call is bounded by a timeout. */
export class RecapRepos {
  private static readonly MAX_REPO_LOOKUPS = 8
  private static readonly GIT_TIMEOUT_MS = 3000
  private static readonly GH_TIMEOUT_MS = 5000
  private static readonly MS_PER_SECOND = 1000
  private static readonly COMMIT_CLOCK_SLACK_SECONDS = 5
  private static readonly MAX_TURN_COMMITS = 20
  private static readonly DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'HEAD'])
  private static readonly GIT_STATE_COMMANDS = [['rev-parse', 'HEAD'], ['status', '--porcelain'], ['diff', 'HEAD', '--numstat']] as const

  public constructor(
    private readonly host: RecapHost,
    private readonly errors: RecapErrorLog,
    private readonly branchPullRequests: Map<string, IterationRecapLink>,
    public readonly sessionDirectory: string,
  ) {}

  public static repoName(root: string): string {
    return root.split('/').at(-1) ?? root
  }

  public async root(directory: string): Promise<string | null> {
    try {
      const { exitCode, stdout } = await this.host.run(['git', '-C', directory, 'rev-parse', '--show-toplevel'], { timeoutMs: RecapRepos.GIT_TIMEOUT_MS })

      return exitCode === 0 && stdout.trim() !== '' ? stdout.trim() : null
    } catch (error) {
      void this.errors.log(`git lookup failed for ${directory}: ${RecapErrorLog.describe(error)}`)

      return null
    }
  }

  public async roots(directories: readonly string[]): Promise<string[]> {
    const roots = await Promise.all(directories.slice(0, RecapRepos.MAX_REPO_LOOKUPS).map(directory => this.root(directory)))

    return [...new Set(roots.filter((root): root is string => root !== null))]
  }

  public async snapshot(): Promise<{ root: string | null; state: string | null }> {
    const root = await this.root(this.sessionDirectory)

    return { root, state: root === null ? null : await this.state(root) }
  }

  /** The current HEAD commit of `root`, whoever made it, as `abc123 message` linking to its page; `repo` names the repo. */
  public async headCommit(root: string): Promise<IterationRecapLink | null> {
    try {
      const [log, remote] = await Promise.all([
        this.output(root, ['log', '-1', '--format=%H%x09%s', 'HEAD']),
        this.output(root, ['remote', 'get-url', 'origin']),
      ])
      const link = GitFacts.commitLinks(log, RepoLink.fromRoot(root, remote).url)[0]

      return link === undefined ? null : { ...link, repo: RecapRepos.repoName(root) }
    } catch (error) {
      void this.errors.log(`head commit lookup failed for ${root}: ${RecapErrorLog.describe(error)}`)

      return null
    }
  }

  public async resolve(entry: IterationRecapEntry, scope: IterationRecapScope): Promise<IterationRecapEntry> {
    try {
      const [touchedRoots, changedRoots, isSessionRepoChanged] = await Promise.all([
        this.roots(scope.touchedDirectories),
        this.roots(scope.changedDirectories),
        this.isChangedSince(scope.startRoot, scope.startState),
      ])
      const allChangedRoots = isSessionRepoChanged && scope.startRoot !== null ? [scope.startRoot, ...changedRoots] : changedRoots
      const repos = [...new Set([...[...allChangedRoots, ...touchedRoots].map(RecapRepos.repoName), ...entry.artifacts.repos])]
      const uniqueChangedRoots = [...new Set(allChangedRoots)]
      const prRoots = [...new Set([...uniqueChangedRoots, ...touchedRoots, ...(scope.startRoot === null ? [] : [scope.startRoot])])]
      const [rootLinks, branchLinks, commitLinks, headLinks] = await Promise.all([
        this.links(uniqueChangedRoots),
        Promise.all(prRoots.map(root => this.branchPullRequest(root))),
        Promise.all(uniqueChangedRoots.map(root => this.defaultBranchCommits(root, entry.startedAt))),
        Promise.all(prRoots.map(root => this.headCommit(root))),
      ])
      const changedRepos = RepoLink.unique([...rootLinks, ...ArtifactExtractor.createdPullRequestRepos(entry.artifacts)])
      const knownLabels = new Set(entry.artifacts.pullRequests.map(link => link.label))
      const branchPrs = branchLinks.filter((link): link is IterationRecapLink => link !== null && !knownLabels.has(link.label))

      return {
        ...entry,
        artifacts: { ...entry.artifacts, repos, changedRepos, pullRequests: [...entry.artifacts.pullRequests, ...branchPrs], commitLinks: commitLinks.flat(),
          headCommits: headLinks.filter((link): link is IterationRecapLink => link !== null) },
      }
    } catch (error) {
      void this.errors.log(`repo lookup failed for iteration ${entry.index}: ${RecapErrorLog.describe(error)}`)

      return { ...entry, artifacts: { ...entry.artifacts, changedRepos: ArtifactExtractor.createdPullRequestRepos(entry.artifacts) } }
    }
  }

  private async output(root: string, args: readonly string[]): Promise<string> {
    const { exitCode, stdout } = await this.host.run(['git', '-C', root, ...args], { timeoutMs: RecapRepos.GIT_TIMEOUT_MS })

    return exitCode === 0 ? stdout : ''
  }

  private async state(root: string): Promise<string | null> {
    try {
      const parts = await Promise.all(RecapRepos.GIT_STATE_COMMANDS.map(args => this.output(root, args)))

      return parts.join('\n')
    } catch (error) {
      void this.errors.log(`git state failed for ${root}: ${RecapErrorLog.describe(error)}`)

      return null
    }
  }

  private async isChangedSince(root: string | null, startState: string | null): Promise<boolean> {
    if (root === null || startState === null) {
      return false
    }

    return (await this.state(root)) !== startState
  }

  private async links(roots: readonly string[]): Promise<IterationRecapLink[]> {
    return Promise.all(roots.map(async root => RepoLink.fromRoot(root, await this.output(root, ['remote', 'get-url', 'origin']))))
  }

  private async branchPullRequest(root: string): Promise<IterationRecapLink | null> {
    const branch = (await this.output(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (branch === '' || RecapRepos.DEFAULT_BRANCHES.has(branch)) {
      return null
    }
    const key = `${root}@${branch}`
    const known = this.branchPullRequests.get(key)
    if (known !== undefined) {
      return known
    }
    try {
      const { exitCode, stdout } = await this.host.run(['gh', 'pr', 'view', branch, '--json', 'number,url'], { cwd: root, timeoutMs: RecapRepos.GH_TIMEOUT_MS })
      const link = exitCode === 0 ? GitFacts.branchPullRequest(stdout) : null
      if (link !== null) {
        this.branchPullRequests.set(key, link)
      }

      return link
    } catch (error) {
      void this.errors.log(`gh pr view failed for ${root}: ${RecapErrorLog.describe(error)}`)

      return null
    }
  }

  /**
   * Commits made on a default branch of `root` since `sinceMs`, as `abc123 message` links to the
   * commit page. Feature branches are skipped: their work shows as a PR.
   */
  private async defaultBranchCommits(root: string, sinceMs: number): Promise<IterationRecapLink[]> {
    try {
      const branch = (await this.output(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
      if (!RecapRepos.DEFAULT_BRANCHES.has(branch)) {
        return []
      }
      const since = Math.floor(sinceMs / RecapRepos.MS_PER_SECOND) - RecapRepos.COMMIT_CLOCK_SLACK_SECONDS
      const [log, remote] = await Promise.all([
        this.output(root, ['log', `--since=@${since}`, `-n${RecapRepos.MAX_TURN_COMMITS}`, '--format=%H%x09%s', 'HEAD']),
        this.output(root, ['remote', 'get-url', 'origin']),
      ])
      const repoUrl = RepoLink.fromRoot(root, remote).url

      return GitFacts.commitLinks(log, repoUrl)
    } catch (error) {
      void this.errors.log(`commit lookup failed for ${root}: ${RecapErrorLog.describe(error)}`)

      return []
    }
  }
}
