import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  component: 'Pane',
  requestId: 'iteration-recap',
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

function engineStubs(on: On, onOpen: (id: string) => void = () => undefined): void {
  on('turn.start', async ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', async ($, e) => ({ text: e.answer }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('session.cwd', async () => ({ value: '/work/web' }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '/work/web\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.complete', async () => ({
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
  await $.turn.complete({ answer, durationMs: 72_000, isAborted: false, turnId, reason: 'answer' })
}

test('records an iteration with its artifacts and an AI summary', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)

  await runIteration($, 't1', 'fix the login redirect and open a PR', 'Fixed it and opened the PR.\n\nWant me to merge it?')
  await clock.advance(10)
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'iteration-recap', surface, ...PANE })
    expect((await ui.find({ type: 'Text', text: /Iteration 1\/1/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Opened PR acme\/web#42/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'src/login.ts' }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /web, acme\/web/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'Want me to merge it?' }))).toBeDefined()
    await ui.unmount()
  }
})

test('browses between iterations with prev, next and latest', { options: { summarizer: 'heuristic' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)

  await runIteration($, 't1', 'first task', 'First done.')
  await runIteration($, 't2', 'second task', 'Second done.')
  await clock.advance(10)
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'iteration-recap', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Iteration 2\/2/ })).toBeDefined()

  await ui.press({ key: 'previous' })
  expect(await ui.find({ type: 'Text', text: /Iteration 1\/2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'First done.' })).toBeDefined()

  await ui.press({ key: 'latest' })
  expect(await ui.find({ type: 'Text', text: /Iteration 2\/2/ })).toBeDefined()

  await ui.press({ key: 'jump-1' })
  expect(await ui.find({ type: 'Text', text: /Iteration 1\/2/ })).toBeDefined()
  await ui.unmount()
})

test('/iterations jumps by number and answers with a text recap', { options: { summarizer: 'heuristic' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)

  await runIteration($, 't1', 'first task', 'First done.')
  await runIteration($, 't2', 'second task', 'Second done.')
  await clock.advance(10)

  const answer = await $.command.run({ command: 'iterations', args: '1', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(answer.text).toContain('Iteration 1/2')
  expect(answer.text).toContain('First done.')
  expect(answer.text).toContain('https://github.com/acme/web/pull/42')
})

test('band shows the latest recap and hides on press', { options: { summarizer: 'heuristic' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  engineStubs(on)

  await runIteration($, 't1', 'task', 'All done. Should I deploy to staging?')
  await clock.advance(10)

  const ui = await $.ui.mount({ plugin: 'iteration-recap', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /1 open \?/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 PR/ })).toBeDefined()

  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /1 open \?/ })).toBeUndefined()
  await ui.unmount()
})

test('auto-opens the pane after each finished iteration', { options: { summarizer: 'heuristic' } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  const opened: string[] = []
  engineStubs(on, id => opened.push(id))

  await runIteration($, 't1', 'first task', 'First done.')
  await runIteration($, 't2', 'second task', 'Second done.')

  expect(opened).toEqual(['iteration-recap', 'iteration-recap'])
})

test('does not auto-open when autoOpen is off', { options: { summarizer: 'heuristic', autoOpen: false } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  const opened: string[] = []
  engineStubs(on, id => opened.push(id))

  await runIteration($, 't1', 'first task', 'First done.')

  expect(opened).toEqual([])
})
