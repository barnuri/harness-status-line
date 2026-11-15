import { describe, expect, it } from 'bun:test';
import { RecapErrorLog } from '../../claude-mods/summarize/hooks/recapErrorLog.ts';
import { RecapSessionFiles } from '../../claude-mods/summarize/hooks/recapSessionFiles.ts';
import type { RecapHost } from '../../claude-mods/summarize/hooks/recapHost.ts';
import type { RecapRepos } from '../../claude-mods/summarize/hooks/recapRepos.ts';

const FOLDER = '/work/web/agent-spec/2026-11-08-db';
const PATH = `${FOLDER}/overview.md`;

/** An in-memory host: files live in `files`, the folder exists when `folders` has it. */
function fakeFiles(files: Map<string, string>, folders: string[] = [FOLDER]) {
  const host: RecapHost = {
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    exists: async path => files.has(path) || folders.includes(path),
    read: async path => files.get(path) ?? '',
    write: async (path, text) => {
      files.set(path, text);
    },
    home: async () => '/home/u',
    osType: async () => 'darwin',
    isInsideHerdr: async () => false,
    now: async () => 1_000,
    sessionId: async () => 's1',
    cwd: async () => '/work/web',
  };
  return new RecapSessionFiles(host, null as unknown as RecapRepos, new RecapErrorLog(host));
}

describe('RecapSessionFiles.recordExchange', () => {
  it('creates overview.md with the session header and the first card when the file is missing', async () => {
    const files = new Map<string, string>();
    await fakeFiles(files).recordExchange(FOLDER, 'Which DB should we use?', 'Use Postgres.');

    expect(files.get(PATH)).toBe('> Session: 2026-11-08-db\n\n## Questions and Answers\n\n### Q1 — Which DB should we use?\n\n**Answer:** Use Postgres.\n');
  });

  it('appends the next card after a separator, without a second header', async () => {
    const files = new Map<string, string>();
    const session = fakeFiles(files);
    await session.recordExchange(FOLDER, 'Which DB?', 'Postgres.');
    await session.recordExchange(FOLDER, 'Cache or not?', 'No cache yet.');

    const text = files.get(PATH) ?? '';
    expect(text.split('## Questions and Answers').length - 1).toBe(1);
    expect(text).toContain('**Answer:** Postgres.\n\n---\n\n### Q2 — Cache or not?\n\n**Answer:** No cache yet.\n');
  });

  it('skips the write when a card for the same question exists', async () => {
    const files = new Map<string, string>([[PATH, '> Session: x\n\n## Questions and Answers\n\n### Q3 — Which DB?\n\n**Answer:** Postgres.\n']]);
    const before = files.get(PATH);
    await fakeFiles(files).recordExchange(FOLDER, 'Which DB?', 'Something else.');

    expect(files.get(PATH)).toBe(before);
  });

  it('writes nothing when the slug folder is missing', async () => {
    const files = new Map<string, string>();
    await fakeFiles(files, []).recordExchange(FOLDER, 'Which DB?', 'Postgres.');

    expect(files.has(PATH)).toBe(false);
  });

  it('logs a failed write and does not throw', async () => {
    const failing = new RecapSessionFiles({
      run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      exists: async () => true,
      read: async () => '',
      write: async () => {
        throw new Error('disk full');
      },
      home: async () => '/home/u',
      osType: async () => 'darwin',
      isInsideHerdr: async () => false,
      now: async () => 1_000,
      sessionId: async () => 's1',
      cwd: async () => '/work/web',
    }, null as unknown as RecapRepos, new RecapErrorLog({
      run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      exists: async () => false,
      read: async () => '',
      write: async () => undefined,
      home: async () => undefined,
      osType: async () => undefined,
      isInsideHerdr: async () => false,
      now: async () => 1_000,
      sessionId: async () => 's1',
      cwd: async () => '/work/web',
    }));

    await expect(failing.recordExchange(FOLDER, 'Which DB?', 'Postgres.')).resolves.toBeUndefined();
  });
});
