import { TextFormat } from './textFormat'

import type { IterationRecapEntry } from '../types'

export class RecapSummarizer {
  public static readonly MODEL = 'haiku'
  public static readonly TIMEOUT_MS = 8000
  public static readonly MAX_TOKENS = 120

  private static readonly MAX_SUMMARY_LENGTH = 160
  private static readonly NO_ANSWER = '(no final answer)'
  private static readonly MAX_ANSWER_CONTEXT = 3000
  private static readonly MARKDOWN_NOISE = /[#*_`>|]/g
  private static readonly SENTENCE_END = /(?<=[.!?])\s/

  public static readonly SYSTEM =
    'You write one-line recaps of a coding agent iteration for a status panel. ' +
    'Reply with a single plain sentence under 20 words, past tense, no preamble, no markdown, no quotes.'

  public static heuristic(answer: string): string {
    const prose = answer
      .replace(TextFormat.FENCED_BLOCK, ' ')
      .split('\n')
      .map(line => line.replace(RecapSummarizer.MARKDOWN_NOISE, '').trim())
      .filter(line => line !== '')
      .join(' ')
    const firstSentence = prose.split(RecapSummarizer.SENTENCE_END)[0] ?? ''

    return TextFormat.truncate(firstSentence === '' ? RecapSummarizer.NO_ANSWER : firstSentence, RecapSummarizer.MAX_SUMMARY_LENGTH)
  }

  public static buildPrompt(entry: IterationRecapEntry, answer: string): string {
    const { artifacts } = entry
    const tools = Object.entries(entry.toolCounts).map(([tool, count]) => `${tool}×${count}`).join(', ')
    const facts = [
      `User prompt: ${entry.prompt || '(continuation)'}`,
      `Tools used: ${tools || 'none'}`,
      artifacts.files.length > 0 ? `Files changed: ${artifacts.files.join(', ')}` : '',
      artifacts.pullRequests.length > 0 ? `PRs: ${artifacts.pullRequests.map(pr => pr.label).join(', ')}` : '',
      artifacts.commits.length > 0 ? `Commits: ${artifacts.commits.join('; ')}` : '',
      `Final answer:\n${answer.slice(0, RecapSummarizer.MAX_ANSWER_CONTEXT)}`,
    ]

    return `${facts.filter(fact => fact !== '').join('\n')}\n\nRecap this iteration in one sentence.`
  }

  public static clean(reply: string): string | null {
    const firstLine = reply.trim().split('\n')[0] ?? ''
    const line = firstLine.replace(/^["'\s]+|["'\s]+$/g, '')

    return line === '' ? null : TextFormat.truncate(line, RecapSummarizer.MAX_SUMMARY_LENGTH)
  }
}
