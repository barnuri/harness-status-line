import { TextFormat } from './textFormat'

import type {
  IterationRecapArtifacts,
  IterationRecapLink,
  IterationRecapQuestion,
  IterationRecapToolCall,
} from '../types'

export class ArtifactExtractor {
  private static readonly BASH_TOOL = 'Bash'
  private static readonly SKILL_TOOL = 'Skill'
  private static readonly AGENT_TOOL = 'Agent'
  private static readonly FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
  private static readonly PULL_REQUEST_URL = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g
  private static readonly GITHUB_REPO_URL = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=[/\s"'`)#?]|$)/g
  private static readonly NON_REPO_OWNERS = new Set(['repos', 'orgs', 'users', 'settings', 'apps', 'marketplace', 'login', 'features'])
  private static readonly GH_REPO_FLAG = /\bgh\b[^\n]*?(?:--repo|-R)[ =]([\w.-]+\/[\w.-]+)/g
  private static readonly GH_PR_COMMAND = /\bgh pr (create|merge|review|view|checkout|comment|edit|close|ready)\b(?:\s+(\d+))?/g
  private static readonly GH_PR_REVIEW = /\bgh pr review\b[^\n;&|]*/g
  private static readonly GIT_COMMIT = /\bgit commit\b/
  private static readonly GIT_COMMIT_OUTPUT = /^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/m
  private static readonly GIT_COMMIT_MESSAGE = /\bgit commit\b[^\n]*?-m\s+(?:"([^"]+)"|'([^']+)')/
  private static readonly CD_TARGET = /(?:^|[;&|]\s*)cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g
  private static readonly GIT_DASH_C = /\bgit\s+-C\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g
  private static readonly REVIEW_SKILL = /(?:^|:)(cr|code-review|review|security-review|simplify)$/
  private static readonly PLAN_SKILL = /(?:^|:)(code-gen|arch-design|plan|planner)$/
  private static readonly REVIEW_AGENT = /(review|bug-hunter|guideline-checker)/i
  private static readonly PLAN_AGENT = /(^plan$|planner)/i
  private static readonly PLAN_FILE = /(?:^|[-_./])(plan|tasks)\.md$/i
  private static readonly MARKDOWN_HEADING = /^#+\s*/
  private static readonly BOLD = /\*\*/g
  private static readonly QUOTES = /^["']|["']$/g
  private static readonly LIST_MARKER = /^(?:[-*+>]|\d+[.)]|[A-Z]\d+[.:)]?)\s+/
  private static readonly SHORT_HASH_LENGTH = 7
  private static readonly MIN_QUESTION_LENGTH = 12
  private static readonly MAX_ANSWER_QUESTIONS = 5
  private static readonly MAX_LABEL_LENGTH = 80

  public static extract(calls: readonly IterationRecapToolCall[], answer: string): IterationRecapArtifacts {
    return {
      files: ArtifactExtractor.files(calls),
      repos: ArtifactExtractor.remoteRepos(calls, answer),
      pullRequests: ArtifactExtractor.pullRequests(calls, answer),
      reviews: ArtifactExtractor.reviews(calls),
      plans: ArtifactExtractor.plans(calls),
      commits: ArtifactExtractor.commits(calls),
      questions: [...ArtifactExtractor.askedQuestions(calls), ...ArtifactExtractor.answerQuestions(answer)],
    }
  }

  public static candidateDirectories(calls: readonly IterationRecapToolCall[]): string[] {
    const fileDirectories = ArtifactExtractor.files(calls)
      .filter(file => file.lastIndexOf('/') > 0)
      .map(file => file.slice(0, file.lastIndexOf('/')))
    const commandDirectories = ArtifactExtractor.bashCommands(calls).flatMap(command => [
      ...ArtifactExtractor.matchAll(command, ArtifactExtractor.CD_TARGET, 1),
      ...ArtifactExtractor.matchAll(command, ArtifactExtractor.GIT_DASH_C, 1),
    ].map(directory => directory.replace(ArtifactExtractor.QUOTES, '')))

    return ArtifactExtractor.unique([...fileDirectories, ...commandDirectories].filter(directory => directory !== '' && directory !== '-'))
  }

  private static files(calls: readonly IterationRecapToolCall[]): string[] {
    const paths = calls
      .filter(call => ArtifactExtractor.FILE_EDIT_TOOLS.has(call.tool) && !call.isError)
      .map(call => ArtifactExtractor.stringField(call.input, 'file_path') ?? ArtifactExtractor.stringField(call.input, 'notebook_path'))

    return ArtifactExtractor.unique(paths.filter((path): path is string => path !== undefined))
  }

  private static remoteRepos(calls: readonly IterationRecapToolCall[], answer: string): string[] {
    const repos = [...ArtifactExtractor.bashTexts(calls), answer].flatMap(text => [
      ...[...text.matchAll(ArtifactExtractor.GITHUB_REPO_URL)]
        .filter(([, owner = '']) => !ArtifactExtractor.NON_REPO_OWNERS.has(owner))
        .map(([, owner = '', name = '']) => `${owner}/${name}`),
      ...ArtifactExtractor.matchAll(text, ArtifactExtractor.GH_REPO_FLAG, 1),
    ])

    return ArtifactExtractor.unique(repos)
  }

  private static pullRequests(calls: readonly IterationRecapToolCall[], answer: string): IterationRecapLink[] {
    const linked = [...ArtifactExtractor.bashTexts(calls), answer]
      .flatMap(text => [...text.matchAll(ArtifactExtractor.PULL_REQUEST_URL)])
      .map(([url, owner = '', name = '', number = '']): IterationRecapLink => ({ label: `${owner}/${name}#${number}`, url }))
    const linkedNumbers = new Set(linked.map(link => link.label.slice(link.label.lastIndexOf('#') + 1)))
    const numbered = ArtifactExtractor.bashCommands(calls)
      .flatMap(command => [...command.matchAll(ArtifactExtractor.GH_PR_COMMAND)])
      .filter(([, , number]) => number !== undefined && !linkedNumbers.has(number))
      .map(([, action = '', number = '']): IterationRecapLink => ({ label: `#${number} (gh pr ${action})` }))
    const byLabel = new Map([...linked, ...numbered].map(link => [link.label, link]))

    return [...byLabel.values()]
  }

  private static reviews(calls: readonly IterationRecapToolCall[]): string[] {
    const reviews = calls.flatMap(call => [
      ...ArtifactExtractor.skillAndAgentLabels(call, ArtifactExtractor.REVIEW_SKILL, ArtifactExtractor.REVIEW_AGENT),
      ...(call.tool === 'ReportFindings' ? [`${Array.isArray(call.input.findings) ? call.input.findings.length : 0} findings reported`] : []),
      ...ArtifactExtractor.matchAll(ArtifactExtractor.bashCommand(call) ?? '', ArtifactExtractor.GH_PR_REVIEW, 0).map(ArtifactExtractor.shorten),
    ])

    return ArtifactExtractor.unique(reviews)
  }

  private static plans(calls: readonly IterationRecapToolCall[]): string[] {
    const plans = calls.flatMap(call => [
      ...(call.tool === 'ExitPlanMode' ? [`plan: ${ArtifactExtractor.firstLine(ArtifactExtractor.stringField(call.input, 'plan') ?? '')}`] : []),
      ...ArtifactExtractor.skillAndAgentLabels(call, ArtifactExtractor.PLAN_SKILL, ArtifactExtractor.PLAN_AGENT),
      ...(call.tool === 'TaskCreate' ? [`task: ${ArtifactExtractor.shorten(ArtifactExtractor.stringField(call.input, 'subject') ?? '')}`] : []),
    ])
    const planFiles = ArtifactExtractor.files(calls).filter(path => ArtifactExtractor.PLAN_FILE.test(path))

    return ArtifactExtractor.unique([...plans, ...planFiles])
  }

  private static commits(calls: readonly IterationRecapToolCall[]): string[] {
    const commits = calls
      .filter(call => !call.isError && ArtifactExtractor.GIT_COMMIT.test(ArtifactExtractor.bashCommand(call) ?? ''))
      .map(call => ArtifactExtractor.commitLabel(call))

    return ArtifactExtractor.unique(commits.filter(commit => commit !== ''))
  }

  private static commitLabel(call: IterationRecapToolCall): string {
    const output = ArtifactExtractor.GIT_COMMIT_OUTPUT.exec(call.resultText)
    if (output !== null) {
      const [, , hash = '', subject = ''] = output

      return `${hash.slice(0, ArtifactExtractor.SHORT_HASH_LENGTH)} ${ArtifactExtractor.shorten(subject)}`
    }
    const message = ArtifactExtractor.GIT_COMMIT_MESSAGE.exec(ArtifactExtractor.bashCommand(call) ?? '')

    return message === null ? '' : ArtifactExtractor.shorten(message[1] ?? message[2] ?? '')
  }

  private static askedQuestions(calls: readonly IterationRecapToolCall[]): IterationRecapQuestion[] {
    return calls
      .filter(call => call.tool === 'AskUserQuestion')
      .flatMap(call => {
        const isAnswered = !call.isError && call.resultText.trim() !== ''
        const asked: unknown[] = Array.isArray(call.input.questions) ? call.input.questions : []

        return asked
          .map(item => ArtifactExtractor.stringField(item, 'question'))
          .filter((text): text is string => text !== undefined)
          .map(text => ({ text: ArtifactExtractor.shorten(text), isAnswered }))
      })
  }

  private static answerQuestions(answer: string): IterationRecapQuestion[] {
    const lines = answer
      .replace(TextFormat.FENCED_BLOCK, '')
      .split('\n')
      .map(line => ArtifactExtractor.stripMarkers(line))
      .filter(line => line.endsWith('?') && line.length >= ArtifactExtractor.MIN_QUESTION_LENGTH)

    return ArtifactExtractor.unique(lines)
      .slice(-ArtifactExtractor.MAX_ANSWER_QUESTIONS)
      .map(text => ({ text: ArtifactExtractor.shorten(text), isAnswered: false }))
  }

  private static skillAndAgentLabels(call: IterationRecapToolCall, skillPattern: RegExp, agentPattern: RegExp): string[] {
    const skill = call.tool === ArtifactExtractor.SKILL_TOOL ? ArtifactExtractor.stringField(call.input, 'skill') : undefined
    const agentType = call.tool === ArtifactExtractor.AGENT_TOOL ? ArtifactExtractor.stringField(call.input, 'subagent_type') : undefined

    return [
      ...(skill !== undefined && skillPattern.test(skill) ? [`/${skill}`] : []),
      ...(agentType !== undefined && agentPattern.test(agentType) ? [`agent ${agentType}`] : []),
    ]
  }

  private static stripMarkers(line: string): string {
    const plain = line.replace(ArtifactExtractor.BOLD, '').trim()

    return plain.replace(ArtifactExtractor.LIST_MARKER, '').replace(ArtifactExtractor.LIST_MARKER, '').trim()
  }

  private static bashCommand(call: IterationRecapToolCall): string | undefined {
    return call.tool === ArtifactExtractor.BASH_TOOL ? ArtifactExtractor.stringField(call.input, 'command') : undefined
  }

  private static bashCommands(calls: readonly IterationRecapToolCall[]): string[] {
    return calls.map(call => ArtifactExtractor.bashCommand(call)).filter((command): command is string => command !== undefined)
  }

  private static bashTexts(calls: readonly IterationRecapToolCall[]): string[] {
    return calls
      .filter(call => call.tool === ArtifactExtractor.BASH_TOOL)
      .flatMap(call => [ArtifactExtractor.bashCommand(call) ?? '', call.resultText])
  }

  private static stringField(source: unknown, key: string): string | undefined {
    if (typeof source !== 'object' || source === null) {
      return undefined
    }
    const value: unknown = (source as Record<string, unknown>)[key]

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  private static matchAll(text: string, pattern: RegExp, group: number): string[] {
    return [...text.matchAll(pattern)].map(match => match[group] ?? '').filter(value => value !== '')
  }

  private static firstLine(text: string): string {
    const line = text.split('\n').map(one => one.replace(ArtifactExtractor.MARKDOWN_HEADING, '').trim()).find(one => one !== '') ?? ''

    return ArtifactExtractor.shorten(line)
  }

  private static shorten(text: string): string {
    return TextFormat.truncate(text, ArtifactExtractor.MAX_LABEL_LENGTH)
  }

  private static unique<T>(values: readonly T[]): T[] {
    return [...new Set(values)]
  }
}
