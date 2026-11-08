import { TextFormat } from './textFormat'

import type { IterationRecapSummaryFacts } from '../types'

export class RecapSummarizer {
  private static readonly MAX_SUMMARY_LENGTH = 160
  private static readonly NO_ANSWER = '(no final answer)'
  private static readonly MARKDOWN_NOISE = /[#*_`>|]/g
  private static readonly SENTENCE_END = /(?<=[.!?])\s/

  public static heuristic(answer: string, facts: IterationRecapSummaryFacts): string {
    const firstSentence = RecapSummarizer.firstSentence(answer)
    const summary = firstSentence !== '' ? firstSentence : RecapSummarizer.factLine(facts)

    return TextFormat.truncate(summary === '' ? RecapSummarizer.NO_ANSWER : summary, RecapSummarizer.MAX_SUMMARY_LENGTH)
  }

  private static factLine(facts: IterationRecapSummaryFacts): string {
    const { artifacts, toolCounts } = facts
    const toolTotal = Object.values(toolCounts).reduce((sum, count) => sum + count, 0)
    const parts = [
      artifacts.skills.length > 0 ? `ran ${artifacts.skills.join(', ')}` : '',
      artifacts.files.length > 0 ? `edited ${RecapSummarizer.count(artifacts.files.length, 'file')}` : '',
      artifacts.commits.length > 0 ? `committed ${artifacts.commits.map(commit => commit.split(' ')[0]).join(', ')}` : '',
      artifacts.pullRequests.some(pr => pr.isCreated === true) ? `opened ${artifacts.pullRequests.filter(pr => pr.isCreated === true).map(pr => pr.label).join(', ')}` : '',
      artifacts.questions.length > 0 ? `asked ${RecapSummarizer.count(artifacts.questions.length, 'question')}` : '',
      toolTotal > 0 ? `${RecapSummarizer.count(toolTotal, 'tool call')}` : '',
    ].filter(part => part !== '')
    const line = parts.join(', ')

    return line === '' ? '' : `${line.charAt(0).toUpperCase()}${line.slice(1)}.`
  }

  private static count(value: number, noun: string): string {
    return `${value} ${noun}${value === 1 ? '' : 's'}`
  }

  private static firstSentence(answer: string): string {
    const prose = answer
      .replace(TextFormat.FENCED_BLOCK, ' ')
      .split('\n')
      .map(line => line.replace(RecapSummarizer.MARKDOWN_NOISE, '').trim())
      .filter(line => line !== '')
      .join(' ')

    return prose.split(RecapSummarizer.SENTENCE_END)[0] ?? ''
  }
}
