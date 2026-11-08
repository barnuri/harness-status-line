import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { SessionTotals } from './sessionTotals'

import type { IterationRecapEntry, IterationRecapHandlers, IterationRecapLink, IterationRecapPaneLayout, SessionAnswer, SessionAnswers } from '../types'

type RecapViewElements = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button' | 'Link'>

export class RecapView {
  private static readonly LABEL_WIDTH = 10
  private static readonly HISTORY_ROWS = 8
  private static readonly COLLAPSED_ANSWERS = 3
  private static readonly NONE = 'none'
  private static readonly COLORS = {
    accent: 'cyan',
    session: 'magenta',
    summary: 'whiteBright',
    skills: 'magentaBright',
    changed: 'greenBright',
    tools: 'blueBright',
    files: 'white',
    links: 'cyanBright',
    reviews: 'yellowBright',
    plans: 'blueBright',
    commits: 'green',
    asked: 'green',
    open: 'yellow',
    prompt: 'gray',
  } as const
  private static readonly MS_PER_SECOND = 1000
  private static readonly SECONDS_PER_MINUTE = 60
  private static readonly TOKENS_PER_K = 1000

  public static pane(
    elements: RecapViewElements,
    iterations: readonly IterationRecapEntry[],
    selected: IterationRecapEntry | undefined,
    cwd: string,
    layout: IterationRecapPaneLayout,
    handlers: IterationRecapHandlers,
    answers: SessionAnswers | null = null,
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
          {RecapView.session(elements, iterations, handlers)}
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

  public static band(
    elements: RecapViewElements,
    latest: IterationRecapEntry,
    total: number,
    handlers: IterationRecapHandlers,
  ): RenderElement {
    const { Box, Text, Button } = elements
    const openQuestions = RecapView.openQuestions(latest).length

    return (
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text bold color={RecapView.COLORS.accent}>↻ #{latest.index}/{total}</Text>
            <Text dimColor> {RecapView.duration(latest.durationMs)} · </Text>
            <Text color={RecapView.COLORS.summary}>{latest.summary}</Text>
            {openQuestions > 0 && <Text color={RecapView.COLORS.open}> · {openQuestions} open ?</Text>}
          </Text>
        </Box>
        <Box flexShrink={0} paddingRight={4}>
          <Text> </Text>
          <Button key="open" label="summary" hotkey="r" onPress={handlers.onOpen} />
          <Button key="hide" label="×" hotkey="x" onPress={handlers.onHide} />
        </Box>
      </Box>
    )
  }

  public static commandText(
    selected: IterationRecapEntry | undefined,
    iterations: readonly IterationRecapEntry[],
    cwd: string,
    answers: SessionAnswers | null = null,
    showFilePaths = false,
  ): string {
    if (selected === undefined) {
      return 'No iterations recorded yet.'
    }
    const { artifacts } = selected
    const lines = [
      'This session',
      RecapView.alwaysTextRow('repos', SessionTotals.changedRepos(iterations).map(repo => repo.url ?? repo.label)),
      RecapView.alwaysTextRow('PRs', SessionTotals.pullRequests(iterations).map(pr => pr.url ?? pr.label)),
      RecapView.alwaysTextRow('skills', SessionTotals.skills(iterations)),
      ...RecapView.answerLines(answers, iterations),
      `Iteration ${selected.index}/${iterations.length} · ${RecapView.clock(selected.startedAt)} · ${RecapView.duration(selected.durationMs)}`,
      selected.summary,
      RecapView.alwaysTextRow('tools', RecapView.toolList(selected)),
      RecapView.textRow('files', RecapView.fileValues(artifacts.files, cwd, showFilePaths)),
      RecapView.textRow('reviews', artifacts.reviews),
      RecapView.textRow('plans', artifacts.plans.map(plan => RecapView.relative(plan, cwd))),
      RecapView.textRow('commits', artifacts.commits),
      RecapView.textRow('open', RecapView.openQuestions(selected)),
    ]

    return lines.filter(line => line !== '').join('\n')
  }

  private static session(elements: RecapViewElements, iterations: readonly IterationRecapEntry[], handlers: IterationRecapHandlers): RenderElement {
    const { Box, Text } = elements

    return (
      <Box flexDirection="column">
        <Text bold color={RecapView.COLORS.session}>◆ This session</Text>
        {RecapView.alwaysLinkRow(elements, 'repos', SessionTotals.changedRepos(iterations), RecapView.COLORS.changed, handlers)}
        {RecapView.alwaysLinkRow(elements, 'PRs', SessionTotals.pullRequests(iterations), RecapView.COLORS.links, handlers)}
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
    const all = RecapView.sessionAnswers(answers, iterations)
    const items = isQaOpen ? all : all.slice(-RecapView.COLLAPSED_ANSWERS)
    if (items.length === 0) {
      return null
    }
    const hidden = all.length - items.length
    const html = answers === null ? undefined : answers.path.replace(/\.md$/, '.html')

    return (
      <Box flexDirection="column">
        <Text bold color={RecapView.COLORS.session}>◆ Answers ({all.length})  <Text dimColor>{answers?.session || answers?.slug || 'this session'}</Text></Text>
        {hidden > 0 && <Text dimColor>  {hidden} earlier, press q for all</Text>}
        {html !== undefined && <Box flexDirection="row"><Button key="open-answers" plain label="open answers.html" hotkey="o" onPress={() => handlers.onOpenFile(html)} /></Box>}
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

  /** answers.md items first, then every answered ask of the session not already in the file. */
  private static sessionAnswers(answers: SessionAnswers | null, iterations: readonly IterationRecapEntry[]): SessionAnswer[] {
    const fromFile = (answers?.items ?? []).filter(item => item.answer !== '')
    const known = new Set(fromFile.map(item => item.question))
    const asked = iterations
      .flatMap(entry => entry.artifacts.questions)
      .filter(question => question.answer !== undefined && !known.has(question.fullText ?? question.text))
      .map((question, index) => ({ number: `A${index + 1}`, question: question.fullText ?? question.text, answer: question.answer ?? '' }))

    return [...fromFile, ...asked]
  }

  private static answerLines(answers: SessionAnswers | null, iterations: readonly IterationRecapEntry[]): string[] {
    const items = RecapView.sessionAnswers(answers, iterations)
    if (items.length === 0) {
      return []
    }

    return [`Answers (${answers?.session || answers?.slug || 'this session'})`, ...items.map(item => `${item.number} ${item.answer}\n    ↳ ${item.question}`)]
  }

  private static header(elements: RecapViewElements, selected: IterationRecapEntry, total: number): RenderElement {
    const { Box, Text } = elements
    const facts = [
      RecapView.clock(selected.startedAt),
      RecapView.duration(selected.durationMs),
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
        {RecapView.alwaysRow(elements, 'tools', RecapView.toolList(selected), RecapView.COLORS.tools)}
        {RecapView.row(elements, 'files', RecapView.fileValues(artifacts.files, cwd, layout.showFilePaths), RecapView.COLORS.files)}
        {RecapView.row(elements, 'reviews', artifacts.reviews, RecapView.COLORS.reviews)}
        {RecapView.row(elements, 'plans', artifacts.plans.map(plan => RecapView.relative(plan, cwd)), RecapView.COLORS.plans)}
        {RecapView.row(elements, 'commits', artifacts.commits, RecapView.COLORS.commits)}
        {RecapView.row(elements, 'asked', answeredQuestions, RecapView.COLORS.asked)}
        {RecapView.row(elements, 'open ?', RecapView.openQuestions(selected), RecapView.COLORS.open)}
      </Box>
    )
  }

  private static prompt(elements: RecapViewElements, selected: IterationRecapEntry): RenderElement {
    const { Box, Text } = elements

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={RecapView.COLORS.prompt}>prompt</Text>
        <Text color={RecapView.COLORS.prompt} wrap="wrap">{selected.prompt === '' ? RecapView.NONE : selected.prompt}</Text>
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
        <Button key="previous" plain label="◀" hotkey="p" dimColor={selected.index <= first} onPress={handlers.onPrevious} />
        <Button key="next" plain label="▶" hotkey="n" dimColor={selected.index >= last} onPress={handlers.onNext} />
        <Button key="latest" plain label="⏭" hotkey="l" dimColor={selected.index >= last} onPress={handlers.onLatest} />
        <Button key="toggle-history" plain label={layout.isHistoryOpen ? '☰ ▾' : '☰'} hotkey="h" onPress={handlers.onToggleHistory} />
        <Button key="toggle-prompt" plain label={layout.isPromptOpen ? '✎ ▾' : '✎'} hotkey="i" onPress={handlers.onTogglePrompt} />
        <Button key="toggle-qa" plain label={layout.isQaOpen ? 'Q&A ▾' : 'Q&A'} hotkey="q" onPress={handlers.onToggleQa} />
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
            <Button
              key={`jump-${entry.index}`}
              plain
              dimColor={entry.index !== selected.index}
              label={`#${entry.index} ${RecapView.clock(entry.startedAt)} ${entry.summary}`}
              onPress={() => handlers.onJump(entry.index)}
            />
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
        <Text bold color={color}>{label.padEnd(RecapView.LABEL_WIDTH)}</Text>
        <Text color={isEmpty ? undefined : color} dimColor={isEmpty} wrap="wrap">{isEmpty ? RecapView.NONE : values.join(', ')}</Text>
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
      <Box flexDirection="row" flexWrap="wrap">
        <Text bold color={color}>{label.padEnd(RecapView.LABEL_WIDTH)}</Text>
        {links.length === 0 && <Text dimColor>{RecapView.NONE}</Text>}
        {links.map(link => {
          const url = link.url
          const text = `${link.isCreated === true ? '+ ' : ''}${link.label}`

          return url === undefined
            ? <Text key={`${label}-${link.label}`}>{text} </Text>
            : <Button key={`${label}-${link.label}`} plain label={text} onPress={() => handlers.onOpenFile(RecapView.openTarget(url))} />
        })}
      </Box>
    )
  }

  private static toolList(entry: IterationRecapEntry): string[] {
    const tools = Object.entries(entry.toolCounts)
      .sort(([, left], [, right]) => right - left)
      .map(([tool, count]) => `${tool}×${count}`)

    return tools.length === 0 ? [] : [tools.join('  ')]
  }

  private static openQuestions(entry: IterationRecapEntry): string[] {
    return entry.artifacts.questions.filter(question => !question.isAnswered).map(question => question.text)
  }

  private static alwaysTextRow(label: string, values: readonly string[]): string {
    return `${label.padEnd(RecapView.LABEL_WIDTH)}${values.length === 0 ? RecapView.NONE : values.join(', ')}`
  }

  private static textRow(label: string, values: readonly string[]): string {
    return values.length === 0 ? '' : RecapView.alwaysTextRow(label, values)
  }

  /** File paths when `showPaths`, else one count such as `3 files`. */
  private static fileValues(files: readonly string[], cwd: string, showPaths: boolean): string[] {
    if (files.length === 0) {
      return []
    }

    return showPaths ? files.map(file => RecapView.relative(file, cwd)) : [`${files.length} file${files.length === 1 ? '' : 's'}`]
  }

  /** A `file://` URL as a plain path for `open`; any other URL unchanged. */
  private static openTarget(url: string): string {
    return url.startsWith('file://') ? url.slice('file://'.length) : url
  }

  private static relative(path: string, cwd: string): string {
    const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`

    return cwd !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : path
  }

  private static duration(ms: number): string {
    const totalSeconds = Math.round(ms / RecapView.MS_PER_SECOND)
    const minutes = Math.floor(totalSeconds / RecapView.SECONDS_PER_MINUTE)
    const seconds = totalSeconds % RecapView.SECONDS_PER_MINUTE

    return minutes === 0 ? `${seconds}s` : `${minutes}m${String(seconds).padStart(2, '0')}s`
  }

  private static tokens(count: number): string {
    return count < RecapView.TOKENS_PER_K ? String(count) : `${(count / RecapView.TOKENS_PER_K).toFixed(1)}k`
  }

  private static clock(epochMs: number): string {
    const date = new Date(epochMs)

    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
}
