import type { SessionAnswer, SessionAnswers } from '../types'

export class AnswersReader {
  public static readonly FILE_NAME = 'answers.md'

  private static readonly SESSION_LINE = /^>\s*Session:\s*(.+)$/
  private static readonly QUESTION_HEADING = /^###\s+(Q\d+)\s+[—–:-]\s+(.+?)\s*$/
  private static readonly SECTION_BREAK = /^(?:#{1,3}\s|\s*(?:-{3,}|\*{3,})\s*$)/
  private static readonly ANSWER_LABEL = /^\*\*Answer:\*\*\s*/
  private static readonly BOLD = /\*\*/g
  private static readonly ANSWERS_PATH = /\/agent-spec\/([^/]+)\/answers\.md$/

  public static slugOf(path: string): string | null {
    return AnswersReader.ANSWERS_PATH.exec(path)?.[1] ?? null
  }

  public static parse(markdown: string, path: string): SessionAnswers {
    const lines = markdown.split('\n')
    const items: SessionAnswer[] = []
    let session = ''
    let current: { number: string; question: string; body: string[] } | null = null

    const close = (): void => {
      if (current !== null) {
        items.push({ number: current.number, question: current.question, answer: AnswersReader.answerText(current.body) })
        current = null
      }
    }

    for (const line of lines) {
      const sessionMatch = AnswersReader.SESSION_LINE.exec(line)
      if (sessionMatch !== null && session === '') {
        session = sessionMatch[1]?.trim() ?? ''
        continue
      }
      const question = AnswersReader.QUESTION_HEADING.exec(line)
      if (question !== null) {
        close()
        current = { number: question[1] ?? '', question: (question[2] ?? '').replace(AnswersReader.BOLD, ''), body: [] }
        continue
      }
      if (AnswersReader.SECTION_BREAK.test(line)) {
        close()
        continue
      }
      current?.body.push(line)
    }
    close()

    return { path, slug: AnswersReader.slugOf(path) ?? '', session, items }
  }

  private static answerText(body: readonly string[]): string {
    const text = body.map(line => line.trim()).filter(line => line !== '').join(' ')

    return text.replace(AnswersReader.ANSWER_LABEL, '').replace(AnswersReader.BOLD, '').trim()
  }
}
