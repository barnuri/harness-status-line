import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RecapHost } from '../../../claude-mods/summarize/hooks/recapHost.ts';

/** RecapHost for opencode: Bun processes with a kill timeout, plain file system calls, and the selected session. */
export class OpencodeRecapHost implements RecapHost {
  constructor(
    private readonly sessionIdOf: () => string,
    private readonly directoryOf: () => string,
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  async run(
    argv: readonly string[],
    options: { readonly cwd?: string; readonly timeoutMs: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const child = Bun.spawn([...argv], {
      cwd: options.cwd ?? this.directoryOf(),
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
    const timer = setTimeout(() => child.kill(), options.timeoutMs);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(path);
  }

  async read(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async write(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }

  async home(): Promise<string | undefined> {
    return this.environment['HOME'];
  }

  async osType(): Promise<string | undefined> {
    return process.platform === 'darwin' ? 'darwin' : process.platform;
  }

  async isInsideHerdr(): Promise<boolean> {
    return this.environment['HERDR_ENV'] === '1';
  }

  async now(): Promise<number> {
    return Date.now();
  }

  async sessionId(): Promise<string> {
    return this.sessionIdOf();
  }

  async cwd(): Promise<string> {
    return this.directoryOf();
  }
}
