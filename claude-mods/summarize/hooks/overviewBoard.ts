import { TextFormat } from './textFormat'

/** Renders and reads the cards of `agent-spec/<slug>/overview.md`, in the session-slug board format. */
export class OverviewBoard {
  public static readonly HEADER = '## Questions and Answers'
  public static readonly NO_ANSWER = '(no final answer)'
  private static readonly QUESTION_MAX_LENGTH = 200
  private static readonly ANSWER_MAX_LENGTH = 400
  private static readonly ANSWER_SENTENCES = 3
  private static readonly SENTENCE_END = /(?<=[.!?])\s/
  private static readonly QUESTION_HEADING = /^### Q\d+ — /gm
  private static readonly QUESTION_HEADING_TEXT = /^### Q\d+ — (.*)$/

  /** One card: the `### Q<n> — <question>` heading and its `**Answer:**` paragraph. */
  public static card(number: number, question: string, answer: string): string {
    return `### Q${number} — ${question}\n\n**Answer:** ${answer}\n`
  }

  /** The number the next card takes: one more than the `### Q` headings already in the text. */
  public static nextNumber(text: string): number {
    return (text.match(OverviewBoard.QUESTION_HEADING)?.length ?? 0) + 1
  }

  /** True when a card for this question already exists, under any number. */
  public static hasQuestion(text: string, question: string): boolean {
    return text.split('\n').some(line => OverviewBoard.QUESTION_HEADING_TEXT.exec(line)?.[1] === question)
  }

  /** The user prompt on one line, cut to 200 characters. */
  public static questionLine(prompt: string): string {
    return TextFormat.truncate(prompt, OverviewBoard.QUESTION_MAX_LENGTH)
  }

  /** The first three sentences of the answer on one line, cut to 400 characters. */
  public static answerSummary(answer: string): string {
    const flat = answer.replace(/\s+/g, ' ').trim()
    if (flat === '') {
      return OverviewBoard.NO_ANSWER
    }
    const sentences = flat.split(OverviewBoard.SENTENCE_END).slice(0, OverviewBoard.ANSWER_SENTENCES).join(' ')

    return TextFormat.truncate(sentences, OverviewBoard.ANSWER_MAX_LENGTH)
  }
}
