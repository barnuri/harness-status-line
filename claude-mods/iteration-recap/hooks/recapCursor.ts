import type { IterationRecapEntry } from '../types'

export class RecapCursor {
  public static selected(iterations: readonly IterationRecapEntry[], cursor: number | null): IterationRecapEntry | undefined {
    if (cursor === null) {
      return iterations.at(-1)
    }

    return iterations.find(entry => entry.index === cursor) ?? iterations.at(-1)
  }

  public static step(iterations: readonly IterationRecapEntry[], cursor: number | null, offset: number): number | null {
    const current = RecapCursor.selected(iterations, cursor)
    if (current === undefined) {
      return null
    }
    const position = iterations.indexOf(current)
    const target = Math.min(iterations.length - 1, Math.max(0, position + offset))

    return RecapCursor.jump(iterations, iterations[target]?.index ?? current.index)
  }

  public static jump(iterations: readonly IterationRecapEntry[], index: number): number | null {
    const isLatest = iterations.at(-1)?.index === index
    const exists = iterations.some(entry => entry.index === index)

    return isLatest || !exists ? null : index
  }

  public static parse(args: string, iterations: readonly IterationRecapEntry[], cursor: number | null): number | null {
    const word = args.trim().toLowerCase()
    if (word === 'prev' || word === 'previous') {
      return RecapCursor.step(iterations, cursor, -1)
    }
    if (word === 'next') {
      return RecapCursor.step(iterations, cursor, 1)
    }
    if (word === 'last' || word === 'latest') {
      return null
    }
    const index = Number.parseInt(word.replace(/^#/, ''), 10)

    return Number.isNaN(index) ? cursor : RecapCursor.jump(iterations, index)
  }
}
