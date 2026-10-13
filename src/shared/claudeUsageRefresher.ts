import * as path from 'path';
import { SpendLedger } from './spendLedger.ts';

export class ClaudeUsageRefresher {
  static readonly COMMAND_FLAG = '--refresh-claude-usage';

  private readonly ledger: SpendLedger;
  private readonly spawnRefresh: () => void;

  constructor(ledger?: SpendLedger, spawnRefresh?: () => void) {
    this.ledger = ledger ?? new SpendLedger();
    this.spawnRefresh = spawnRefresh ?? (() => this.spawnDetached());
  }

  refreshInBackground(nowMs: number = Date.now()): void {
    if (!this.ledger.claimApiRefresh(nowMs)) {
      return;
    }
    try {
      this.spawnRefresh();
    } catch (err: unknown) {
      this.ledger.releaseApiRefresh();
      if (!(err instanceof Error)) {
        throw err;
      }
    }
  }

  private spawnDetached(): void {
    const entryPoint = path.join(import.meta.dir, '..', 'index.ts');
    const child = Bun.spawn([process.execPath, entryPoint, ClaudeUsageRefresher.COMMAND_FLAG], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.unref();
  }
}
