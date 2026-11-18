import { Database } from 'bun:sqlite';
import * as os from 'os';
import * as path from 'path';

export interface JobItem {
  /** The shell command (bg) or the session title (sub). */
  readonly text: string;
  /** Epoch ms when it started. */
  readonly startedMs: number;
}

export interface JobWork {
  readonly bgCount: number;
  readonly bgOldest: JobItem | null;
  readonly subCount: number;
  readonly subFirst: JobItem | null;
}

/**
 * Background shell commands and busy subagent sessions of one opencode session, read from `opencode.db`
 * read-only. Shell commands are `job` rows with kind `shell` and status `running`. Subagents are descendant
 * sessions (`session_v2.parent_id`) whose `time_busy` is later than `time_idle`. Cached 2 s per session; never throws.
 */
export class OpencodeJobReader {
  static readonly CACHE_MS = 2000;
  private static readonly DB = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  private static readonly FAMILY =
    'WITH RECURSIVE family(id) AS (SELECT ?1 UNION SELECT s.id FROM session_v2 s JOIN family f ON s.parent_id = f.id)';
  private static readonly BG_SQL = `${OpencodeJobReader.FAMILY}
    SELECT title AS text, time_created AS started FROM job
    WHERE kind = 'shell' AND status = 'running' AND session_id IN (SELECT id FROM family) ORDER BY time_created`;
  private static readonly SUB_SQL = `${OpencodeJobReader.FAMILY}
    SELECT COALESCE(title, slug) AS text, time_busy AS started FROM session_v2
    WHERE parent_id IS NOT NULL AND id IN (SELECT id FROM family) AND id <> ?1 AND time_archived IS NULL
      AND time_busy IS NOT NULL AND (time_idle IS NULL OR time_busy > time_idle) ORDER BY time_busy`;

  private readonly cache = new Map<string, { readAtMs: number; work: JobWork }>();
  private static readonly NONE: JobWork = { bgCount: 0, bgOldest: null, subCount: 0, subFirst: null };

  constructor(
    private readonly dbPath: string = OpencodeJobReader.DB,
    private readonly now: () => number = Date.now,
  ) {}

  read(sessionId: string | undefined): JobWork {
    if (!sessionId) {
      return OpencodeJobReader.NONE;
    }
    const nowMs = this.now();
    const hit = this.cache.get(sessionId);
    if (hit && nowMs - hit.readAtMs < OpencodeJobReader.CACHE_MS) {
      return hit.work;
    }
    const work = this.query(sessionId) ?? hit?.work ?? OpencodeJobReader.NONE;
    this.cache.set(sessionId, { readAtMs: nowMs, work });
    return work;
  }

  private query(sessionId: string): JobWork | null {
    let db: Database | undefined;
    try {
      db = new Database(this.dbPath, { readonly: true });
      db.exec('PRAGMA busy_timeout = 20');
      const bg = db.query(OpencodeJobReader.BG_SQL).all(sessionId) as Array<{ text: string | null; started: number }>;
      const sub = db.query(OpencodeJobReader.SUB_SQL).all(sessionId) as Array<{ text: string | null; started: number }>;
      const item = (row: { text: string | null; started: number } | undefined): JobItem | null =>
        row ? { text: row.text ?? '', startedMs: row.started } : null;
      return { bgCount: bg.length, bgOldest: item(bg[0]), subCount: sub.length, subFirst: item(sub[0]) };
    } catch {
      return null;
    } finally {
      try {
        db?.close();
      } catch {
        /* ignore */
      }
    }
  }
}
