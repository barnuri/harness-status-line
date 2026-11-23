import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isRecord } from '../shared/isRecord.ts';
import type { OrchWork } from './types.ts';

type OrchRow = Record<string, unknown>;

/**
 * Orch work of one opencode session, read from the orch state folders (`runs/`, `loops/`, `watches/`).
 * A run belongs to the session only when the session is its coordinator. A node's owner is the session that
 * dispatched that node into someone else's run, so it does not make the run this session's. Loops and monitors
 * count only while one of the session's runs has nodes running.
 */
export class OrchStateReader {
  private static readonly HOME = path.join(os.homedir(), '.harness-orch');
  private static readonly RUNNING = 'running';
  private static readonly LOOPS = 'loops';
  private static readonly WATCHES = 'watches';
  private static readonly RUNS = 'runs';
  private static readonly STATE_FILE = 'state.json';

  constructor(private readonly home: string = OrchStateReader.HOME) {}

  /** The orch work of a session, or null when no run of it has nodes running. Never throws. */
  read(sessionId: string): OrchWork | null {
    const runs = this.rows(OrchStateReader.RUNS).filter(([, state]) => state.status === OrchStateReader.RUNNING && this.coordinatorSession(state) === sessionId);
    const nodes = runs.flatMap(([, state]) => this.nodes(state));
    const running = nodes.filter((node) => node.status === 'running').length;
    if (running === 0) {
      return null;
    }
    const mine = new Set(runs.map(([id]) => id));
    const [id, state] = runs[0] ?? [];
    return {
      running,
      done: nodes.filter((node) => node.status === 'done').length,
      total: nodes.length,
      loops: this.countOwned(OrchStateReader.LOOPS, mine),
      monitors: this.countOwned(OrchStateReader.WATCHES, mine),
      runTitle: this.title(state, id),
    };
  }

  // The coordinator's session id, or the session that started the run when the coordinator has none
  // (a herdr-registered coordinator may leave session_id empty).
  private coordinatorSession(state: OrchRow): unknown {
    const coordinator = state.coordinator;
    const fromCoordinator = isRecord(coordinator) ? coordinator.session_id : undefined;
    return typeof fromCoordinator === 'string' && fromCoordinator !== '' ? fromCoordinator : state.harness_session;
  }

  private nodes(state: OrchRow): OrchRow[] {
    return Array.isArray(state.nodes) ? state.nodes.filter(isRecord) : [];
  }

  private title(state: OrchRow | undefined, id: string | undefined): string | null {
    if (typeof state?.title === 'string' && state.title.trim() !== '') {
      return state.title.trim();
    }
    return id ?? null;
  }

  // A loop or monitor counts while its process lives (a demo loop has no process) and its run is one of this session's.
  private countOwned(kind: string, mine: ReadonlySet<string>): number {
    return this.rows(kind).filter(([id, state]) => {
      const live = OrchStateReader.pidAlive(state.pid) || (kind === OrchStateReader.LOOPS && state.demo === true);
      const runId = String(state.run_id ?? state.run ?? state.id ?? id);
      return state.status === OrchStateReader.RUNNING && live && mine.has(runId);
    }).length;
  }

  private rows(kind: string): Array<[string, OrchRow]> {
    const root = path.join(this.home, kind);
    let ids: string[];
    try {
      ids = fs.readdirSync(root);
    } catch {
      return [];
    }
    const rows: Array<[string, OrchRow]> = [];
    for (const id of ids) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, id, OrchStateReader.STATE_FILE), 'utf8'));
        if (isRecord(parsed)) {
          rows.push([id, parsed]);
        }
      } catch {
        /* a folder without a readable state file is skipped */
      }
    }
    return rows;
  }

  private static pidAlive(pid: unknown): boolean {
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  }
}
