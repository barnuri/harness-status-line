import type { StatusJSON } from '../types.ts';
import { CopilotQuotaReader } from './copilotQuotaReader.ts';

export class CopilotQuotaEnricher {
  private readonly reader: CopilotQuotaReader;

  constructor(reader?: CopilotQuotaReader) {
    this.reader = reader ?? new CopilotQuotaReader();
  }

  apply(status: StatusJSON, nowMs: number = Date.now()): StatusJSON {
    if (!this.isCopilotPayload(status) || status.copilot_quota) {
      return status;
    }

    const quota = this.reader.read(nowMs);
    return quota ? { ...status, copilot_quota: quota } : status;
  }

  private isCopilotPayload(status: StatusJSON): boolean {
    return status.ai_used !== undefined || status.allow_all_enabled !== undefined || status.username !== undefined;
  }
}
