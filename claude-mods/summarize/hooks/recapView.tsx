import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { RecapText } from './recapText'
import { SessionTotals } from './sessionTotals'

import type { IterationRecapEntry, IterationRecapHandlers, IterationRecapLink, IterationRecapPaneLayout, SessionAnswer, SessionAnswers } from '../types'

type RecapViewElements = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button' | 'Link'>

export class RecapView {
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
    open: 'yellow',
    prompt: 'gray',
  } as const
  private static readonly TOKENS_PER_K = 1000

  public static pane(
    elements: RecapViewElements,
    iterations: readonly IterationRecapEntry[],
    selected: IterationRecapEntry | undefined,
    cwd: string,
    layout: IterationRecapPaneLayout,
    handlers: IterationRecapHandlers,
    answers: SessionAnswers | null = null,
    sessionHead: IterationRecapLink | null = null,
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
          {RecapView.session(elements, iterations, handlers, sessionHead)}
          {RecapView.answers(elements, answers, iterations, layout.isQaOpen, handlers)}
          {RecapView.header(elements, selected, iterations.length)}
          <Text bold color={RecapView.COLORS.summary} wrap="wrap">{selected.summary}</Text>
          <Text> </Text>
          {RecapView.details(elements, selected, cwd, layout)}
          {layout.isPromptOpen && RecapView.prompt(elements, selected)}
          {layout.isHistoryOpen && RecapView.history(elements, selected, iterations, handlers)}
        </Box>
        {RecapView.footer(elements, selected, iterations, layout, handlers)}
      </Box>
    )
  }

  public static commandText(...args: Parameters<typeof RecapText.commandText>): string {
    return RecapText.commandText(...args)
  }

  public static band(
    elements: RecapViewElements,
    latest: IterationRecapEntry,
    total: number,
    handlers: IterationRecapHandlers,
  ): RenderElement {
    const { Box, Text, Button } = elements
    const openQuestions = RecapText.openQuestions(latest).length

    return (
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text bold color={RecapView.COLORS.accent}>↻ #{latest.index}/{total}</Text>
            <Text dimColor> {RecapText.duration(latest.durationMs)} · </Text>
            <Text color={RecapView.COLORS.summary}>{latest.summary}</Text>
            {openQuestions > 0 && <Text color={RecapView.COLORS.open}> · {openQuestions} open ?</Text>}
          </Text>
        </Box>
        <Box flexShrink={0} paddingRight={4}>
          <Text> </Text>
          {RecapView.action(elements, 'open', 'summary', handlers.onOpen, { hotkey: 'r' })}
          <Text> </Text>
          {RecapView.action(elements, 'hide', '×', handlers.onHide, { hotkey: 'x' })}
        </Box>
      </Box>
    )
  }


  private static session(
    elements: RecapViewElements,
    iterations: readonly IterationRecapEntry[],
    handlers: IterationRecapHandlers,
    sessionHead: IterationRecapLink | null,
  ): RenderElement {
    const { Box, Text } = elements
    const last = SessionTotals.lastCommits(iterations, sessionHead)

    return (
      <Box flexDirection="column">
        <Text bold color={RecapView.COLORS.session}>◆ This session</Text>
        {RecapView.alwaysLinkRow(elements, 'repos', SessionTotals.changedRepos(iterations), RecapView.COLORS.changed, handlers)}
        {last.length > 0 && RecapView.commitLines(elements, 'last', last, handlers)}
        {RecapView.alwaysLinkRow(elements, 'PRs', SessionTotals.pullRequests(iterations), RecapView.COLORS.links, handlers)}
        {SessionTotals.commits(iterations).length > 0 && RecapView.alwaysLinkRow(elements, 'commits', SessionTotals.commits(iterations), RecapView.COLORS.commits, handlers)}
        {RecapView.alwaysRow(elements, 'skills', SessionTotals.skills(iterations), RecapView.COLORS.skills)}
        <Text> </Text>
      </Box>
    )
  }

  private static answers(
    elements: RecapViewElements,
    answers: SessionAnswers | null,
    iterations: readonly IterationRecapEntry[],
    isQaOpen: boolean,
    handlers: IterationRecapHandlers,
  ): RenderElement | null {
    const { Box, Text, Button } = elements
    const all = RecapText.sessionAnswers(answers)
    const items = isQaOpen ? all : all.slice(-RecapView.COLLAPSED_ANSWERS)
    if (items.length === 0) {
      return null
    }
    const hidden = all.length - items.length
    const html = answers === null ? undefined : answers.path.replace(/overview\.md$/, 'session-overview.html')

    return (
      <Box flexDirection="column">
        <Text bold color={RecapView.COLORS.session}>◆ Answers ({all.length})  <Text dimColor>{answers?.session || answers?.slug || 'this session'}</Text></Text>
        {hidden > 0 && <Text dimColor>  {hidden} earlier, press q for all</Text>}
        {html !== undefined && <Box flexDirection="row">{RecapView.action(elements, 'open-overview', 'open overview', () => handlers.onOpenFile(html), { hotkey: 'o' })}</Box>}
        {items.map((item, index) => (
          <Box key={`answer-${index}`} flexDirection="column">
            <Text wrap="wrap"><Text bold color={RecapView.COLORS.accent}>{item.number.padEnd(5)}</Text><Text bold color={RecapView.COLORS.asked}>{item.answer}</Text></Text>
            <Box paddingLeft={5}><Text dimColor wrap="wrap">↳ {item.question}</Text></Box>
          </Box>
        ))}
        <Text> </Text>
      </Box>
    )
  }



  private static header(elements: RecapViewElements, selected: IterationRecapEntry, total: number): RenderElement {
    const { Box, Text } = elements
    const facts = [
      RecapText.clock(selected.startedAt),
      RecapText.duration(selected.durationMs),
      selected.outputTokens > 0 ? `${RecapView.tokens(selected.outputTokens)} out` : '',
      selected.endReason === 'answer' ? '' : selected.endReason,
    ].filter(fact => fact !== '')

    return (
      <Box flexDirection="row">
        <Text bold color={RecapView.COLORS.accent}>◆ Iteration {selected.index}/{total}  </Text>
        <Text dimColor>{facts.join(' · ')}</Text>
      </Box>
    )
  }

  private static details(elements: RecapViewElements, selected: IterationRecapEntry, cwd: string, layout: IterationRecapPaneLayout): RenderElement {
    const { Box } = elements
    const { artifacts } = selected
    const answeredQuestions = artifacts.questions.filter(question => question.isAnswered).map(question => `✓ ${question.answer ?? question.text}`)

    return (
      <Box flexDirection="column">
        {RecapView.alwaysRow(elements, 'tools', RecapText.toolList(selected), RecapView.COLORS.tools)}
        {RecapView.row(elements, 'files', RecapText.fileValues(artifacts.files, cwd, layout.showFilePaths), RecapView.COLORS.files)}
        {RecapView.row(elements, 'reviews', artifacts.reviews, RecapView.COLORS.reviews)}
        {RecapView.row(elements, 'plans', artifacts.plans.map(plan => RecapText.relative(plan, cwd)), RecapView.COLORS.plans)}
        {RecapView.row(elements, 'commits', artifacts.commits, RecapView.COLORS.commits)}
        {RecapView.row(elements, 'asked', answeredQuestions, RecapView.COLORS.asked)}
        {RecapView.row(elements, 'open ?', RecapText.openQuestions(selected), RecapView.COLORS.open)}
      </Box>
    )
  }

  private static prompt(elements: RecapViewElements, selected: IterationRecapEntry): RenderElement {
    const { Box, Text } = elements

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={RecapView.COLORS.prompt}>prompt</Text>
        <Text color={RecapView.COLORS.prompt} wrap="wrap">{selected.prompt === '' ? RecapText.NONE : selected.prompt}</Text>
      </Box>
    )
  }

  private static footer(
    elements: RecapViewElements,
    selected: IterationRecapEntry,
    iterations: readonly IterationRecapEntry[],
    layout: IterationRecapPaneLayout,
    handlers: IterationRecapHandlers,
  ): RenderElement {
    const { Box, Button } = elements
    const first = iterations[0]?.index ?? selected.index
    const last = iterations.at(-1)?.index ?? selected.index

    return (
      <Box flexDirection="row" columnGap={2} marginTop={1}>
        {RecapView.action(elements, 'previous', '◀', handlers.onPrevious, { hotkey: 'p', isDisabled: selected.index <= first })}
        {RecapView.action(elements, 'next', '▶', handlers.onNext, { hotkey: 'n', isDisabled: selected.index >= last })}
        {RecapView.action(elements, 'latest', '⏭', handlers.onLatest, { hotkey: 'l', isDisabled: selected.index >= last })}
        {RecapView.action(elements, 'toggle-history', layout.isHistoryOpen ? '☰ ▾' : '☰', handlers.onToggleHistory, { hotkey: 'h' })}
        {RecapView.action(elements, 'toggle-prompt', layout.isPromptOpen ? '✎ ▾' : '✎', handlers.onTogglePrompt, { hotkey: 'i' })}
        {RecapView.action(elements, 'toggle-qa', layout.isQaOpen ? 'Q&A ▾' : 'Q&A', handlers.onToggleQa, { hotkey: 'q' })}
      </Box>
    )
  }

  private static history(
    elements: RecapViewElements,
    selected: IterationRecapEntry,
    iterations: readonly IterationRecapEntry[],
    handlers: IterationRecapHandlers,
  ): RenderElement {
    const { Box, Text, Button } = elements
    const recent = iterations.slice(-RecapView.HISTORY_ROWS).reverse()

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={RecapView.COLORS.accent}>history ({iterations.length})</Text>
        {recent.map(entry => (
          <Box key={`history-${entry.index}`} flexDirection="row">
            <Text color={RecapView.COLORS.accent}>{entry.index === selected.index ? '› ' : '  '}</Text>
            {RecapView.action(
              elements,
              `jump-${entry.index}`,
              `#${entry.index} ${RecapText.clock(entry.startedAt)} ${entry.summary}`,
              () => handlers.onJump(entry.index),
              { isDisabled: entry.index !== selected.index },
            )}
          </Box>
        ))}
      </Box>
    )
  }

  private static alwaysRow(elements: RecapViewElements, label: string, values: readonly string[], color: string): RenderElement {
    const { Box, Text } = elements
    const isEmpty = values.length === 0

    return (
      <Box flexDirection="row">
        <Text bold color={color}>{label.padEnd(RecapText.LABEL_WIDTH)}</Text>
        <Text color={isEmpty ? undefined : color} dimColor={isEmpty} wrap="wrap">{isEmpty ? RecapText.NONE : values.join(', ')}</Text>
      </Box>
    )
  }

  private static row(elements: RecapViewElements, label: string, values: readonly string[], color: string): RenderElement | null {
    return values.length === 0 ? null : RecapView.alwaysRow(elements, label, values, color)
  }

  /** One button per link: pressing it opens the URL in the browser, or the folder for a local repo. */
  private static alwaysLinkRow(
    elements: RecapViewElements,
    label: string,
    links: readonly IterationRecapLink[],
    color: string,
    handlers: IterationRecapHandlers,
  ): RenderElement {
    const { Box, Text, Button } = elements

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold color={color}>{label.padEnd(RecapText.LABEL_WIDTH - 2)}</Text>
        {links.length === 0 && <Text dimColor>{RecapText.NONE}</Text>}
        {links.map(link => {
          const url = link.url
          const text = `${link.isCreated === true ? '+ ' : ''}${RecapView.shortLabel(link.label)}`

          return url === undefined
            ? <Text key={`${label}-${link.label}`}>{text} </Text>
            : (
              RecapView.action(elements, `${label}-${link.label}`, text, () => handlers.onOpenFile(RecapView.openTarget(url)))
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
    elements: RecapViewElements,
    key: string,
    text: string,
    onPress: () => void,
    options: { hotkey?: string; isDisabled?: boolean } = {},
  ): RenderElement {
    const { Button, Text } = elements

    return (
      <Button key={key} plain {...(options.hotkey === undefined ? {} : { hotkey: options.hotkey })} onPress={onPress}>
        <Text underline color={RecapView.COLORS.action} dimColor={options.isDisabled === true}>{text}</Text>
      </Button>
    )
  }

  /**
   * One line per repo: the row label on the first line only, the repo name dimmed when there are
   * several repos, then the commit as an action.
   */
  private static commitLines(
    elements: RecapViewElements,
    label: string,
    commits: readonly IterationRecapLink[],
    handlers: IterationRecapHandlers,
  ): RenderElement {
    const { Box, Text } = elements
    const repoWidth = commits.length < 2 ? 0 : Math.max(...commits.map(commit => (commit.repo ?? '').length)) + 1

    return (
      <Box flexDirection="column">
        {commits.map((commit, index) => {
          const url = commit.url

          return (
            <Box key={`${label}-${commit.repo ?? ''}-${index}`} flexDirection="row">
              <Text bold color={RecapView.COLORS.commits}>{(index === 0 ? label : '').padEnd(RecapText.LABEL_WIDTH)}</Text>
              {repoWidth > 0 && <Text dimColor>{(commit.repo ?? '').padEnd(repoWidth)}</Text>}
              {url === undefined
                ? <Text>{commit.label}</Text>
                : RecapView.action(elements, `${label}-${commit.repo ?? ''}`, commit.label, () => handlers.onOpenFile(url))}
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
    return count < RecapView.TOKENS_PER_K ? String(count) : `${(count / RecapView.TOKENS_PER_K).toFixed(1)}k`
  }

}
