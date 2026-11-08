import { RepoLink } from './repoLink'

import type { IterationRecapEntry, IterationRecapLink } from '../types'

export class SessionTotals {
  public static changedRepos(iterations: readonly IterationRecapEntry[]): IterationRecapLink[] {
    return RepoLink.unique(iterations.flatMap(entry => entry.artifacts.changedRepos ?? []))
  }

  public static skills(iterations: readonly IterationRecapEntry[]): string[] {
    return [...new Set(iterations.flatMap(entry => entry.artifacts.skills ?? []))]
  }

  public static pullRequests(iterations: readonly IterationRecapEntry[]): IterationRecapLink[] {
    const byLabel = new Map(
      iterations
        .flatMap(entry => entry.artifacts.pullRequests)
        .filter(link => link.isCreated === true || link.isBranch === true)
        .map(link => [link.label, link]),
    )

    return [...byLabel.values()]
  }

  /** Default-branch commits of the session, newest last, one per sha. */
  public static commits(iterations: readonly IterationRecapEntry[]): IterationRecapLink[] {
    const bySha = new Map(iterations.flatMap(entry => entry.artifacts.commitLinks ?? []).map(link => [link.label.split(' ')[0], link]))

    return [...bySha.values()]
  }

  /** The newest HEAD commit seen for each repo, prefixed with the repo name when there are several. */
  public static lastCommits(iterations: readonly IterationRecapEntry[], sessionHead: IterationRecapLink | null = null): IterationRecapLink[] {
    const heads = [...(sessionHead === null ? [] : [sessionHead]), ...iterations.flatMap(entry => entry.artifacts.headCommits ?? [])]
    const byRepo = new Map(heads.map(link => [link.repo ?? '', link]))
    const links = [...byRepo.values()]

    return links.length < 2 ? links : links.map(link => ({ ...link, label: `${link.repo ?? ''} ${link.label}`.trim() }))
  }
}
