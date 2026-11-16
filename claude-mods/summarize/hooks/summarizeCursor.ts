import type { IterationSummarizeEntry } from '../types'

export class SummarizeCursor {
  public static selected(iterations: readonly IterationSummarizeEntry[], cursor: number | null): IterationSummarizeEntry | undefined {
    if (cursor === null) {
      return iterations.at(-1)
    }

    return iterations.find(entry => entry.index === cursor) ?? iterations.at(-1)
  }

  public static step(iterations: readonly IterationSummarizeEntry[], cursor: number | null, offset: number): number | null {
    const current = SummarizeCursor.selected(iterations, cursor)
    if (current === undefined) {
      return null
    }
    const position = iterations.indexOf(current)
    const target = Math.min(iterations.length - 1, Math.max(0, position + offset))

    return SummarizeCursor.jump(iterations, iterations[target]?.index ?? current.index)
  }

  public static jump(iterations: readonly IterationSummarizeEntry[], index: number): number | null {
    const isLatest = iterations.at(-1)?.index === index
    const exists = iterations.some(entry => entry.index === index)

    return isLatest || !exists ? null : index
  }

  public static parse(args: string, iterations: readonly IterationSummarizeEntry[], cursor: number | null): number | null {
    const word = args.trim().toLowerCase()
    if (word === 'prev' || word === 'previous') {
      return SummarizeCursor.step(iterations, cursor, -1)
    }
    if (word === 'next') {
      return SummarizeCursor.step(iterations, cursor, 1)
    }
    if (word === 'last' || word === 'latest') {
      return null
    }
    const index = Number.parseInt(word.replace(/^#/, ''), 10)

    return Number.isNaN(index) ? cursor : SummarizeCursor.jump(iterations, index)
  }
}
