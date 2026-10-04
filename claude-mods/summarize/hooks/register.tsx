import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { ArtifactExtractor } from './artifactExtractor'
import { IterationRecorder } from './iterationRecorder'
import { RecapCursor } from './recapCursor'
import { RecapSummarizer } from './recapSummarizer'
import { GitFacts } from './gitFacts'
import { RecapView } from './recapView'
import { RepoLink } from './repoLink'

import type { IterationRecapEntry, IterationRecapHandlers, IterationRecapLink, IterationRecapScope } from '../types'

const PLUGIN = 'summarize'
const PANE = 'summarize'
const COMMAND = 'summarize'
const PANE_ROWS = 28
const MAX_ITERATIONS = 200
const MAX_REPO_LOOKUPS = 8
const GIT_TIMEOUT_MS = 3000
const ENRICH_DELAY_MS = 1
const SESSION_DIRECTORY = '.'
const GH_TIMEOUT_MS = 5000
const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'HEAD'])
const branchPullRequests = new Map<string, IterationRecapLink>()
const GIT_STATE_COMMANDS = [['rev-parse', 'HEAD'], ['status', '--porcelain'], ['diff', 'HEAD', '--numstat']] as const
const RESERVED_TOOL_KEYS = new Set(['tool', 'tool_use_id', 'agentId', 'consent'])

const iterations = atom({ plugin: 'summarize', key: 'iterations' } as const, [] as IterationRecapEntry[])
const cursor = atom({ plugin: 'summarize', key: 'cursor' } as const, null as number | null)
const isBandHidden = atom({ plugin: 'summarize', key: 'isBandHidden' } as const, false)
const isPaneDismissed = atom({ plugin: 'summarize', key: 'isPaneDismissed' } as const, false)
const isActive = atom({ plugin: 'summarize', key: 'isActive' } as const, false)
const isPromptOpen = atom({ plugin: 'summarize', key: 'isPromptOpen' } as const, false)
const isHistoryOpen = atom({ plugin: 'summarize', key: 'isHistoryOpen' } as const, false)

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
    onTogglePrompt: () => void update($, isPromptOpen, isOpen => !isOpen),
    onToggleHistory: () => void update($, isHistoryOpen, isOpen => !isOpen),
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

async function repoRoots($: EngineInterface, directories: readonly string[]): Promise<string[]> {
  const roots = await Promise.all(directories.slice(0, MAX_REPO_LOOKUPS).map(directory => repoRoot($, directory)))

  return [...new Set(roots.filter((root): root is string => root !== null))]
}

async function gitOutput($: EngineInterface, root: string, args: readonly string[]): Promise<string> {
  const { exitCode, stdout } = await $.process.run(['git', '-C', root, ...args], { timeoutMs: GIT_TIMEOUT_MS })

  return exitCode === 0 ? stdout : ''
}

async function repoState($: EngineInterface, root: string): Promise<string | null> {
  try {
    const parts = await Promise.all(GIT_STATE_COMMANDS.map(args => gitOutput($, root, args)))

    return parts.join('\n')
  } catch (error) {
    $.ui.log(`${PLUGIN}: git state failed for ${root}: ${error instanceof Error ? error.message : String(error)}`)

    return null
  }
}

async function sessionRepoSnapshot($: EngineInterface): Promise<{ root: string | null; state: string | null }> {
  const root = await repoRoot($, SESSION_DIRECTORY)

  return { root, state: root === null ? null : await repoState($, root) }
}

async function isRepoChangedSince($: EngineInterface, root: string | null, startState: string | null): Promise<boolean> {
  if (root === null || startState === null) {
    return false
  }

  return (await repoState($, root)) !== startState
}

async function repoLinks($: EngineInterface, roots: readonly string[]): Promise<IterationRecapLink[]> {
  return Promise.all(roots.map(async root => RepoLink.fromRoot(root, await gitOutput($, root, ['remote', 'get-url', 'origin']))))
}

async function branchPullRequest($: EngineInterface, root: string): Promise<IterationRecapLink | null> {
  const branch = (await gitOutput($, root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (branch === '' || DEFAULT_BRANCHES.has(branch)) {
    return null
  }
  const key = `${root}@${branch}`
  const known = branchPullRequests.get(key)
  if (known !== undefined) {
    return known
  }
  try {
    const { exitCode, stdout } = await $.process.run(['gh', 'pr', 'view', branch, '--json', 'number,url'], { cwd: root, timeoutMs: GH_TIMEOUT_MS })
    const link = exitCode === 0 ? GitFacts.branchPullRequest(stdout) : null
    if (link !== null) {
      branchPullRequests.set(key, link)
    }

    return link
  } catch (error) {
    $.ui.log(`${PLUGIN}: gh pr view failed for ${root}: ${error instanceof Error ? error.message : String(error)}`)

    return null
  }
}

function repoName(root: string): string {
  return root.split('/').at(-1) ?? root
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

async function resolveRepos($: EngineInterface, entry: IterationRecapEntry, scope: IterationRecapScope): Promise<IterationRecapEntry> {
  try {
    const [touchedRoots, changedRoots, isSessionRepoChanged] = await Promise.all([
      repoRoots($, scope.touchedDirectories),
      repoRoots($, scope.changedDirectories),
      isRepoChangedSince($, scope.startRoot, scope.startState),
    ])
    const allChangedRoots = isSessionRepoChanged && scope.startRoot !== null ? [scope.startRoot, ...changedRoots] : changedRoots
    const repos = [...new Set([...[...allChangedRoots, ...touchedRoots].map(repoName), ...entry.artifacts.repos])]
    const uniqueChangedRoots = [...new Set(allChangedRoots)]
    const [rootLinks, branchLinks] = await Promise.all([
      repoLinks($, uniqueChangedRoots),
      Promise.all([...new Set([...uniqueChangedRoots, ...(scope.startRoot === null ? [] : [scope.startRoot])])].map(root => branchPullRequest($, root))),
    ])
    const changedRepos = RepoLink.unique([...rootLinks, ...ArtifactExtractor.createdPullRequestRepos(entry.artifacts)])
    const knownLabels = new Set(entry.artifacts.pullRequests.map(link => link.label))
    const branchPrs = branchLinks.filter((link): link is IterationRecapLink => link !== null && !knownLabels.has(link.label))

    return { ...entry, artifacts: { ...entry.artifacts, repos, changedRepos, pullRequests: [...entry.artifacts.pullRequests, ...branchPrs] } }
  } catch (error) {
    $.ui.log(`${PLUGIN}: repo lookup failed for iteration ${entry.index}: ${error instanceof Error ? error.message : String(error)}`)

    return { ...entry, artifacts: { ...entry.artifacts, changedRepos: ArtifactExtractor.createdPullRequestRepos(entry.artifacts) } }
  }
}

async function enrich($: EngineInterface, entry: IterationRecapEntry, answer: string, isModelSummary: boolean): Promise<void> {
  const hasWork = answer.trim() !== '' || Object.keys(entry.toolCounts).length > 0
  const shouldSummarize = isModelSummary && entry.endReason !== 'aborted' && hasWork
  if (shouldSummarize) {
    await summarize($, entry, answer)
  }
}

async function enrichSafely($: EngineInterface, entry: IterationRecapEntry, answer: string, isModelSummary: boolean): Promise<void> {
  try {
    await enrich($, entry, answer, isModelSummary)
  } catch (error) {
    $.ui.log(`${PLUGIN}: recap enrichment failed for iteration ${entry.index}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const register: Register = (on, options) => {
  const recorder = new IterationRecorder()
  let turnStartRepo: { root: string | null; state: string | null } = { root: null, state: null }
  const isModelSummary = options.summarizer === 'haiku'
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
    turnStartRepo = await sessionRepoSnapshot($)

    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    recorder.noteSkill(e.skill)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const input = Object.fromEntries(Object.entries(e).filter(([key]) => !RESERVED_TOOL_KEYS.has(key)))
    const denial = typeof ran.deny === 'string' ? ran.deny : undefined
    const git = e.tool === 'Bash' ? GitFacts.fromBashResult(ran.result) : undefined
    recorder.record(String(e.tool), input, denial ?? ran.text ?? '', denial !== undefined || ran.isError === true, git)

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
      startRoot: turnStartRepo.root,
      startState: turnStartRepo.state,
    }
    const list = await read($, iterations)
    const index = (list.at(-1)?.index ?? 0) + 1
    const recorded = recorder.finish(
      { turnId: e.turnId, answer: e.answer, durationMs: e.durationMs, reason: e.reason, outputTokens: e.usage?.output_tokens ?? 0 },
      index,
      await $.clock.now(),
    )
    if (recorded === null) {
      return done
    }
    const entry = await resolveRepos($, recorded, scope)
    await update($, iterations, current => [...current, entry].slice(-MAX_ITERATIONS))
    await autoOpenPane($)
    $.clock.after(ENRICH_DELAY_MS, () => void enrichSafely($, entry, e.answer, isModelSummary))

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

    const layout = {
      isPromptOpen: await read($, isPromptOpen),
      isHistoryOpen: await read($, isHistoryOpen),
      bodyRows: e.props.scroll.bodyRows,
    }

    return RecapView.pane($.ui.resolve(e), list, selected, await $.session.cwd(), layout, handlersFor($))
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
