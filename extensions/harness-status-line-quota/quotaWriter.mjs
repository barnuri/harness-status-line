import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export class CopilotQuotaWriter {
  static FILE_PATH = join(
    process.env.COPILOT_HOME ?? join(homedir(), ".copilot"),
    "harness-status-line-quota.json",
  );

  constructor(filePath = CopilotQuotaWriter.FILE_PATH) {
    this.filePath = filePath;
  }

  write(snapshots, updatedAt = Date.now()) {
    if (!this.#isRecord(snapshots)) {
      return false;
    }

    const quotas = Object.entries(snapshots)
      .map(([id, snapshot]) => this.#mapQuota(id, snapshot))
      .filter((quota) => quota !== null);
    if (quotas.length === 0) {
      return false;
    }

    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify({ updatedAt, quotas })}\n`, "utf8");
    renameSync(temporaryPath, this.filePath);
    return true;
  }

  #mapQuota(id, snapshot) {
    if (!this.#isRecord(snapshot) || typeof id !== "string" || id.length === 0) {
      return null;
    }

    const entitlement = this.#asNumber(snapshot.entitlementRequests);
    const used = this.#asNumber(snapshot.usedRequests);
    const unlimited = snapshot.isUnlimitedEntitlement === true || (entitlement !== null && entitlement < 0);
    if (unlimited || (entitlement !== null && entitlement <= 0)) {
      return null;
    }

    const reportedRemaining = this.#asNumber(snapshot.remainingPercentage);
    const remainingPercentage = reportedRemaining !== null && reportedRemaining >= 0 && reportedRemaining <= 100
      ? reportedRemaining
      : entitlement !== null && entitlement > 0 && used !== null
        ? Math.max(0, Math.min(100, ((entitlement - used) / entitlement) * 100))
        : null;
    if (remainingPercentage === null) {
      return null;
    }

    const resetDate = typeof snapshot.resetDate === "string" && !Number.isNaN(Date.parse(snapshot.resetDate))
      ? snapshot.resetDate
      : null;

    return {
      id,
      ...(used !== null ? { used } : {}),
      ...(entitlement !== null ? { entitlement } : {}),
      remainingPercentage,
      ...(resetDate !== null ? { resetDate } : {}),
    };
  }

  #isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  #asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
}
