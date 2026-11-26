import { Database } from 'bun:sqlite';
import * as os from 'os';
import * as path from 'path';

export interface AutomationWork {
  readonly count: number;
  /** Epoch ms of the soonest next run, or null when none has a due time. */
  readonly nextDueMs: number | null;
  readonly failed: number;
}

export interface GoalWork {
  readonly completed: number;
  readonly total: number;
  /** Content of the item in progress, or null. */
  readonly current: string | null;
}

/** The session goal set with opencode's `/goal` command. */
export interface SessionGoal {
  readonly status: 'active' | 'paused' | 'complete';
  readonly objective: string;
  readonly rounds: number;
  readonly maxRounds: number;
}

export interface ScheduleWork {
  readonly automations: AutomationWork;
  readonly goals: GoalWork;
  readonly goal: SessionGoal | null;
}

/**
 * Active automations and todo goals of one opencode session, read from `opencode.db` read-only.
 * Cached 5 s per session. Never throws: on any error it returns the last good value, or empty.
 */
export class OpencodeScheduleReader {
  static readonly CACHE_MS = 5000;
  static readonly EMPTY: ScheduleWork = {
    automations: { count: 0, nextDueMs: null, failed: 0 },
    goals: { completed: 0, total: 0, current: null },
    goal: null,
  };
  // "opencode.goal" written as UTF-16 hex, as opencode builds its plugin kv keys.
  private static readonly GOAL_KEY_PREFIX = 'plugin:006f00700065006e0063006f00640065002e0067006f0061006c:session:';
  private static readonly GOAL_SQL = 'SELECT value FROM kv WHERE key = ?1';
  private static readonly GOAL_STATUSES: readonly string[] = ['active', 'paused', 'complete'];
  private static readonly DB = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  private static readonly AUTOMATION_SQL = `SELECT next_due_at AS due, last_outcome AS outcome FROM automation
    WHERE session_id = ?1 AND status = 'active'`;
  private static readonly TODO_SQL = 'SELECT content, status FROM todo WHERE session_id = ?1 ORDER BY position';

  private readonly cache = new Map<string, { readAtMs: number; work: ScheduleWork }>();

  constructor(
    private readonly dbPath: string = OpencodeScheduleReader.DB,
    private readonly now: () => number = Date.now,
  ) {}

  read(sessionId: string | undefined): ScheduleWork {
    if (!sessionId) {
      return OpencodeScheduleReader.EMPTY;
    }
    const nowMs = this.now();
    const hit = this.cache.get(sessionId);
    if (hit && nowMs - hit.readAtMs < OpencodeScheduleReader.CACHE_MS) {
      return hit.work;
    }
    const work = this.query(sessionId) ?? hit?.work ?? OpencodeScheduleReader.EMPTY;
    this.cache.set(sessionId, { readAtMs: nowMs, work });
    return work;
  }

  private query(sessionId: string): ScheduleWork | null {
    let db: Database | undefined;
    try {
      db = new Database(this.dbPath, { readonly: true });
      db.exec('PRAGMA busy_timeout = 20');
      const automations = db.query(OpencodeScheduleReader.AUTOMATION_SQL).all(sessionId) as AutomationRow[];
      const todos = db.query(OpencodeScheduleReader.TODO_SQL).all(sessionId) as TodoRow[];
      return {
        automations: this.summarizeAutomations(automations),
        goals: this.summarizeTodos(todos),
        goal: this.readGoal(db, sessionId),
      };
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

  // A missing kv table or a bad value only hides the goal, not the other chips.
  private readGoal(db: Database, sessionId: string): SessionGoal | null {
    try {
      const key = OpencodeScheduleReader.GOAL_KEY_PREFIX + sessionId;
      const row = db.query(OpencodeScheduleReader.GOAL_SQL).get(key) as { value: string } | null;
      return row ? this.parseGoal(row.value) : null;
    } catch {
      return null;
    }
  }

  private parseGoal(json: string): SessionGoal | null {
    const data = JSON.parse(json) as Record<string, unknown>;
    const { status, objective, rounds, maxRounds } = data;
    if (typeof status !== 'string' || !OpencodeScheduleReader.GOAL_STATUSES.includes(status)) {
      return null;
    }
    if (typeof objective !== 'string') {
      return null;
    }
    return {
      status: status as SessionGoal['status'],
      objective,
      rounds: typeof rounds === 'number' ? rounds : 0,
      maxRounds: typeof maxRounds === 'number' ? maxRounds : 0,
    };
  }

  private summarizeAutomations(rows: AutomationRow[]): AutomationWork {
    const dues = rows.map((row) => row.due).filter((due): due is number => typeof due === 'number');
    return {
      count: rows.length,
      nextDueMs: dues.length > 0 ? Math.min(...dues) : null,
      failed: rows.filter((row) => row.outcome === 'failed').length,
    };
  }

  private summarizeTodos(rows: TodoRow[]): GoalWork {
    const completed = rows.filter((row) => row.status === 'completed').length;
    const current = rows.find((row) => row.status === 'in_progress');
    return { completed, total: rows.length, current: current?.content ?? null };
  }
}

interface AutomationRow {
  readonly due: number | null;
  readonly outcome: string | null;
}

interface TodoRow {
  readonly content: string;
  readonly status: string;
}
