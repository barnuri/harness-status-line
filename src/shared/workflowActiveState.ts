import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface WorkflowActiveStateFile {
  readonly active: boolean;
  readonly updated_at: number;
}

function stateFilePath(sessionId: string): string {
  return path.join(os.homedir(), '.claude', 'workflow-active', sessionId);
}

/** Writes the current workflow-active state for a session, best-effort. */
export function writeWorkflowActiveState(sessionId: string, active: boolean, nowSecs: number = Date.now() / 1000): void {
  try {
    const filePath = stateFilePath(sessionId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: WorkflowActiveStateFile = { active, updated_at: nowSecs };
    fs.writeFileSync(filePath, JSON.stringify(payload), 'utf-8');
  } catch {
    // best-effort — a missing/unwritable state dir must never break the status line
  }
}

/** True when the session's last-written state is `active` and not older than `staleAfterSeconds`. */
export function readWorkflowActiveState(
  sessionId: string | undefined,
  staleAfterSeconds: number,
  nowSecs: number = Date.now() / 1000,
): boolean {
  if (!sessionId) {
    return false;
  }
  try {
    const raw = fs.readFileSync(stateFilePath(sessionId), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WorkflowActiveStateFile>;
    if (parsed.active !== true || typeof parsed.updated_at !== 'number') {
      return false;
    }
    return nowSecs - parsed.updated_at <= staleAfterSeconds;
  } catch {
    return false;
  }
}
