import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ActivityState } from '../types.ts';

/**
 * Reads a Claude Code session's activity from the file `hooks/session-activity.sh` writes on each hook event:
 * `~/.claude/session-activity/<session_id>` = `{"state":"running","updated_at":<epoch secs>}`.
 * No hook fires when the user presses Esc, so a `running` state whose transcript ends in the interrupt
 * marker reads as `interrupted`.
 */
export class SessionActivityReader {
  static readonly STATES: ReadonlyArray<ActivityState> = ['running', 'compacting', 'permission', 'question', 'idle', 'error', 'interrupted'];
  private static readonly INTERRUPT_MARKER = '[Request interrupted by user';
  private static readonly TRANSCRIPT_TAIL_BYTES = 16_384;

  constructor(private readonly stateDir: string = path.join(os.homedir(), '.claude', 'session-activity')) {}

  read(sessionId: string | undefined, transcriptPath?: string): ActivityState | null {
    if (!sessionId || sessionId.includes('/')) {
      return null;
    }
    const state = this.readState(sessionId);
    if (state === 'running' && transcriptPath && this.endsInInterrupt(transcriptPath)) {
      return 'interrupted';
    }
    return state;
  }

  private readState(sessionId: string): ActivityState | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.stateDir, sessionId), 'utf-8')) as { state?: unknown };
      const state = parsed.state;
      return SessionActivityReader.STATES.find((known) => known === state) ?? null;
    } catch {
      return null;
    }
  }

  private endsInInterrupt(transcriptPath: string): boolean {
    let fd: number | undefined;
    try {
      fd = fs.openSync(transcriptPath, 'r');
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, SessionActivityReader.TRANSCRIPT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      const lines = buffer.toString('utf-8').split('\n').filter((line) => line.trim().length > 0);
      return lines[lines.length - 1]?.includes(SessionActivityReader.INTERRUPT_MARKER) ?? false;
    } catch {
      return false;
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
    }
  }
}
