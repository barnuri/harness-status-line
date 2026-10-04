import type { IterationRecapGitFacts, IterationRecapLink } from '../types'

export class GitFacts {
  private static readonly MAX_FILES = 200
  private static readonly PULL_REQUEST_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/

  public static branchPullRequest(ghJson: string): IterationRecapLink | null {
    try {
      const parsed = GitFacts.object(JSON.parse(ghJson))
      const url = GitFacts.string(parsed?.url)
      const match = url === undefined ? null : GitFacts.PULL_REQUEST_URL.exec(url)
      if (url === undefined || match === null) {
        return null
      }
      const [, slug = '', number = ''] = match

      return { label: `${slug}#${number}`, url, isBranch: true }
    } catch (error) {
      if (error instanceof SyntaxError) {
        return null
      }
      throw error
    }
  }

  public static fromBashResult(result: unknown): IterationRecapGitFacts | undefined {
    const record = GitFacts.object(result)
    if (record === undefined) {
      return undefined
    }
    const operation = GitFacts.object(record.gitOperation)
    const diff = GitFacts.object(record.bashEditDiff)
    const editedFiles = GitFacts.editedFiles(diff)
    const commitSha = GitFacts.string(GitFacts.object(operation?.commit)?.sha)
    const pullRequest = GitFacts.pullRequest(GitFacts.object(operation?.pr))
    if (editedFiles.length === 0 && commitSha === undefined && pullRequest === undefined) {
      return undefined
    }

    return {
      editedFiles,
      ...(commitSha === undefined ? {} : { commitSha }),
      ...(pullRequest === undefined ? {} : { pullRequest }),
    }
  }

  private static editedFiles(diff: Record<string, unknown> | undefined): string[] {
    if (diff === undefined) {
      return []
    }
    const changed = Array.isArray(diff.changedFiles) ? diff.changedFiles : []
    const listed = Array.isArray(diff.files) ? diff.files.map(file => GitFacts.object(file)?.filePath) : []
    const paths = [...changed, ...listed].filter((path): path is string => typeof path === 'string' && path !== '')

    return [...new Set(paths)].slice(0, GitFacts.MAX_FILES)
  }

  private static pullRequest(pr: Record<string, unknown> | undefined): IterationRecapGitFacts['pullRequest'] {
    const number = pr?.number
    const action = GitFacts.string(pr?.action)
    if (typeof number !== 'number' || action === undefined) {
      return undefined
    }
    const url = GitFacts.string(pr?.url)

    return { number, action, ...(url === undefined ? {} : { url }) }
  }

  private static object(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  }

  private static string(value: unknown): string | undefined {
    return typeof value === 'string' && value !== '' ? value : undefined
  }
}
