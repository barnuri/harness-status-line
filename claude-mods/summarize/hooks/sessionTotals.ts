import { RepoLink } from './repoLink'

import type { IterationSummarizeEntry, IterationSummarizeLink } from '../types'

export class SessionTotals {
  public static changedRepos(iterations: readonly IterationSummarizeEntry[]): IterationSummarizeLink[] {
    return RepoLink.unique(iterations.flatMap(entry => entry.artifacts.changedRepos ?? []))
  }

  public static skills(iterations: readonly IterationSummarizeEntry[]): string[] {
    return [...new Set(iterations.flatMap(entry => entry.artifacts.skills ?? []))]
  }

  public static pullRequests(iterations: readonly IterationSummarizeEntry[]): IterationSummarizeLink[] {
    const byLabel = new Map(
      iterations
        .flatMap(entry => entry.artifacts.pullRequests)
        .filter(link => link.isCreated === true || link.isBranch === true)
        .map(link => [link.label, link]),
    )

    return [...byLabel.values()]
  }

  /** Default-branch commits of the session, newest last, one per sha. */
  public static commits(iterations: readonly IterationSummarizeEntry[]): IterationSummarizeLink[] {
    const bySha = new Map(iterations.flatMap(entry => entry.artifacts.commitLinks ?? []).map(link => [link.label.split(' ')[0], link]))

    return [...bySha.values()]
  }

  /** The newest HEAD commit seen for each repo, one per repo, session repo first. */
  public static lastCommits(iterations: readonly IterationSummarizeEntry[], sessionHead: IterationSummarizeLink | null = null): IterationSummarizeLink[] {
    const heads = [...(sessionHead === null ? [] : [sessionHead]), ...iterations.flatMap(entry => entry.artifacts.headCommits ?? [])]
    const byRepo = new Map(heads.map(link => [link.repo ?? '', link]))

    return [...byRepo.values()]
  }
}
