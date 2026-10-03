import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { ArtifactExtractor } from './artifactExtractor'
import { IterationRecorder } from './iterationRecorder'
import { RecapCursor } from './recapCursor'
import { RecapSummarizer } from './recapSummarizer'
import { RecapView } from './recapView'

import type { IterationRecapEntry, IterationRecapHandlers, IterationRecapScope } from '../types'

const PLUGIN = 'iteration-recap'
const PANE = 'iteration-recap'
const COMMAND = 'summarize'
const PANE_ROWS = 28
const MAX_ITERATIONS = 200
const MAX_REPO_LOOKUPS = 8
const GIT_TIMEOUT_MS = 3000
const ENRICH_DELAY_MS = 1
const RESERVED_TOOL_KEYS = new Set(['tool', 'tool_use_id', 'agentId', 'consent'])

const iterations = atom({ plugin: 'iteration-recap', key: 'iterations' } as const, [] as IterationRecapEntry[])
const cursor = atom({ plugin: 'iteration-recap', key: 'cursor' } as const, null as number | null)
const isBandHidden = atom({ plugin: 'iteration-recap', key: 'isBandHidden' } as const, false)
const isPaneDismissed = atom({ plugin: 'iteration-recap', key: 'isPaneDismissed' } as const, false)
const isActive = atom({ plugin: 'iteration-recap', key: 'isActive' } as const, false)

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Summarize', rows: PANE_ROWS })
}

async function autoOpenPane($: EngineInterface): Promise<void> {
  const list = await read($, iterations)
  const isShown = (await read($, isActive)) && !(await read($, isPaneDismissed))
  if (list.length === 0 || !isShown) {
    return
  }
  await openPane($)
}

async function moveCursor($: EngineInterface, choose: (list: IterationRecapEntry[], current: number | null) => number | null): Promise<void> {
  const list = await read($, iterations)
  await update($, cursor, current => choose(list, current))
}

function handlersFor($: EngineInterface): IterationRecapHandlers {
  return {
    onPrevious: () => void moveCursor($, (list, current) => RecapCursor.step(list, current, -1)),
    onNext: () => void moveCursor($, (list, current) => RecapCursor.step(list, current, 1)),
    onLatest: () => void moveCursor($, () => null),
    onJump: index => void moveCursor($, list => RecapCursor.jump(list, index)),
    onOpen: () => void openPane($),
    onHide: () => void update($, isBandHidden, () => true),
  }
}

async function patchEntry($: EngineInterface, index: number, patch: Partial<IterationRecapEntry>): Promise<void> {
  await update($, iterations, list => list.map(entry => (entry.index === index ? { ...entry, ...patch } : entry)))
}

async function repoRoot($: EngineInterface, directory: string): Promise<string | null> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', '-C', directory, 'rev-parse', '--show-toplevel'], { timeoutMs: GIT_TIMEOUT_MS })

    return exitCode === 0 && stdout.trim() !== '' ? stdout.trim() : null
  } catch (error) {
    $.ui.log(`${PLUGIN}: git lookup failed for ${directory}: ${error instanceof Error ? error.message : String(error)}`)

    return null
  }
}

async function localRepos($: EngineInterface, directories: readonly string[]): Promise<string[]> {
  const roots = new Set<string>()
  for (const directory of directories.slice(0, MAX_REPO_LOOKUPS)) {
    const root = await repoRoot($, directory)
    if (root !== null) {
      roots.add(root)
    }
  }

  return [...roots].map(root => root.split('/').at(-1) ?? root)
}

async function summarize($: EngineInterface, entry: IterationRecapEntry, answer: string): Promise<void> {
  const reply = await $.model.complete({
    model: RecapSummarizer.MODEL,
    system: RecapSummarizer.SYSTEM,
    prompt: RecapSummarizer.buildPrompt(entry, answer),
    maxTokens: RecapSummarizer.MAX_TOKENS,
    effort: 'low',
    timeoutMs: RecapSummarizer.TIMEOUT_MS,
  })
  const summary = reply.isAnswered ? RecapSummarizer.clean(reply.text) : null
  if (summary !== null) {
    await patchEntry($, entry.index, { summary, isSummaryFromModel: true })
  }
}

async function enrich($: EngineInterface, entry: IterationRecapEntry, answer: string, scope: IterationRecapScope, isModelSummary: boolean): Promise<void> {
  const local = await localRepos($, scope.touchedDirectories)
  const localChanged = await localRepos($, scope.changedDirectories)
  const repos = [...new Set([...local, ...entry.artifacts.repos])]
  const changedRepos = [...new Set([...localChanged, ...ArtifactExtractor.createdPullRequestRepos(entry.artifacts)])]
  await patchEntry($, entry.index, { artifacts: { ...entry.artifacts, repos, changedRepos } })

  const hasWork = answer.trim() !== '' || Object.keys(entry.toolCounts).length > 0
  const shouldSummarize = isModelSummary && entry.endReason !== 'aborted' && hasWork
  if (shouldSummarize) {
    await summarize($, entry, answer)
  }
}

async function enrichSafely($: EngineInterface, entry: IterationRecapEntry, answer: string, scope: IterationRecapScope, isModelSummary: boolean): Promise<void> {
  try {
    await enrich($, entry, answer, scope, isModelSummary)
  } catch (error) {
    $.ui.log(`${PLUGIN}: recap enrichment failed for iteration ${entry.index}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const register: Register = (on, options) => {
  const recorder = new IterationRecorder()
  const isModelSummary = options.summarizer !== 'heuristic'
  const isBandEnabled = options.showBand !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Summarize the last iteration and keep summarizing new ones; browse earlier ones (prev, next, last, <n>, band)',
      argumentHint: '[prev|next|last|<n>|band]',
    })
    await autoOpenPane($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    recorder.start(e.turnId, e.text, await $.clock.now())

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) {
      return ran
    }
    const input = Object.fromEntries(Object.entries(e).filter(([key]) => !RESERVED_TOOL_KEYS.has(key)))
    const denial = typeof ran.deny === 'string' ? ran.deny : undefined
    recorder.record(String(e.tool), input, denial ?? ran.text ?? '', denial !== undefined || ran.isError === true)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) {
      return done
    }
    const scope: IterationRecapScope = {
      touchedDirectories: ArtifactExtractor.candidateDirectories(recorder.toolCalls),
      changedDirectories: ArtifactExtractor.changeDirectories(recorder.toolCalls),
    }
    const list = await read($, iterations)
    const index = (list.at(-1)?.index ?? 0) + 1
    const entry = recorder.finish(
      { turnId: e.turnId, answer: e.answer, durationMs: e.durationMs, reason: e.reason, outputTokens: e.usage?.output_tokens ?? 0 },
      index,
      await $.clock.now(),
    )
    if (entry === null) {
      return done
    }
    await update($, iterations, current => [...current, entry].slice(-MAX_ITERATIONS))
    await autoOpenPane($)
    $.clock.after(ENRICH_DELAY_MS, () => void enrichSafely($, entry, e.answer, scope, isModelSummary))

    return done
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    await update($, isActive, () => true)
    if (word === 'band') {
      const isHidden = await read($, isBandHidden)
      await update($, isBandHidden, () => !isHidden)

      return { text: isHidden ? 'Recap band shown.' : 'Recap band hidden.' }
    }
    const list = await read($, iterations)
    const current = await read($, cursor)
    const target = word === '' ? current : RecapCursor.parse(word, list, current)
    await update($, cursor, () => target)
    await update($, isPaneDismissed, () => false)
    await openPane($)

    return { text: RecapView.commandText(RecapCursor.selected(list, target), list, await $.session.cwd()) }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      await update($, isPaneDismissed, () => true)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, iterations)
    const selected = RecapCursor.selected(list, await read($, cursor))

    return RecapView.pane($.ui.resolve(e), list, selected, await $.session.cwd(), handlersFor($))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isQuiet = !isBandEnabled || e.props.hasSurvey || !(await read($, isActive)) || (await read($, isBandHidden))
    if (isQuiet) {
      return next(e)
    }
    const list = await read($, iterations)
    const latest = list.at(-1)
    if (latest === undefined) {
      return next(e)
    }

    return RecapView.band($.ui.resolve(e), latest, list.length, handlersFor($))
  })
}
