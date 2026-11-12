import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { ArtifactExtractor } from './artifactExtractor'
import { IterationRecorder } from './iterationRecorder'
import { RecapCursor } from './recapCursor'
import { GitFacts } from './gitFacts'
import { RecapView } from './recapView'
import { RecapErrorLog } from './recapErrorLog'
import { RecapRepos } from './recapRepos'
import { RecapSessionFiles } from './recapSessionFiles'

import type { RecapHost } from './recapHost'

import type { IterationRecapEntry, IterationRecapHandlers, IterationRecapLink, IterationRecapScope, SessionAnswers, SessionOverview } from '../types'

const PANE = 'summarize'
const COMMAND = 'summarize'
const PANE_ROWS = 28
const MAX_ITERATIONS = 200
const SESSION_DIRECTORY = '.'
const branchPullRequests = new Map<string, IterationRecapLink>()
const RESERVED_TOOL_KEYS = new Set(['tool', 'tool_use_id', 'agentId', 'consent'])

const iterations = atom({ plugin: 'summarize', key: 'iterations' } as const, [] as IterationRecapEntry[])
const cursor = atom({ plugin: 'summarize', key: 'cursor' } as const, null as number | null)
const isBandHidden = atom({ plugin: 'summarize', key: 'isBandHidden' } as const, false)
const isPaneDismissed = atom({ plugin: 'summarize', key: 'isPaneDismissed' } as const, false)
const isActive = atom({ plugin: 'summarize', key: 'isActive' } as const, true)
const answers = atom({ plugin: 'summarize', key: 'answers' } as const, null as SessionAnswers | null)
const overview = atom({ plugin: 'summarize', key: 'overview' } as const, null as SessionOverview | null)
const sessionHead = atom({ plugin: 'summarize', key: 'sessionHead' } as const, null as IterationRecapLink | null)
const isPromptOpen = atom({ plugin: 'summarize', key: 'isPromptOpen' } as const, false)
const isHistoryOpen = atom({ plugin: 'summarize', key: 'isHistoryOpen' } as const, false)
const isQaOpen = atom({ plugin: 'summarize', key: 'isQaOpen' } as const, true)

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
    onToggleQa: () => void update($, isQaOpen, isOpen => !isOpen).then(() => loadAnswers($)),
    onOpenFile: path => void openFile($, path),
    onOpenOverview: html => void servicesFor($).files.openOverview(html),
  }
}

function hostFor($: EngineInterface): RecapHost {
  return {
    run: (argv, options) => $.process.run([...argv], options),
    exists: path => $.fs.exists(path),
    read: async path => String(await $.fs.read(path)),
    write: (path, text) => $.fs.write(path, text),
    home: () => $.env.get('HOME'),
    osType: () => $.env.get('OSTYPE'),
    isInsideHerdr: async () => (await $.env.get('HERDR_ENV')) === '1',
    now: () => $.clock.now(),
    sessionId: () => $.session.id(),
    cwd: () => $.session.cwd(),
  }
}

function servicesFor($: EngineInterface): { repos: RecapRepos; files: RecapSessionFiles } {
  const host = hostFor($)
  const errors = new RecapErrorLog(host)
  const repos = new RecapRepos(host, errors, branchPullRequests, SESSION_DIRECTORY)

  return { repos, files: new RecapSessionFiles(host, repos, errors) }
}

const HERDR_MODS_PLUGIN_ID = 'barnuri.mods'
const HERDR_MODS_VIEW = '../../opencode-summarize/view.ts'
const HERDR_STATE_DIRECTORY = '.cache/herdr-mods/summarize'
const HERDR_TIMEOUT_MS = 10000
const UNSAFE_STATE_KEY = /[^A-Za-z0-9._-]/g
let herdrModsRoot: string | null | undefined

/** The herdr-mods plugin's folder (https://github.com/barnuri/herdr-mods), or null when it is not installed. */
async function herdrModsPluginRoot($: EngineInterface): Promise<string | null> {
  if (herdrModsRoot !== undefined) {
    return herdrModsRoot
  }
  const { exitCode, stdout } = await $.process.run(['herdr', 'plugin', 'list', '--json'], { timeoutMs: HERDR_TIMEOUT_MS })
  const plugins = exitCode === 0 ? ((JSON.parse(stdout || '{}') as { result?: { plugins?: { plugin_id?: string; plugin_root?: string }[] } }).result?.plugins ?? []) : []
  herdrModsRoot = plugins.find(plugin => plugin.plugin_id === HERDR_MODS_PLUGIN_ID)?.plugin_root ?? null
  return herdrModsRoot
}

/** This Claude pane's herdr pane id, or null outside herdr or without the herdr-mods plugin. */
async function herdrBesidePane($: EngineInterface): Promise<string | null> {
  if ((await $.env.get('HERDR_ENV')) !== '1') {
    return null
  }
  const paneId = await $.env.get('HERDR_PANE_ID')
  if (!paneId || (await herdrModsPluginRoot($)) === null) {
    return null
  }
  return paneId
}

/**
 * Writes the recap the herdr-mods pane draws (the opencode summarize view) and opens that pane beside
 * this Claude pane. Returns whether a pane is open.
 */
async function showHerdrPane($: EngineInterface, besidePaneId: string, state: unknown, isForced: boolean): Promise<boolean> {
  const root = await herdrModsPluginRoot($)
  const home = await $.env.get('HOME')
  if (root === null || home === undefined) {
    return false
  }
  const key = (await $.session.id()).replace(UNSAFE_STATE_KEY, '-')
  await $.fs.write(`${home}/${HERDR_STATE_DIRECTORY}/${key}.json`, JSON.stringify(state))
  const { exitCode, stdout } = await $.process.run(
    [
      'sh', `${root}/bin/bun.sh`, `${root}/bin/open.ts`,
      '--mod-id', PANE,
      '--view', `${$.plugin.root}/${HERDR_MODS_VIEW}`,
      '--key', key,
      '--beside', besidePaneId,
      ...(isForced ? ['--force'] : []),
    ],
    { timeoutMs: HERDR_TIMEOUT_MS },
  )
  return exitCode === 0 && (JSON.parse(stdout || '{}') as { open?: boolean }).open === true
}

/**
 * Inside herdr with the herdr-mods plugin (and `useClaudePane` off), shows the recap in a herdr pane
 * and returns true; otherwise returns false so the caller uses the Claude pane.
 */
async function showInHerdr($: EngineInterface, isForced: boolean, useClaudePane: boolean, showFilePaths: boolean): Promise<boolean> {
  if (useClaudePane) {
    return false
  }
  try {
    const besidePaneId = await herdrBesidePane($)
    if (besidePaneId === null) {
      return false
    }
    const state = {
      cwd: await $.session.cwd(),
      showFilePaths,
      entries: await read($, iterations),
      answers: await read($, answers),
      sessionHead: await read($, sessionHead),
      overview: await read($, overview),
    }
    await showHerdrPane($, besidePaneId, state, isForced)
    return true
  } catch (error) {
    void new RecapErrorLog(hostFor($)).log(`herdr pane failed: ${RecapErrorLog.describe(error)}`)
    return false
  }
}

let isSessionHeadLoading = false

/** The session repo's HEAD commit, looked up once per load, so `last` shows before any turn ends. */
async function loadSessionHead($: EngineInterface): Promise<void> {
  if (isSessionHeadLoading) {
    return
  }
  isSessionHeadLoading = true
  const { repos } = servicesFor($)
  const root = await repos.root(SESSION_DIRECTORY)
  const head = root === null ? null : await repos.headCommit(root)
  await update($, sessionHead, () => head)
}

async function openFile($: EngineInterface, path: string): Promise<void> {
  await servicesFor($).files.openFile(path)
}

async function loadOverview($: EngineInterface): Promise<void> {
  const found = await servicesFor($).files.overview(await read($, iterations))
  await update($, overview, () => found)
}

async function loadAnswers($: EngineInterface): Promise<void> {
  const loaded = await servicesFor($).files.answers(await read($, iterations))
  if (loaded === null) {
    return
  }
  await update($, answers, () => loaded)
}

export const register: Register = (on, options) => {
  const recorder = new IterationRecorder()
  let turnStartRepo: { root: string | null; state: string | null } = { root: null, state: null }
  const isBandEnabled = options.showBand === true
  const showFilePaths = options.showFilePaths === true
  const useClaudePane = options.useClaudePane === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Summarize the last iteration and keep summarizing new ones; browse earlier ones (prev, next, last, <n>, band); write the session overview (overview)',
      argumentHint: '[prev|next|last|<n>|band|overview]',
    })
    if (useClaudePane || (await herdrBesidePane($).catch(() => null)) === null) {
      await autoOpenPane($)
    }
    await loadOverview($)
    void loadSessionHead($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    recorder.start(e.turnId, e.text, await $.clock.now())
    turnStartRepo = await servicesFor($).repos.snapshot()

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
    const { repos, files } = servicesFor($)
    const entry = await repos.resolve(recorded, scope)
    await update($, iterations, current => [...current, entry].slice(-MAX_ITERATIONS))
    const saved = await read($, iterations)
    await loadSessionHead($)
    const refreshed = await files.refreshOverview(saved, await read($, sessionHead))
    await update($, overview, () => refreshed)
    await loadAnswers($)
    if (!(await showInHerdr($, false, useClaudePane, showFilePaths))) {
      await autoOpenPane($)
    }

    return done
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    await update($, isActive, () => true)
    await loadAnswers($)
    await loadOverview($)
    if (word === 'band') {
      const isHidden = await read($, isBandHidden)
      await update($, isBandHidden, () => !isHidden)

      return { text: isHidden ? 'Recap band shown.' : 'Recap band hidden.' }
    }
    if (word === 'overview') {
      return { text: await servicesFor($).files.renderOverview(await read($, iterations), await read($, sessionHead)) }
    }
    const list = await read($, iterations)
    const current = await read($, cursor)
    const target = word === '' ? current : RecapCursor.parse(word, list, current)
    await update($, cursor, () => target)
    await update($, isPaneDismissed, () => false)
    if (!(await showInHerdr($, true, useClaudePane, showFilePaths))) {
      await openPane($)
    }

    return { text: RecapView.commandText(RecapCursor.selected(list, target), list, await $.session.cwd(), await read($, answers), showFilePaths, await read($, sessionHead), false, await read($, overview)) }
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
      isQaOpen: await read($, isQaOpen),
      showFilePaths,
      bodyRows: e.props.scroll.bodyRows,
    }

    return RecapView.pane($.ui.resolve(e), list, selected, await $.session.cwd(), layout, handlersFor($), await read($, answers), await read($, sessionHead), await read($, overview))
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
