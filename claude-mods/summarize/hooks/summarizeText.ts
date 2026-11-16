import { SessionTotals } from './sessionTotals'

import type { IterationSummarizeEntry, IterationSummarizeLink, SessionAnswer, SessionAnswers, SessionOverview } from '../types'

/** The summarize as plain text: the `/summarize` reply, and the rows the pane and other hosts reuse. */
export class SummarizeText {
  public static readonly LABEL_WIDTH = 10
  public static readonly NONE = 'none'
  private static readonly MS_PER_SECOND = 1000
  private static readonly SECONDS_PER_MINUTE = 60

  public static commandText(
    selected: IterationSummarizeEntry | undefined,
    iterations: readonly IterationSummarizeEntry[],
    cwd: string,
    answers: SessionAnswers | null = null,
    showFilePaths = false,
    sessionHead: IterationSummarizeLink | null = null,
    isLabelOnly = false,
    overview: SessionOverview | null = null,
  ): string {
    const show = (link: IterationSummarizeLink): string => (isLabelOnly ? link.label : (link.url ?? link.label))
    if (selected === undefined) {
      return 'No iterations recorded yet.'
    }
    const { artifacts } = selected
    const lines = [
      'This session',
      SummarizeText.alwaysTextRow('slug', overview === null ? [] : [isLabelOnly ? overview.slug : `${overview.slug} ${overview.html}`]),
      SummarizeText.alwaysTextRow('repos', SessionTotals.changedRepos(iterations).map(show)),
      SummarizeText.alwaysTextRow('PRs', SessionTotals.pullRequests(iterations).map(show)),
      SummarizeText.textRow('commits', SessionTotals.commits(iterations).map(show)),
      ...SessionTotals.lastCommits(iterations, sessionHead).map((commit, index) =>
        `${(index === 0 ? 'last' : '').padEnd(SummarizeText.LABEL_WIDTH)}${commit.repo === undefined ? '' : `${commit.repo} `}${show(commit)}`),
      SummarizeText.alwaysTextRow('skills', SessionTotals.skills(iterations)),
      ...SummarizeText.answerLines(answers),
      `Iteration ${selected.index}/${iterations.length} · ${SummarizeText.clock(selected.startedAt)} · ${SummarizeText.duration(selected.durationMs)}`,
      selected.summary,
      SummarizeText.alwaysTextRow('tools', SummarizeText.toolList(selected)),
      SummarizeText.textRow('files', SummarizeText.fileValues(artifacts.files, cwd, showFilePaths)),
      SummarizeText.textRow('reviews', artifacts.reviews),
      SummarizeText.textRow('plans', artifacts.plans.map(plan => SummarizeText.relative(plan, cwd))),
      SummarizeText.textRow('commits', artifacts.commits),
    ]

    return lines.filter(line => line !== '').join('\n')
  }

  /** Answers the session gave to user prompts with a `?`, from overview.md. */
  public static sessionAnswers(answers: SessionAnswers | null): SessionAnswer[] {
    return (answers?.items ?? []).filter(item => item.answer !== '')
  }

  public static answerLines(answers: SessionAnswers | null): string[] {
    const items = SummarizeText.sessionAnswers(answers)
    if (items.length === 0) {
      return []
    }

    return [`Answers (${answers?.session || answers?.slug || 'this session'})`, ...items.map(item => `${item.number} ${item.answer}\n    ↳ ${item.question}`)]
  }

  public static toolList(entry: IterationSummarizeEntry): string[] {
    const tools = Object.entries(entry.toolCounts)
      .sort(([, left], [, right]) => right - left)
      .map(([tool, count]) => `${tool}×${count}`)

    return tools.length === 0 ? [] : [tools.join('  ')]
  }

  public static alwaysTextRow(label: string, values: readonly string[]): string {
    return `${label.padEnd(SummarizeText.LABEL_WIDTH)}${values.length === 0 ? SummarizeText.NONE : values.join(', ')}`
  }

  public static textRow(label: string, values: readonly string[]): string {
    return values.length === 0 ? '' : SummarizeText.alwaysTextRow(label, values)
  }

  /** File paths when `showPaths`, else one count such as `3 files`. */
  public static fileValues(files: readonly string[], cwd: string, showPaths: boolean): string[] {
    if (files.length === 0) {
      return []
    }

    return showPaths ? files.map(file => SummarizeText.relative(file, cwd)) : [`${files.length} file${files.length === 1 ? '' : 's'}`]
  }

  public static relative(path: string, cwd: string): string {
    const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`

    return cwd !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : path
  }

  public static duration(ms: number): string {
    const totalSeconds = Math.round(ms / SummarizeText.MS_PER_SECOND)
    const minutes = Math.floor(totalSeconds / SummarizeText.SECONDS_PER_MINUTE)
    const seconds = totalSeconds % SummarizeText.SECONDS_PER_MINUTE

    return minutes === 0 ? `${seconds}s` : `${minutes}m${String(seconds).padStart(2, '0')}s`
  }

  public static clock(epochMs: number): string {
    const date = new Date(epochMs)

    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
}
