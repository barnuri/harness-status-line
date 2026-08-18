import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/** Reads the slug published for a session id by the `session-slug` skill, or null if absent. */
export function resolveSessionSlug(sessionId: string | undefined): string | null {
  if (!sessionId) {
    return null;
  }
  const slugFile = path.join(os.homedir(), '.claude', 'session-slugs', sessionId);
  try {
    const slug = fs.readFileSync(slugFile, 'utf-8').trim();
    return slug || null;
  } catch {
    return null;
  }
}
