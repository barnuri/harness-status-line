export class ClaudeCredentialReader {
  private static readonly KEYCHAIN_SERVICE = 'Claude Code-credentials';
  private static readonly READ_TIMEOUT_MS = 5_000;

  async read(): Promise<string | null> {
    try {
      const process = Bun.spawn(
        ['security', 'find-generic-password', '-s', ClaudeCredentialReader.KEYCHAIN_SERVICE, '-w'],
        { stdout: 'pipe', stderr: 'ignore' },
      );
      const rawPromise = new Response(process.stdout).text();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<number>((resolve) => {
        timer = setTimeout((): void => {
          process.kill();
          resolve(-1);
        }, ClaudeCredentialReader.READ_TIMEOUT_MS);
      });
      const exitCode = await Promise.race([process.exited, timeout]);
      clearTimeout(timer);
      if (exitCode !== 0) {
        return null;
      }
      return this.extractToken(await rawPromise);
    } catch (err: unknown) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }

  private extractToken(raw: string): string | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      const oauth = (parsed as { claudeAiOauth?: unknown }).claudeAiOauth;
      if (typeof oauth !== 'object' || oauth === null || Array.isArray(oauth)) {
        return null;
      }
      const accessToken = (oauth as { accessToken?: unknown }).accessToken;
      return typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : null;
    } catch (err: unknown) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }
}
