import type { ActivityState } from '../types.ts';
import type { OpencodeDataEvent, OpencodeTuiSlice } from './types.ts';

/**
 * Live activity of an opencode 2 session, read from the TUI's own state on every call. The session
 * status, open permissions, open forms and a running compaction are current state. How the last turn
 * ended (failed, interrupted, succeeded) exists only as an event, so it is kept per session from the data bus.
 */
export class OpencodeActivityTracker {
  private static readonly RUNNING_STATUS = 'running';
  private static readonly COMPACTION_TYPE = 'compaction';
  private static readonly OUTCOMES: Readonly<Record<string, ActivityState | null>> = {
    'session.execution.started': null,
    'session.execution.succeeded': 'idle',
    'session.execution.failed': 'error',
    'session.execution.interrupted': 'interrupted',
  };

  private readonly outcomes = new Map<string, ActivityState>();

  constructor(private readonly api: OpencodeTuiSlice) {}

  /** Starts listening for turn outcomes. Returns the unsubscribe function. */
  start(): () => void {
    const listen = this.api.data?.listen;
    if (!listen) {
      return () => {};
    }
    return listen((event) => this.receive(event));
  }

  current(sessionId: string | undefined): ActivityState | null {
    if (!sessionId) {
      return null;
    }
    const members = [sessionId, ...(this.call(() => this.api.data?.session?.family?.(sessionId)) ?? [])];
    if (members.some((id) => this.hasOpen(id, 'permission'))) {
      return 'permission';
    }
    if (members.some((id) => this.hasOpen(id, 'form'))) {
      return 'question';
    }
    if (this.isCompacting(sessionId)) {
      return 'compacting';
    }
    if (this.call(() => this.api.data?.session?.status?.(sessionId)) === OpencodeActivityTracker.RUNNING_STATUS) {
      return 'running';
    }
    return this.outcomes.get(sessionId) ?? 'idle';
  }

  routeSessionId(): string | undefined {
    const route = this.call(() => this.api.ui?.router?.current?.());
    return route?.type === 'session' ? route.sessionID : undefined;
  }

  private receive(event: OpencodeDataEvent): void {
    const type = event.details?.type;
    const sessionId = event.details?.data?.sessionID;
    if (!type || !sessionId || !(type in OpencodeActivityTracker.OUTCOMES)) {
      return;
    }
    const outcome = OpencodeActivityTracker.OUTCOMES[type];
    if (outcome) {
      this.outcomes.set(sessionId, outcome);
    } else {
      this.outcomes.delete(sessionId);
    }
  }

  private hasOpen(sessionId: string, kind: 'permission' | 'form'): boolean {
    const list = this.call(() => this.api.data?.session?.[kind]?.list?.(sessionId));
    return Array.isArray(list) && list.length > 0;
  }

  private isCompacting(sessionId: string): boolean {
    const messages = this.call(() => this.api.data?.session?.message?.list?.(sessionId)) ?? [];
    const last = messages[messages.length - 1];
    return last?.type === OpencodeActivityTracker.COMPACTION_TYPE && last.status === OpencodeActivityTracker.RUNNING_STATUS;
  }

  private call<T>(read: () => T): T | undefined {
    try {
      return read();
    } catch {
      return undefined;
    }
  }
}
