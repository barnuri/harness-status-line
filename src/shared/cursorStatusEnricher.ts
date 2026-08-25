import type { StatusJSON } from '../types.ts';
import { CursorUsageClient } from './cursorUsageClient.ts';
import { CursorUsageStore } from './cursorUsageStore.ts';

export class CursorStatusEnricher {
  private readonly store: CursorUsageStore;
  private readonly client: CursorUsageClient;

  constructor(store?: CursorUsageStore, client?: CursorUsageClient) {
    this.store = store ?? new CursorUsageStore();
    this.client = client ?? new CursorUsageClient(undefined, this.store);
  }

  apply(status: StatusJSON, nowMs: number = Date.now()): StatusJSON {
    if (!this.isCursorPayload(status)) {
      return status;
    }
    this.client.refreshInBackground(nowMs);
    if (status.rate_limits || status.credits) {
      return status;
    }
    const snapshot = this.store.read();
    if (!snapshot) {
      return status;
    }
    return {
      ...status,
      ...(snapshot.rate_limits ? { rate_limits: snapshot.rate_limits } : {}),
      ...(snapshot.credits ? { credits: snapshot.credits } : {}),
    };
  }

  private isCursorPayload(status: StatusJSON): boolean {
    return typeof status.render_width_chars === 'number' || typeof status.autorun === 'boolean';
  }
}
