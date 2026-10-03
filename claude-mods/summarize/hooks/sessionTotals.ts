import type { IterationRecapEntry, IterationRecapLink } from '../types'

export class SessionTotals {
  public static changedRepos(iterations: readonly IterationRecapEntry[]): string[] {
    return [...new Set(iterations.flatMap(entry => entry.artifacts.changedRepos ?? []))]
  }

  public static createdPullRequests(iterations: readonly IterationRecapEntry[]): IterationRecapLink[] {
    const byLabel = new Map(
      iterations
        .flatMap(entry => entry.artifacts.pullRequests)
        .filter(link => link.isCreated === true)
        .map(link => [link.label, link]),
    )

    return [...byLabel.values()]
  }
}
