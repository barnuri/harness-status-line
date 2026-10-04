import { ArtifactExtractor } from './artifactExtractor'
import { RecapSummarizer } from './recapSummarizer'

import type { IterationRecapEntry, IterationRecapGitFacts, IterationRecapToolCall, IterationRecapTurnEnd } from '../types'

export class IterationRecorder {
  private static readonly MAX_PROMPT_LENGTH = 400
  private static readonly MAX_RESULT_TEXT_LENGTH = 4000

  private turnId: string | null = null
  private prompt = ''
  private startedAt = 0
  private calls: IterationRecapToolCall[] = []
  private skills: string[] = []
  private pendingSkills: string[] = []

  public start(turnId: string, prompt: string, startedAt: number): void {
    this.turnId = turnId
    this.prompt = prompt.trim().slice(0, IterationRecorder.MAX_PROMPT_LENGTH)
    this.startedAt = startedAt
    this.calls = []
    this.skills = this.pendingSkills
    this.pendingSkills = []
  }

  public noteSkill(skill: string): void {
    const name = skill.startsWith('/') ? skill : `/${skill}`
    if (this.turnId === null) {
      this.pendingSkills.push(name)

      return
    }
    this.skills.push(name)
  }

  public record(tool: string, input: Record<string, unknown>, resultText: string, isError: boolean, git?: IterationRecapGitFacts): void {
    if (this.turnId === null) {
      return
    }
    const call: IterationRecapToolCall = { tool, input, resultText: resultText.slice(0, IterationRecorder.MAX_RESULT_TEXT_LENGTH), isError }
    this.calls.push(git === undefined ? call : { ...call, git })
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
    const extracted = ArtifactExtractor.extract(this.calls, end.answer, isOwnTurn ? this.prompt : '')
    const artifacts = { ...extracted, skills: [...new Set([...this.skills, ...extracted.skills])] }
    const toolCounts = IterationRecorder.countTools(this.calls)
    const entry: IterationRecapEntry = {
      index,
      turnId: end.turnId,
      prompt: isOwnTurn ? this.prompt : '',
      summary: RecapSummarizer.heuristic(end.answer, { artifacts, toolCounts }),
      isSummaryFromModel: false,
      startedAt: isOwnTurn ? this.startedAt : finishedAt - end.durationMs,
      durationMs: end.durationMs,
      outputTokens: end.outputTokens,
      toolCounts,
      endReason: end.reason,
      artifacts,
    }
    this.turnId = null
    this.skills = []

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
