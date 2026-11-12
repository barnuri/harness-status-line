import type { StatusJSON, UsageSnapshot } from '../types.ts';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class UsageSnapshotWriter {
  private static readonly DEFAULT_FILE_PATH = path.join(os.homedir(), '.claude', 'usage-snapshot.json');

  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? UsageSnapshotWriter.DEFAULT_FILE_PATH;
  }

  write(status: StatusJSON, nowMs: number = Date.now()): void {
    if (!status.rate_limits) {
      return;
    }
    const snapshot: UsageSnapshot = {
      api: status.api ?? null,
      rate_limits: status.rate_limits,
      ...(status.session_id ? { session_id: status.session_id } : {}),
      captured_at: new Date(nowMs).toISOString(),
    };
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(snapshot));
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      fs.rmSync(tmpPath, { force: true });
    }
  }
}
