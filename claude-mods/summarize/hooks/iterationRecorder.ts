import { ArtifactExtractor } from './artifactExtractor'
import { RecapSummarizer } from './recapSummarizer'

import type { IterationRecapEntry, IterationRecapToolCall, IterationRecapTurnEnd } from '../types'

export class IterationRecorder {
  private static readonly MAX_PROMPT_LENGTH = 400
  private static readonly MAX_RESULT_TEXT_LENGTH = 4000

  private turnId: string | null = null
  private prompt = ''
  private startedAt = 0
  private calls: IterationRecapToolCall[] = []

  public start(turnId: string, prompt: string, startedAt: number): void {
    this.turnId = turnId
    this.prompt = prompt.trim().slice(0, IterationRecorder.MAX_PROMPT_LENGTH)
    this.startedAt = startedAt
    this.calls = []
  }

  public record(tool: string, input: Record<string, unknown>, resultText: string, isError: boolean): void {
    if (this.turnId === null) {
      return
    }
    this.calls.push({ tool, input, resultText: resultText.slice(0, IterationRecorder.MAX_RESULT_TEXT_LENGTH), isError })
  }

  public get toolCalls(): readonly IterationRecapToolCall[] {
    return this.calls
  }

  public finish(end: IterationRecapTurnEnd, index: number, finishedAt: number): IterationRecapEntry | null {
    const isOwnTurn = this.turnId === end.turnId
    const isEmpty = end.answer.trim() === '' && this.calls.length === 0 && this.prompt === ''
    if (isEmpty) {
      return null
    }
    const entry: IterationRecapEntry = {
      index,
      turnId: end.turnId,
      prompt: isOwnTurn ? this.prompt : '',
      summary: RecapSummarizer.heuristic(end.answer),
      isSummaryFromModel: false,
      startedAt: isOwnTurn ? this.startedAt : finishedAt - end.durationMs,
      durationMs: end.durationMs,
      outputTokens: end.outputTokens,
      toolCounts: IterationRecorder.countTools(this.calls),
      endReason: end.reason,
      artifacts: ArtifactExtractor.extract(this.calls, end.answer, isOwnTurn ? this.prompt : ''),
    }
    this.turnId = null

    return entry
  }

  private static countTools(calls: readonly IterationRecapToolCall[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const call of calls) {
      counts[call.tool] = (counts[call.tool] ?? 0) + 1
    }

    return counts
  }
}
