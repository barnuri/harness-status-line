import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { GitFacts } from '../hooks/gitFacts'
import { SessionTotals } from '../hooks/sessionTotals'

const PANE = {
  component: 'Pane',
  requestId: 'summarize',
  props: {
    title: 'Iteration recap',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const ASK = (question: string) => ({ question, header: 'h', options: [{ label: 'a', description: 'd' }, { label: 'b', description: 'd' }], multiSelect: false })

const SUMMARIZE = { command: 'summarize', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

function engineStubs(
  on: On,
  onOpen: (id: string) => void = () => undefined,
  gitState: () => string = () => 'clean',
  onModel: () => void = () => undefined,
  ghPrView: string | null = null,
  askResult = 'ok',
  opened: string[][] = [],
  home: string | undefined = undefined,
  exists: (path: string) => boolean = path => path.includes('/agent-spec/'),
  written: { path: string; text: string }[] = [],
  rendered: string[][] = [],
): void {
  on('env.get', async ($, e) => ({ value: e.name === 'HOME' ? home : undefined }))
  on('fs.exists', async ($, e) => ({ value: exists(e.path) }))
  on('fs.write', async ($, e) => {
    written.push({ path: e.path, text: e.text })

    return { value: undefined }
  })
  on('turn.start', async ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', async ($, e) => ({ text: e.answer }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('session.cwd', async () => ({ value: '/work/web' }))
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'open') {
      opened.push([...e.argv])
    }
    if (e.argv[0] === 'python3') {
      rendered.push([...e.argv])

      return { value: { exitCode: 0, stdout: `${e.argv[3]}/session-overview.html\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] === 'gh') {
      return { value: { exitCode: ghPrView === null ? 1 : 0, stdout: ghPrView ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const branch = e.argv.includes('--abbrev-ref') ? 'feature/x\n' : undefined
    const stdout = e.argv.includes('--show-toplevel') ? '/work/web\n' : branch ?? gitState()

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('model.complete', async () => (onModel(), {
    value: {
      isAnswered: true,
      text: 'Opened PR acme/web#42 after fixing the login redirect.',
      usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  on('ui.log', async () => ({ value: undefined }))
  on('ui.open', async ($, e) => {
    onOpen(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  on('tool.call', async ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      return { result: {}, text: askResult }
    }
    if (e.tool === 'Bash') {
      return { result: { stdout: '', stderr: '', interrupted: false }, text: 'https://github.com/acme/web/pull/42' }
    }

    return { result: {}, text: 'ok' }
  })
}

async function runIteration($: Engine, turnId: string, prompt: string, answer: string): Promise<void> {
  await $.turn.start({ text: prompt, turnId })
  await $.tool.call({ tool: 'Edit', file_path: '/work/web/src/login.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  await $.tool.call({ tool: 'Skill', skill: 'cr' })
  await $.turn.complete({ answer, durationMs: 72_000, isAborted: false, turnId, reason: 'answer' })
}

test('records an iteration with its artifacts and a deterministic summary', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)

  await runIteration($, 't1', 'fix the login redirect and open a PR', 'Fixed it and opened the PR.\n\nWant me to merge it?')
  await clock.advance(10)
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'summarize', surface, ...PANE })
    expect((await ui.find({ type: 'Text', text: /Iteration 1\/1/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'Fixed it and opened the PR.' }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '1 file' }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'Want me to merge it?' }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'This session' }))).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+ #42' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'web' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '/cr' }))).toBeDefined()
    await ui.unmount()
  }
})

test('browses between iterations with prev, next and latest', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)

  await runIteration($, 't1', 'first task', 'First done.')
  await runIteration($, 't2', 'second task', 'Second done.')
  await clock.advance(10)
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Iteration 2\/2/ })).toBeDefined()

  await ui.press({ key: 'previous' })
  expect(await ui.find({ type: 'Text', text: /Iteration 1\/2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'First done.' })).toBeDefined()

  await ui.press({ key: 'latest' })
  expect(await ui.find({ type: 'Text', text: /Iteration 2\/2/ })).toBeDefined()

  expect(await ui.find({ key: 'jump-1' })).toBeUndefined()
  await ui.press({ key: 'toggle-history' })
  await ui.press({ key: 'jump-1' })
  expect(await ui.find({ type: 'Text', text: /Iteration 1\/2/ })).toBeDefined()
  await ui.unmount()
})

test('/summarize jumps by number and answers with a text recap', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)

  await runIteration($, 't1', 'first task', 'First done.')
  await runIteration($, 't2', 'second task', 'Second done.')
  await clock.advance(10)

  const answer = await $.command.run({ command: 'summarize', args: '1', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(answer.text).toContain('Iteration 1/2')
  expect(answer.text).toContain('First done.')
  expect(answer.text).toContain('https://github.com/acme/web/pull/42')
})

test('band shows the latest recap and hides on press', { options: { showBand: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)

  await runIteration($, 't1', 'task', 'All done. Should I deploy to staging?')
  await clock.advance(10)
  await $.command.run(SUMMARIZE)

  const ui = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /1 open \?/ })).toBeDefined()

  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /1 open \?/ })).toBeUndefined()
  await ui.unmount()
})

test('is active by default and opens after every new iteration', { options: { showBand: true } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  const opened: string[] = []
  engineStubs(on, id => opened.push(id))

  await runIteration($, 't1', 'first task', 'First done.')
  expect(opened).toEqual(['summarize'])
  const band = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /First done/ })).toBeDefined()
  await band.unmount()

  await runIteration($, 't2', 'second task', 'Second done.')
  expect(opened).toEqual(['summarize', 'summarize'])
})

test('shows the overview.md this session wrote, with no model call', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  let modelCalls = 0
  const file = '/work/web/agent-spec/2026-11-08-login/overview.md'
  engineStubs(on, () => undefined, () => 'clean', () => { modelCalls += 1 })
  on('fs.read', async ($, e) => ({
    value: e.path === file
      ? '> Session: login fix\n\n## Questions and Answers\n\n### Q1 — Which redirect target?\n\n**Answer:** The dashboard.\n\n---\n\n### Q2 — Keep the old route?\n\n**Answer:** No.\n\n## Verify during implementation\n\n- tests\n'
      : '',
  }))

  await $.turn.start({ text: 'record answers', turnId: 't1' })
  await $.tool.call({ tool: 'Write', file_path: file, content: 'x' })
  await $.turn.complete({ answer: 'Recorded.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10)
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: 'Which redirect target?' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'The dashboard.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'No.' })).toBeDefined()
  await ui.unmount()

  const answer = await $.command.run(SUMMARIZE)
  expect(answer.text).toContain('Answers (login fix)')
  expect(answer.text).toContain('Q2 No.\n    ↳ Keep the old route?')
  expect(answer.text).not.toContain('tests')
  expect(modelCalls).toBe(0)
})

test('collapses the prompt by default and always shows skills, tools and the session repos and PRs', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)

  await $.turn.start({ text: 'just read things', turnId: 't1' })
  await $.turn.complete({ answer: 'Read it.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10)

  const ui = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...PANE })
  for (const label of ['skills', 'tools', 'repos', 'PRs']) {
    expect(await ui.find({ type: 'Text', text: new RegExp(`^${label}\\s`) })).toBeDefined()
  }
  expect((await ui.findAll({ type: 'Text', text: 'none' })).length).toBeGreaterThanOrEqual(4)
  expect(await ui.find({ type: 'Text', text: 'just read things' })).toBeUndefined()

  await ui.press({ key: 'toggle-prompt' })
  expect(await ui.find({ type: 'Text', text: 'just read things' })).toBeDefined()
  await ui.unmount()
})

test('counts the session repo as changed when its git state moved during the turn', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  let state = 'before'
  engineStubs(on, () => undefined, () => state)

  await $.turn.start({ text: 'edit through a script', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'python3 rewrite.py' })
  state = 'after'
  await $.turn.complete({ answer: 'Rewrote it.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10)
  await clock.settle()

  const answer = await $.command.run(SUMMARIZE)
  expect(answer.text).toMatch(/This session\nrepos\s+file:\/\/\/work\/web/)
})

test('records skills from skill.prompt, typed before the turn or loaded during it', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)
  on('skill.prompt', async ($, e) => ({ text: e.text }))

  await $.skill.prompt({ skill: 'barnuri-dev-skills:code-gen', text: 'plan' })
  await $.turn.start({ text: 'build it', turnId: 't1' })
  await $.skill.prompt({ skill: 'dev-guidelines', text: 'rules' })
  await $.turn.complete({ answer: 'Built.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10)

  const answer = await $.command.run(SUMMARIZE)
  expect(answer.text).toMatch(/skills\s+\/barnuri-dev-skills:code-gen, \/dev-guidelines/)
})

test('makes no model call by default and summarizes from the answer', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  let modelCalls = 0
  engineStubs(on, () => undefined, () => 'clean', () => { modelCalls += 1 })

  await runIteration($, 't1', 'fix it', 'Fixed the redirect. Tests pass.')
  await clock.advance(10)
  await clock.settle()

  const answer = await $.command.run(SUMMARIZE)
  expect(answer.text).toContain('Fixed the redirect.')
  expect(modelCalls).toBe(0)
})

test('detects the open PR of the session repo branch with gh, like the footer', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on, () => undefined, () => 'clean', () => undefined, '{"number":418,"url":"https://github.com/chkp-genai/keystone/pull/418"}')

  await $.turn.start({ text: 'look around', turnId: 't1' })
  await $.turn.complete({ answer: 'Looked.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10)

  const answer = await $.command.run(SUMMARIZE)
  expect(answer.text).toMatch(/PRs\s+https:\/\/github\.com\/chkp-genai\/keystone\/pull\/418/)
})

test('keeps AskUserQuestion replies out of the Answers section', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on, () => undefined, () => 'clean', () => undefined, null,
    'User has answered your questions: "Which DB?"="Postgres, with a CHECK", "Ship today?"="No". You can now continue.')

  await $.turn.start({ text: 'decide', turnId: 't1' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [ASK('Which DB?'), ASK('Ship today?')] })
  await $.turn.complete({ answer: 'Decided.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10)

  const answer = await $.command.run(SUMMARIZE)
  expect(answer.text).not.toContain('Answers (')
  expect(answer.text).not.toContain('A1 Postgres, with a CHECK')
  const ui = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: '◆ Answers' })).toBeUndefined()
  await ui.unmount()
})

test('finds an overview.md written through Bash and opens session-overview.html', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const opened: string[][] = []
  const file = '/work/web/agent-spec/2026-11-08-db/overview.md'
  engineStubs(on, () => undefined, () => 'clean', () => undefined, null, 'ok', opened)
  on('fs.read', async ($, e) => ({ value: e.path === file ? '### Q1 — Which DB?\n\n**Answer:** Postgres.\n' : '' }))

  await $.turn.start({ text: 'record', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: "python3 write_overview.py '/work/web/agent-spec/2026-11-08-db/overview.md'" })
  await $.turn.complete({ answer: 'Recorded.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10)

  const ui = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: 'Postgres.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'open overview' })).toBeDefined()
  await ui.press({ key: 'open-overview' })
  expect(opened).toContainEqual(['open', '/work/web/agent-spec/2026-11-08-db/session-overview.html'])
  await ui.unmount()
})

test('turn.complete writes overview-facts.json into the published slug folder', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const written: { path: string; text: string }[] = []
  const present = ['/home/me/.claude/session-slugs/sess-1', '/work/web/agent-spec/2026-11-08-x']
  engineStubs(on, () => undefined, () => 'clean', () => undefined, null, 'ok', [], '/home/me', path => present.includes(path), written)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.read', async () => ({ value: '2026-11-08-x\n' }))

  await runIteration($, 't1', 'fix the login redirect', 'Fixed it.')
  await clock.advance(10)

  const facts = written.find(file => file.path === '/work/web/agent-spec/2026-11-08-x/overview-facts.json')
  expect(facts).toBeDefined()
  const document = JSON.parse(facts?.text ?? '{}')
  expect(document.schemaVersion).toBe(1)
  expect(document.slug).toBe('2026-11-08-x')
  expect(document.turns).toBe(1)
  expect(document.files).toEqual(['/work/web/src/login.ts'])
})

test('/summarize overview writes the facts, runs the renderer with python3 -I, and opens the html', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const written: { path: string; text: string }[] = []
  const rendered: string[][] = []
  const opened: string[][] = []
  const folder = '/work/web/agent-spec/2026-11-08-x'
  const script = '/home/me/.agents/skills/session-overview/scripts/render_overview.py'
  const present = ['/home/me/.claude/session-slugs/sess-1', folder, script]
  engineStubs(on, () => undefined, () => 'clean', () => undefined, null, 'ok', opened, '/home/me', path => present.includes(path), written, rendered)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.read', async () => ({ value: '2026-11-08-x\n' }))

  await runIteration($, 't1', 'fix the login redirect', 'Fixed it.')
  await clock.advance(10)
  written.length = 0

  const answer = await $.command.run({ ...SUMMARIZE, args: 'overview' })
  expect(answer.text).toBe(`Overview: ${folder}/session-overview.html`)
  expect(written.map(file => file.path)).toEqual([`${folder}/overview-facts.json`])
  expect(rendered).toEqual([['python3', '-I', script, folder]])
  expect(opened).toContainEqual(['open', `${folder}/session-overview.html`])
})


test('Q&A starts open with every answer; q collapses to the latest 3', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const file = '/work/web/agent-spec/2026-11-08-many/overview.md'
  engineStubs(on)
  const cards = [1, 2, 3, 4, 5].map(n => `### Q${n} — Question ${n}?\n\n**Answer:** Answer ${n}.\n\n---\n`).join('\n')
  on('fs.read', async ($, e) => ({ value: e.path === file ? cards : '' }))

  await $.turn.start({ text: 'record', turnId: 't1' })
  await $.tool.call({ tool: 'Write', file_path: file, content: 'x' })
  await $.turn.complete({ answer: 'Recorded.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10)

  const ui = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: 'Answer 1.' })).toBeDefined()
  await ui.press({ key: 'toggle-qa' })
  expect(await ui.find({ type: 'Text', text: 'Answer 1.' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Answer 5.' })).toBeDefined()
  await ui.unmount()
})

test('shows file paths only with the showFilePaths option', { options: { showFilePaths: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)
  await runIteration($, 't1', 'fix it', 'Fixed.')
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: 'src/login.ts' })).toBeDefined()
  await ui.unmount()
})

test('finds the overview.md of the slug session-slug published for this session', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const present = ['/home/me/.claude/session-slugs/sess-1', '/work/web/agent-spec/2026-11-08-x', '/work/web/agent-spec/2026-11-08-x/overview.md']
  engineStubs(on, () => undefined, () => 'clean', () => undefined, null, 'ok', [], '/home/me', path => present.includes(path))
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.read', async ($, e) => ({
    value: e.path === '/home/me/.claude/session-slugs/sess-1' ? '2026-11-08-x\n' : '### Q1 — Which port?\n\n**Answer:** 8888.\n',
  }))

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'Hi.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10)

  const answer = await $.command.run(SUMMARIZE)
  expect(answer.text).toContain('Q1 8888.')
})

test('the band is off by default', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)
  await runIteration($, 't1', 'task', 'All done.')
  await clock.advance(10)
  const band = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /All done/ })).toBeUndefined()
  await band.unmount()
})

test('default-branch commits become sha6 + trimmed message links to the commit page', async () => {
  const sha = 'abcdef1234567890abcdef1234567890abcdef12'
  const links = GitFacts.commitLinks(`${sha}\tA very long commit subject that keeps going past forty characters\n`, 'https://github.com/acme/web')
  expect(links).toHaveLength(1)
  expect(links[0]?.label.startsWith('abcdef A very long commit subject')).toBe(true)
  expect(links[0]?.label.length).toBeLessThanOrEqual(6 + 1 + 40)
  expect(links[0]?.url).toBe(`https://github.com/acme/web/commit/${sha}`)
  expect(GitFacts.commitLinks(`${sha}\tlocal`, 'file:///work/web')[0]?.url).toBeUndefined()
})

test('last shows the current HEAD commit of the session repo', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const head = 'abcdef1234567890abcdef1234567890abcdef12\tFix the login redirect'
  engineStubs(on, () => undefined, () => head)
  await $.turn.start({ text: 'look', turnId: 't1' })
  await $.turn.complete({ answer: 'Looked.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: 'summarize', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: 'abcdef Fix the login redirect' })).toBeDefined()
  await ui.unmount()
})

test('last keeps one newest commit per repo, session repo first', async () => {
  const head = (repo: string, label: string) => ({ repo, label, url: `https://github.com/acme/${repo}/commit/x` })
  const entry = (heads: ReturnType<typeof head>[]) => ({ artifacts: { headCommits: heads } }) as never
  const last = SessionTotals.lastCommits([entry([head('web', 'aaa111 one'), head('api', 'bbb222 two')]), entry([head('web', 'ccc333 three')])], head('web', 'zzz000 start'))
  expect(last.map(commit => `${commit.repo} ${commit.label}`)).toEqual(['web ccc333 three', 'api bbb222 two'])
})
