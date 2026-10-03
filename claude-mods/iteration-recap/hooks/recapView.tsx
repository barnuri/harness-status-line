import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { IterationRecapEntry, IterationRecapHandlers, IterationRecapLink } from '../types'

type RecapViewElements = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button' | 'Link'>

export class RecapView {
  private static readonly LABEL_WIDTH = 9
  private static readonly HISTORY_ROWS = 8
  private static readonly OPEN_QUESTION_COLOR = 'yellow'
  private static readonly ACCENT_COLOR = 'cyan'
  private static readonly MS_PER_SECOND = 1000
  private static readonly SECONDS_PER_MINUTE = 60
  private static readonly TOKENS_PER_K = 1000

  public static pane(
    elements: RecapViewElements,
    iterations: readonly IterationRecapEntry[],
    selected: IterationRecapEntry | undefined,
    cwd: string,
    handlers: IterationRecapHandlers,
  ): RenderElement {
    const { Box, Text } = elements
    if (selected === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No iterations yet. Each finished turn gets a recap here.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {RecapView.header(elements, selected, iterations.length)}
        <Text bold wrap="wrap">{selected.summary}</Text>
        <Text> </Text>
        {RecapView.details(elements, selected, cwd)}
        <Text> </Text>
        {RecapView.navigation(elements, selected, iterations, handlers)}
        <Text> </Text>
        {RecapView.history(elements, selected, iterations, handlers)}
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
    const counts = [
      RecapView.plural(latest.artifacts.files.length, 'file'),
      RecapView.plural(latest.artifacts.commits.length, 'commit'),
      RecapView.plural(latest.artifacts.pullRequests.length, 'PR'),
      RecapView.plural(latest.artifacts.reviews.length, 'review'),
      RecapView.plural(latest.artifacts.plans.length, 'plan'),
    ].filter(count => count !== '')

    return (
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={RecapView.ACCENT_COLOR}>↻ #{latest.index}/{total}</Text>
            <Text dimColor> {RecapView.duration(latest.durationMs)} · </Text>
            {latest.summary}
            {counts.length > 0 && <Text dimColor> · {counts.join(' · ')}</Text>}
            {openQuestions > 0 && <Text color={RecapView.OPEN_QUESTION_COLOR}> · {openQuestions} open ?</Text>}
          </Text>
        </Box>
        <Box flexShrink={0} paddingRight={4}>
          <Text> </Text>
          <Button key="open" label="recap" hotkey="r" onPress={handlers.onOpen} />
          <Button key="hide" label="×" hotkey="x" onPress={handlers.onHide} />
        </Box>
      </Box>
    )
  }

  public static commandText(selected: IterationRecapEntry | undefined, total: number, cwd: string): string {
    if (selected === undefined) {
      return 'No iterations recorded yet.'
    }
    const { artifacts } = selected
    const lines = [
      `Iteration ${selected.index}/${total} · ${RecapView.clock(selected.startedAt)} · ${RecapView.duration(selected.durationMs)}`,
      selected.summary,
      RecapView.textRow('files', artifacts.files.map(file => RecapView.relative(file, cwd))),
      RecapView.textRow('repos', artifacts.repos),
      RecapView.textRow('PRs', artifacts.pullRequests.map(pr => pr.url ?? pr.label)),
      RecapView.textRow('reviews', artifacts.reviews),
      RecapView.textRow('plans', artifacts.plans.map(plan => RecapView.relative(plan, cwd))),
      RecapView.textRow('commits', artifacts.commits),
      RecapView.textRow('open', RecapView.openQuestions(selected)),
    ]

    return lines.filter(line => line !== '').join('\n')
  }

  private static header(elements: RecapViewElements, selected: IterationRecapEntry, total: number): RenderElement {
    const { Box, Text } = elements
    const facts = [
      RecapView.clock(selected.startedAt),
      RecapView.duration(selected.durationMs),
      selected.outputTokens > 0 ? `${RecapView.tokens(selected.outputTokens)} out` : '',
      selected.endReason === 'answer' ? '' : selected.endReason,
      selected.isSummaryFromModel ? 'haiku' : '',
    ].filter(fact => fact !== '')

    return (
      <Box flexDirection="row">
        <Text bold color={RecapView.ACCENT_COLOR}>Iteration {selected.index}/{total}  </Text>
        <Text dimColor>{facts.join(' · ')}</Text>
      </Box>
    )
  }

  private static details(elements: RecapViewElements, selected: IterationRecapEntry, cwd: string): RenderElement {
    const { Box } = elements
    const { artifacts } = selected
    const tools = Object.entries(selected.toolCounts)
      .sort(([, left], [, right]) => right - left)
      .map(([tool, count]) => `${tool}×${count}`)
    const openQuestions = RecapView.openQuestions(selected)
    const answeredQuestions = artifacts.questions.filter(question => question.isAnswered).map(question => `✓ ${question.text}`)

    return (
      <Box flexDirection="column">
        {RecapView.row(elements, 'prompt', selected.prompt === '' ? [] : [selected.prompt])}
        {RecapView.row(elements, 'tools', tools.length === 0 ? [] : [tools.join('  ')])}
        {RecapView.row(elements, 'files', artifacts.files.map(file => RecapView.relative(file, cwd)))}
        {RecapView.row(elements, 'repos', artifacts.repos)}
        {RecapView.linkRow(elements, 'PRs', artifacts.pullRequests)}
        {RecapView.row(elements, 'reviews', artifacts.reviews)}
        {RecapView.row(elements, 'plans', artifacts.plans.map(plan => RecapView.relative(plan, cwd)))}
        {RecapView.row(elements, 'commits', artifacts.commits)}
        {RecapView.row(elements, 'asked', answeredQuestions)}
        {RecapView.row(elements, 'open ?', openQuestions, RecapView.OPEN_QUESTION_COLOR)}
      </Box>
    )
  }

  private static navigation(
    elements: RecapViewElements,
    selected: IterationRecapEntry,
    iterations: readonly IterationRecapEntry[],
    handlers: IterationRecapHandlers,
  ): RenderElement {
    const { Box, Button } = elements
    const first = iterations[0]?.index ?? selected.index
    const last = iterations.at(-1)?.index ?? selected.index

    return (
      <Box flexDirection="row">
        <Button key="previous" label="◀ prev" hotkey="p" dimColor={selected.index <= first} onPress={handlers.onPrevious} />
        <Button key="next" label="next ▶" hotkey="n" dimColor={selected.index >= last} onPress={handlers.onNext} />
        <Button key="latest" label="latest" hotkey="l" dimColor={selected.index >= last} onPress={handlers.onLatest} />
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
      <Box flexDirection="column">
        <Text dimColor>History ({iterations.length})</Text>
        {recent.map(entry => (
          <Box key={`history-${entry.index}`} flexDirection="row">
            <Text color={entry.index === selected.index ? RecapView.ACCENT_COLOR : undefined}>
              {entry.index === selected.index ? '› ' : '  '}
            </Text>
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

  private static row(elements: RecapViewElements, label: string, values: readonly string[], color?: string): RenderElement | null {
    const { Box, Text } = elements
    if (values.length === 0) {
      return null
    }

    return (
      <Box flexDirection="row">
        <Text dimColor>{label.padEnd(RecapView.LABEL_WIDTH)}</Text>
        <Text color={color} wrap="wrap">{values.join(', ')}</Text>
      </Box>
    )
  }

  private static linkRow(elements: RecapViewElements, label: string, links: readonly IterationRecapLink[]): RenderElement | null {
    const { Box, Text, Link } = elements
    if (links.length === 0) {
      return null
    }

    return (
      <Box flexDirection="row" flexWrap="wrap">
        <Text dimColor>{label.padEnd(RecapView.LABEL_WIDTH)}</Text>
        {links.map(link => (link.url === undefined ? <Text>{link.label} </Text> : <Link href={link.url} label={`${link.label} `} />))}
      </Box>
    )
  }

  private static openQuestions(entry: IterationRecapEntry): string[] {
    return entry.artifacts.questions.filter(question => !question.isAnswered).map(question => question.text)
  }

  private static textRow(label: string, values: readonly string[]): string {
    return values.length === 0 ? '' : `${label.padEnd(RecapView.LABEL_WIDTH)}${values.join(', ')}`
  }

  private static relative(path: string, cwd: string): string {
    const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`

    return cwd !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : path
  }

  private static plural(count: number, noun: string): string {
    if (count === 0) {
      return ''
    }

    return `${count} ${noun}${count === 1 ? '' : 's'}`
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
