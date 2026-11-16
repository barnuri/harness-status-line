import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { SummarizeText } from './summarizeText'
import { SessionTotals } from './sessionTotals'

import type { IterationSummarizeEntry, IterationSummarizeHandlers, IterationSummarizeLink, IterationSummarizePaneLayout, SessionAnswers, SessionOverview } from '../types'

type SummarizeViewElements = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button' | 'Link'>

export class SummarizeView {
  private static readonly HISTORY_ROWS = 8
  private static readonly COLLAPSED_ANSWERS = 3
  private static readonly COLORS = {
    accent: 'cyan',
    session: 'magenta',
    summary: 'whiteBright',
    skills: 'magentaBright',
    changed: 'greenBright',
    tools: 'blueBright',
    files: 'white',
    links: 'cyanBright',
    action: 'cyanBright',
    reviews: 'yellowBright',
    plans: 'blueBright',
    commits: 'green',
    asked: 'green',
    prompt: 'gray',
  } as const
  private static readonly TOKENS_PER_K = 1000

  public static pane(
    elements: SummarizeViewElements,
    iterations: readonly IterationSummarizeEntry[],
    selected: IterationSummarizeEntry | undefined,
    cwd: string,
    layout: IterationSummarizePaneLayout,
    handlers: IterationSummarizeHandlers,
    answers: SessionAnswers | null = null,
    sessionHead: IterationSummarizeLink | null = null,
    overview: SessionOverview | null = null,
  ): RenderElement {
    const { Box, Text } = elements
    if (selected === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No iterations yet. Each finished turn gets a summary here.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" minHeight={layout.bodyRows}>
        <Box flexDirection="column" flexGrow={1}>
          {SummarizeView.session(elements, iterations, handlers, sessionHead, overview)}
          {SummarizeView.answers(elements, answers, iterations, layout.isQaOpen, handlers)}
          {SummarizeView.header(elements, selected, iterations.length)}
          <Text bold color={SummarizeView.COLORS.summary} wrap="wrap">{selected.summary}</Text>
          <Text> </Text>
          {SummarizeView.details(elements, selected, cwd, layout)}
          {layout.isPromptOpen && SummarizeView.prompt(elements, selected)}
          {layout.isHistoryOpen && SummarizeView.history(elements, selected, iterations, handlers)}
        </Box>
        {SummarizeView.footer(elements, selected, iterations, layout, handlers)}
      </Box>
    )
  }

  public static commandText(...args: Parameters<typeof SummarizeText.commandText>): string {
    return SummarizeText.commandText(...args)
  }

  public static band(
    elements: SummarizeViewElements,
    latest: IterationSummarizeEntry,
    total: number,
    handlers: IterationSummarizeHandlers,
  ): RenderElement {
    const { Box, Text, Button } = elements

    return (
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text bold color={SummarizeView.COLORS.accent}>↻ #{latest.index}/{total}</Text>
            <Text dimColor> {SummarizeText.duration(latest.durationMs)} · </Text>
            <Text color={SummarizeView.COLORS.summary}>{latest.summary}</Text>
          </Text>
        </Box>
        <Box flexShrink={0} paddingRight={4}>
          <Text> </Text>
          {SummarizeView.action(elements, 'open', 'summary', handlers.onOpen, { hotkey: 'r' })}
          <Text> </Text>
          {SummarizeView.action(elements, 'hide', '×', handlers.onHide, { hotkey: 'x' })}
        </Box>
      </Box>
    )
  }


  private static session(
    elements: SummarizeViewElements,
    iterations: readonly IterationSummarizeEntry[],
    handlers: IterationSummarizeHandlers,
    sessionHead: IterationSummarizeLink | null,
    overview: SessionOverview | null,
  ): RenderElement {
    const { Box, Text } = elements
    const last = SessionTotals.lastCommits(iterations, sessionHead)

    return (
      <Box flexDirection="column">
        <Text bold color={SummarizeView.COLORS.session}>◆ This session</Text>
        {SummarizeView.slugRow(elements, overview, handlers)}
        {SummarizeView.alwaysLinkRow(elements, 'repos', SessionTotals.changedRepos(iterations), SummarizeView.COLORS.changed, handlers)}
        {last.length > 0 && SummarizeView.commitLines(elements, 'last', last, handlers)}
        {SummarizeView.alwaysLinkRow(elements, 'PRs', SessionTotals.pullRequests(iterations), SummarizeView.COLORS.links, handlers)}
        {SessionTotals.commits(iterations).length > 0 && SummarizeView.alwaysLinkRow(elements, 'commits', SessionTotals.commits(iterations), SummarizeView.COLORS.commits, handlers)}
        {SummarizeView.alwaysRow(elements, 'skills', SessionTotals.skills(iterations), SummarizeView.COLORS.skills)}
        <Text> </Text>
      </Box>
    )
  }

  private static answers(
    elements: SummarizeViewElements,
    answers: SessionAnswers | null,
    iterations: readonly IterationSummarizeEntry[],
    isQaOpen: boolean,
    handlers: IterationSummarizeHandlers,
  ): RenderElement | null {
    const { Box, Text, Button } = elements
    const all = SummarizeText.sessionAnswers(answers)
    const items = isQaOpen ? all : all.slice(-SummarizeView.COLLAPSED_ANSWERS)
    if (items.length === 0) {
      return null
    }
    const hidden = all.length - items.length

    return (
      <Box flexDirection="column">
        <Text bold color={SummarizeView.COLORS.session}>◆ Answers ({all.length})  <Text dimColor>{answers?.session || answers?.slug || 'this session'}</Text></Text>
        {hidden > 0 && <Text dimColor>  {hidden} earlier, press q for all</Text>}
        {items.map((item, index) => (
          <Box key={`answer-${index}`} flexDirection="column">
            <Text wrap="wrap"><Text bold color={SummarizeView.COLORS.accent}>{item.number.padEnd(5)}</Text><Text bold color={SummarizeView.COLORS.asked}>{item.answer}</Text></Text>
            <Box paddingLeft={5}><Text dimColor wrap="wrap">↳ {item.question}</Text></Box>
          </Box>
        ))}
        <Text> </Text>
      </Box>
    )
  }



  /** The slug, and the button that opens its `session-overview.html`; `none` when the session has no slug folder. */
  private static slugRow(elements: SummarizeViewElements, overview: SessionOverview | null, handlers: IterationSummarizeHandlers): RenderElement {
    const { Box, Text } = elements
    const label = <Text bold color={SummarizeView.COLORS.session}>{'slug'.padEnd(SummarizeText.LABEL_WIDTH)}</Text>
    if (overview === null) {
      return <Box flexDirection="row">{label}<Text dimColor>{SummarizeText.NONE}</Text></Box>
    }

    return (
      <Box flexDirection="row" columnGap={2}>
        <Box flexDirection="row">{label}<Text color={SummarizeView.COLORS.session}>{overview.slug}</Text></Box>
        {SummarizeView.action(elements, 'open-overview', 'session overview', () => handlers.onOpenOverview(overview.html), { hotkey: 'o' })}
      </Box>
    )
  }

  private static header(elements: SummarizeViewElements, selected: IterationSummarizeEntry, total: number): RenderElement {
    const { Box, Text } = elements
    const facts = [
      SummarizeText.clock(selected.startedAt),
      SummarizeText.duration(selected.durationMs),
      selected.outputTokens > 0 ? `${SummarizeView.tokens(selected.outputTokens)} out` : '',
      selected.endReason === 'answer' ? '' : selected.endReason,
    ].filter(fact => fact !== '')

    return (
      <Box flexDirection="row">
        <Text bold color={SummarizeView.COLORS.accent}>◆ Iteration {selected.index}/{total}  </Text>
        <Text dimColor>{facts.join(' · ')}</Text>
      </Box>
    )
  }

  private static details(elements: SummarizeViewElements, selected: IterationSummarizeEntry, cwd: string, layout: IterationSummarizePaneLayout): RenderElement {
    const { Box } = elements
    const { artifacts } = selected

    return (
      <Box flexDirection="column">
        {SummarizeView.alwaysRow(elements, 'tools', SummarizeText.toolList(selected), SummarizeView.COLORS.tools)}
        {SummarizeView.row(elements, 'files', SummarizeText.fileValues(artifacts.files, cwd, layout.showFilePaths), SummarizeView.COLORS.files)}
        {SummarizeView.row(elements, 'reviews', artifacts.reviews, SummarizeView.COLORS.reviews)}
        {SummarizeView.row(elements, 'plans', artifacts.plans.map(plan => SummarizeText.relative(plan, cwd)), SummarizeView.COLORS.plans)}
        {SummarizeView.row(elements, 'commits', artifacts.commits, SummarizeView.COLORS.commits)}
      </Box>
    )
  }

  private static prompt(elements: SummarizeViewElements, selected: IterationSummarizeEntry): RenderElement {
    const { Box, Text } = elements

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={SummarizeView.COLORS.prompt}>prompt</Text>
        <Text color={SummarizeView.COLORS.prompt} wrap="wrap">{selected.prompt === '' ? SummarizeText.NONE : selected.prompt}</Text>
      </Box>
    )
  }

  private static footer(
    elements: SummarizeViewElements,
    selected: IterationSummarizeEntry,
    iterations: readonly IterationSummarizeEntry[],
    layout: IterationSummarizePaneLayout,
    handlers: IterationSummarizeHandlers,
  ): RenderElement {
    const { Box, Button } = elements
    const first = iterations[0]?.index ?? selected.index
    const last = iterations.at(-1)?.index ?? selected.index

    return (
      <Box flexDirection="row" columnGap={2} marginTop={1}>
        {SummarizeView.action(elements, 'previous', '◀', handlers.onPrevious, { hotkey: 'p', isDisabled: selected.index <= first })}
        {SummarizeView.action(elements, 'next', '▶', handlers.onNext, { hotkey: 'n', isDisabled: selected.index >= last })}
        {SummarizeView.action(elements, 'latest', '⏭', handlers.onLatest, { hotkey: 'l', isDisabled: selected.index >= last })}
        {SummarizeView.action(elements, 'toggle-history', layout.isHistoryOpen ? '☰ ▾' : '☰', handlers.onToggleHistory, { hotkey: 'h' })}
        {SummarizeView.action(elements, 'toggle-prompt', layout.isPromptOpen ? '✎ ▾' : '✎', handlers.onTogglePrompt, { hotkey: 'i' })}
        {SummarizeView.action(elements, 'toggle-qa', layout.isQaOpen ? 'Q&A ▾' : 'Q&A', handlers.onToggleQa, { hotkey: 'q' })}
      </Box>
    )
  }

  private static history(
    elements: SummarizeViewElements,
    selected: IterationSummarizeEntry,
    iterations: readonly IterationSummarizeEntry[],
    handlers: IterationSummarizeHandlers,
  ): RenderElement {
    const { Box, Text, Button } = elements
    const recent = iterations.slice(-SummarizeView.HISTORY_ROWS).reverse()

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={SummarizeView.COLORS.accent}>history ({iterations.length})</Text>
        {recent.map(entry => (
          <Box key={`history-${entry.index}`} flexDirection="row">
            <Text color={SummarizeView.COLORS.accent}>{entry.index === selected.index ? '› ' : '  '}</Text>
            {SummarizeView.action(
              elements,
              `jump-${entry.index}`,
              `#${entry.index} ${SummarizeText.clock(entry.startedAt)} ${entry.summary}`,
              () => handlers.onJump(entry.index),
              { isDisabled: entry.index !== selected.index },
            )}
          </Box>
        ))}
      </Box>
    )
  }

  private static alwaysRow(elements: SummarizeViewElements, label: string, values: readonly string[], color: string): RenderElement {
    const { Box, Text } = elements
    const isEmpty = values.length === 0

    return (
      <Box flexDirection="row">
        <Text bold color={color}>{label.padEnd(SummarizeText.LABEL_WIDTH)}</Text>
        <Text color={isEmpty ? undefined : color} dimColor={isEmpty} wrap="wrap">{isEmpty ? SummarizeText.NONE : values.join(', ')}</Text>
      </Box>
    )
  }

  private static row(elements: SummarizeViewElements, label: string, values: readonly string[], color: string): RenderElement | null {
    return values.length === 0 ? null : SummarizeView.alwaysRow(elements, label, values, color)
  }

  /** One button per link: pressing it opens the URL in the browser, or the folder for a local repo. */
  private static alwaysLinkRow(
    elements: SummarizeViewElements,
    label: string,
    links: readonly IterationSummarizeLink[],
    color: string,
    handlers: IterationSummarizeHandlers,
  ): RenderElement {
    const { Box, Text, Button } = elements

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold color={color}>{label.padEnd(SummarizeText.LABEL_WIDTH - 2)}</Text>
        {links.length === 0 && <Text dimColor>{SummarizeText.NONE}</Text>}
        {links.map(link => {
          const url = link.url
          const text = `${link.isCreated === true ? '+ ' : ''}${SummarizeView.shortLabel(link.label)}`

          return url === undefined
            ? <Text key={`${label}-${link.label}`}>{text} </Text>
            : (
              SummarizeView.action(elements, `${label}-${link.label}`, text, () => handlers.onOpenFile(SummarizeView.openTarget(url)))
            )
        })}
      </Box>
    )
  }






  /**
   * The one style for everything clickable (links and buttons): underlined text in the action
   * color, dimmed when it does nothing right now. See this mod's CLAUDE.md.
   */
  private static action(
    elements: SummarizeViewElements,
    key: string,
    text: string,
    onPress: () => void,
    options: { hotkey?: string; isDisabled?: boolean } = {},
  ): RenderElement {
    const { Button, Text } = elements

    return (
      <Button key={key} plain {...(options.hotkey === undefined ? {} : { hotkey: options.hotkey })} onPress={onPress}>
        <Text underline color={SummarizeView.COLORS.action} dimColor={options.isDisabled === true}>{text}</Text>
      </Button>
    )
  }

  /**
   * One line per repo: the row label on the first line only, the repo name dimmed when there are
   * several repos, then the commit as an action.
   */
  private static commitLines(
    elements: SummarizeViewElements,
    label: string,
    commits: readonly IterationSummarizeLink[],
    handlers: IterationSummarizeHandlers,
  ): RenderElement {
    const { Box, Text } = elements
    const repoWidth = commits.length < 2 ? 0 : Math.max(...commits.map(commit => (commit.repo ?? '').length)) + 1

    return (
      <Box flexDirection="column">
        {commits.map((commit, index) => {
          const url = commit.url

          return (
            <Box key={`${label}-${commit.repo ?? ''}-${index}`} flexDirection="row">
              <Text bold color={SummarizeView.COLORS.commits}>{(index === 0 ? label : '').padEnd(SummarizeText.LABEL_WIDTH)}</Text>
              {repoWidth > 0 && <Text dimColor>{(commit.repo ?? '').padEnd(repoWidth)}</Text>}
              {url === undefined
                ? <Text>{commit.label}</Text>
                : SummarizeView.action(elements, `${label}-${commit.repo ?? ''}`, commit.label, () => handlers.onOpenFile(url))}
            </Box>
          )
        })}
      </Box>
    )
  }

  /** A PR label `owner/repo#42` as `#42`; any other label unchanged. */
  private static shortLabel(label: string): string {
    const hash = label.lastIndexOf('#')

    return hash > 0 ? label.slice(hash) : label
  }

  /** A `file://` URL as a plain path for `open`; any other URL unchanged. */
  private static openTarget(url: string): string {
    return url.startsWith('file://') ? url.slice('file://'.length) : url
  }



  private static tokens(count: number): string {
    return count < SummarizeView.TOKENS_PER_K ? String(count) : `${(count / SummarizeView.TOKENS_PER_K).toFixed(1)}k`
  }

}
