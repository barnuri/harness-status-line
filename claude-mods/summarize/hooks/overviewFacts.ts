import { SessionTotals } from './sessionTotals'

import type { IterationRecapEntry, IterationRecapLink, OverviewFactsDocument } from '../types'

export class OverviewFacts {
  private static readonly SCHEMA_VERSION = 1
  private static readonly INDENT = 2

  /** The facts of a session, built from the same helpers the pane uses, so the page matches the pane. */
  public static build(input: {
    slug: string
    sessionId: string
    cwd: string
    iterations: readonly IterationRecapEntry[]
    sessionHead: IterationRecapLink | null
  }): OverviewFactsDocument {
    const { iterations } = input

    return {
      schemaVersion: OverviewFacts.SCHEMA_VERSION,
      slug: input.slug,
      sessionId: input.sessionId,
      cwd: input.cwd,
      turns: iterations.length,
      durationMs: OverviewFacts.sum(iterations.map(entry => entry.durationMs)),
      outputTokens: OverviewFacts.sum(iterations.map(entry => entry.outputTokens)),
      toolCounts: OverviewFacts.toolCounts(iterations),
      files: OverviewFacts.distinct(iterations.flatMap(entry => entry.artifacts.files)),
      skills: SessionTotals.skills(iterations),
      changedRepos: SessionTotals.changedRepos(iterations),
      pullRequests: SessionTotals.pullRequests(iterations),
      commits: SessionTotals.commits(iterations),
      lastCommits: SessionTotals.lastCommits(iterations, input.sessionHead),
      plans: OverviewFacts.distinct(iterations.flatMap(entry => entry.artifacts.plans)),
      reviews: OverviewFacts.distinct(iterations.flatMap(entry => entry.artifacts.reviews)),
    }
  }

  /** Deterministic JSON: contract key order, two-space indent, trailing newline, no null or empty optional keys. */
  public static serialize(document: OverviewFactsDocument): string {
    const ordered: OverviewFactsDocument = {
      schemaVersion: document.schemaVersion,
      slug: document.slug,
      sessionId: document.sessionId,
      cwd: document.cwd,
      turns: document.turns,
      durationMs: document.durationMs,
      outputTokens: document.outputTokens,
      toolCounts: OverviewFacts.sortedCounts(document.toolCounts),
      files: document.files,
      skills: document.skills,
      changedRepos: document.changedRepos.map(OverviewFacts.link),
      pullRequests: document.pullRequests.map(OverviewFacts.link),
      commits: document.commits.map(OverviewFacts.link),
      lastCommits: document.lastCommits.map(OverviewFacts.link),
      plans: document.plans,
      reviews: document.reviews,
    }

    return `${JSON.stringify(ordered, null, OverviewFacts.INDENT)}\n`
  }

  private static sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0)
  }

  private static distinct(values: readonly string[]): string[] {
    return [...new Set(values)]
  }

  private static toolCounts(iterations: readonly IterationRecapEntry[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const entry of iterations) {
      for (const [tool, count] of Object.entries(entry.toolCounts)) {
        counts[tool] = (counts[tool] ?? 0) + count
      }
    }

    return OverviewFacts.sortedCounts(counts)
  }

  private static sortedCounts(counts: Record<string, number>): Record<string, number> {
    return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (left < right ? -1 : 1)))
  }

  private static link(link: IterationRecapLink): IterationRecapLink {
    return {
      label: link.label,
      ...(link.url === undefined ? {} : { url: link.url }),
      ...(link.repo === undefined ? {} : { repo: link.repo }),
      ...(link.isCreated === undefined ? {} : { isCreated: link.isCreated }),
      ...(link.isBranch === undefined ? {} : { isBranch: link.isBranch }),
    }
  }
}
