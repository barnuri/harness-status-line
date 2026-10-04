import type { IterationRecapLink } from '../types'

export class RepoLink {
  private static readonly SCP_REMOTE = /^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/
  private static readonly SSH_REMOTE = /^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/
  private static readonly HTTP_REMOTE = /^https?:\/\/(?:[^@/]+@)?([\w.-]+(?::\d+)?)\/(.+?)(?:\.git)?\/?$/
  private static readonly GITHUB = 'https://github.com'

  public static fromRoot(root: string, remote: string): IterationRecapLink {
    const label = root.split('/').at(-1) ?? root
    const url = RepoLink.webUrl(remote.trim())

    return { label, url: url ?? `file://${root}` }
  }

  public static fromSlug(slug: string): IterationRecapLink {
    return { label: slug, url: `${RepoLink.GITHUB}/${slug}` }
  }

  public static unique(links: readonly (IterationRecapLink | string)[]): IterationRecapLink[] {
    const byLabel = new Map<string, IterationRecapLink>()
    for (const item of links) {
      const link = typeof item === 'string' ? { label: item } : item
      const known = byLabel.get(link.label)
      const isBetter = known === undefined || (known.url?.startsWith('http') !== true && link.url?.startsWith('http') === true)
      if (isBetter) {
        byLabel.set(link.label, link)
      }
    }

    return [...byLabel.values()]
  }

  private static webUrl(remote: string): string | undefined {
    const match = RepoLink.SCP_REMOTE.exec(remote) ?? RepoLink.SSH_REMOTE.exec(remote) ?? RepoLink.HTTP_REMOTE.exec(remote)
    if (match === null) {
      return undefined
    }
    const [, host = '', path = ''] = match

    return `https://${host}/${path}`
  }
}
