import { SessionTotals } from './sessionTotals'

import type { IterationRecapEntry, IterationRecapLink, SessionAnswer, SessionAnswers } from '../types'

/** The recap as plain text: the `/summarize` reply, and the rows the pane and other hosts reuse. */
export class RecapText {
  public static readonly LABEL_WIDTH = 10
  public static readonly NONE = 'none'
  private static readonly MS_PER_SECOND = 1000
  private static readonly SECONDS_PER_MINUTE = 60

  public static commandText(
    selected: IterationRecapEntry | undefined,
    iterations: readonly IterationRecapEntry[],
    cwd: string,
    answers: SessionAnswers | null = null,
    showFilePaths = false,
    sessionHead: IterationRecapLink | null = null,
    isLabelOnly = false,
  ): string {
    const show = (link: IterationRecapLink): string => (isLabelOnly ? link.label : (link.url ?? link.label))
    if (selected === undefined) {
      return 'No iterations recorded yet.'
    }
    const { artifacts } = selected
    const lines = [
      'This session',
      RecapText.alwaysTextRow('repos', SessionTotals.changedRepos(iterations).map(show)),
      RecapText.alwaysTextRow('PRs', SessionTotals.pullRequests(iterations).map(show)),
      RecapText.textRow('commits', SessionTotals.commits(iterations).map(show)),
      ...SessionTotals.lastCommits(iterations, sessionHead).map((commit, index) =>
        `${(index === 0 ? 'last' : '').padEnd(RecapText.LABEL_WIDTH)}${commit.repo === undefined ? '' : `${commit.repo} `}${show(commit)}`),
      RecapText.alwaysTextRow('skills', SessionTotals.skills(iterations)),
      ...RecapText.answerLines(answers),
      `Iteration ${selected.index}/${iterations.length} · ${RecapText.clock(selected.startedAt)} · ${RecapText.duration(selected.durationMs)}`,
      selected.summary,
      RecapText.alwaysTextRow('tools', RecapText.toolList(selected)),
      RecapText.textRow('files', RecapText.fileValues(artifacts.files, cwd, showFilePaths)),
      RecapText.textRow('reviews', artifacts.reviews),
      RecapText.textRow('plans', artifacts.plans.map(plan => RecapText.relative(plan, cwd))),
      RecapText.textRow('commits', artifacts.commits),
      RecapText.textRow('open', RecapText.openQuestions(selected)),
    ]

    return lines.filter(line => line !== '').join('\n')
  }

  /** Answers the session gave to user prompts with a `?`, from overview.md. */
  public static sessionAnswers(answers: SessionAnswers | null): SessionAnswer[] {
    return (answers?.items ?? []).filter(item => item.answer !== '')
  }

  public static answerLines(answers: SessionAnswers | null): string[] {
    const items = RecapText.sessionAnswers(answers)
    if (items.length === 0) {
      return []
    }

    return [`Answers (${answers?.session || answers?.slug || 'this session'})`, ...items.map(item => `${item.number} ${item.answer}\n    ↳ ${item.question}`)]
  }

  public static toolList(entry: IterationRecapEntry): string[] {
    const tools = Object.entries(entry.toolCounts)
      .sort(([, left], [, right]) => right - left)
      .map(([tool, count]) => `${tool}×${count}`)

    return tools.length === 0 ? [] : [tools.join('  ')]
  }

  public static openQuestions(entry: IterationRecapEntry): string[] {
    return entry.artifacts.questions.filter(question => !question.isAnswered).map(question => question.text)
  }

  public static alwaysTextRow(label: string, values: readonly string[]): string {
    return `${label.padEnd(RecapText.LABEL_WIDTH)}${values.length === 0 ? RecapText.NONE : values.join(', ')}`
  }

  public static textRow(label: string, values: readonly string[]): string {
    return values.length === 0 ? '' : RecapText.alwaysTextRow(label, values)
  }

  /** File paths when `showPaths`, else one count such as `3 files`. */
  public static fileValues(files: readonly string[], cwd: string, showPaths: boolean): string[] {
    if (files.length === 0) {
      return []
    }

    return showPaths ? files.map(file => RecapText.relative(file, cwd)) : [`${files.length} file${files.length === 1 ? '' : 's'}`]
  }

  public static relative(path: string, cwd: string): string {
    const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`

    return cwd !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : path
  }

  public static duration(ms: number): string {
    const totalSeconds = Math.round(ms / RecapText.MS_PER_SECOND)
    const minutes = Math.floor(totalSeconds / RecapText.SECONDS_PER_MINUTE)
    const seconds = totalSeconds % RecapText.SECONDS_PER_MINUTE

    return minutes === 0 ? `${seconds}s` : `${minutes}m${String(seconds).padStart(2, '0')}s`
  }

  public static clock(epochMs: number): string {
    const date = new Date(epochMs)

    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
}
