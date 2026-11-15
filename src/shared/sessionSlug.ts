import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';

const slugDir = (): string => path.join(os.homedir(), '.claude', 'session-slugs');
const folderDir = (): string => path.join(os.homedir(), '.claude', 'session-slug-folders');

/** Reads the slug published for a session id by the `session-slug` skill, or null if absent. */
export function resolveSessionSlug(sessionId: string | undefined): string | null {
  if (!sessionId) {
    return null;
  }
  try {
    const slug = fs.readFileSync(path.join(slugDir(), sessionId), 'utf-8').trim();
    return slug || null;
  } catch {
    return null;
  }
}

/** Turns a title into a kebab-case slug body of at most 6 words. */
export function kebab(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join('-');
}

/** The first user prompt text in a Claude Code transcript (JSONL), or null. */
export function firstUserPrompt(transcriptPath: string | undefined): string | null {
  if (!transcriptPath) {
    return null;
  }
  let text: string;
  try {
    text = fs.readFileSync(transcriptPath, 'utf-8');
  } catch {
    return null;
  }
  for (const line of text.split('\n')) {
    try {
      const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
      if (entry.type !== 'user' || entry.message?.role !== 'user') {
        continue;
      }
      const content = entry.message.content;
      const prompt = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? (content.find((part) => part?.type === 'text')?.text as string | undefined) ?? ''
          : '';
      if (prompt && !prompt.startsWith('<')) {
        return prompt;
      }
    } catch {
      // skip a partial line
    }
  }
  return null;
}

function gitRoot(cwd: string): string | null {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 }).trim() || null;
  } catch {
    return null;
  }
}

export interface EnsureSlugInput {
  readonly sessionId: string | undefined;
  readonly title?: string | null;
  readonly transcriptPath?: string;
  readonly cwd?: string;
  readonly now?: Date;
}

/**
 * Returns the session's slug, and creates one when none is published yet: `YYYY-MM-DD-<kebab title>`.
 * Title: the given title, else the first user prompt in the transcript, else the cwd folder name.
 * Writes `~/.claude/session-slugs/<id>`, `~/.claude/session-slug-folders/<id>` and `<git root>/agent-spec/<slug>/`.
 */
export function ensureSessionSlug(input: EnsureSlugInput): string | null {
  const existing = resolveSessionSlug(input.sessionId);
  // `bun test` sets NODE_ENV=test: tests must never write into the real ~/.claude.
  if (existing || !input.sessionId || process.env['NODE_ENV'] === 'test' || process.env['HARNESS_SLUG_AUTOCREATE'] === '0') {
    return existing;
  }
  const source = input.title || firstUserPrompt(input.transcriptPath) || (input.cwd ? path.basename(input.cwd) : '');
  const body = kebab(source) || 'session';
  const day = input.now ?? new Date();
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const slug = `${date}-${body}`;
  try {
    fs.mkdirSync(slugDir(), { recursive: true });
    fs.writeFileSync(path.join(slugDir(), input.sessionId), `${slug}\n`);
    const root = input.cwd ? gitRoot(input.cwd) : null;
    if (root) {
      const folder = path.join(root, 'agent-spec', slug);
      fs.mkdirSync(folder, { recursive: true });
      fs.mkdirSync(folderDir(), { recursive: true });
      fs.writeFileSync(path.join(folderDir(), input.sessionId), `${folder}\n`);
    }
  } catch {
    return slug;
  }
  return slug;
}
