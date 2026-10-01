import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export class CopilotQuotaWriter {
  static FILE_PATH = join(
    process.env.COPILOT_HOME ?? join(homedir(), ".copilot"),
    "harness-status-line-quota.json",
  );

  constructor(filePath = CopilotQuotaWriter.FILE_PATH) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
  }

  write(snapshots, updatedAt = Date.now(), polledAt = this.getPolledAt(), source = null) {
    return this.#withLock(() => this.#writeSnapshots(snapshots, updatedAt, polledAt, source), false);
  }

  #writeSnapshots(snapshots, updatedAt, polledAt, source) {
    if (!this.#isRecord(snapshots)) {
      return false;
    }

    const previous = this.#readState();
    const previousQuotas = previous?.quotas;
    const quotas = Object.entries(snapshots)
      .map(([id, snapshot]) => this.#mapQuota(id, snapshot))
      .filter((quota) => quota !== null)
      .map((quota) => this.#preserveNewerQuota(quota, previousQuotas));
    if (quotas.length === 0) {
      return false;
    }

    const preservedPreviousQuota = quotas.some((quota) =>
      Array.isArray(previousQuotas) && previousQuotas.includes(quota),
    );
    const resolvedUpdatedAt = preservedPreviousQuota
      ? this.#asNumber(previous?.updatedAt) ?? updatedAt
      : updatedAt;
    const previousSource = typeof previous?.source === "string" ? previous.source : null;
    const preserveGitHubQuota = previousSource === "gh" && source !== "gh";
    const resolvedSource = preservedPreviousQuota || preserveGitHubQuota ? previousSource : source;
    const resolvedQuotas = preserveGitHubQuota && Array.isArray(previousQuotas) ? previousQuotas : quotas;
    const resolvedStateUpdatedAt = preserveGitHubQuota
      ? this.#asNumber(previous?.updatedAt) ?? resolvedUpdatedAt
      : resolvedUpdatedAt;
    const previousGhUpdatedAt = this.#asNumber(previous?.ghUpdatedAt);
    const previousAssistantUsageUpdatedAt = this.#asNumber(previous?.assistantUsageUpdatedAt);
    this.#writeState({
      updatedAt: resolvedStateUpdatedAt,
      ...(polledAt !== null ? { polledAt } : {}),
      ...(resolvedSource !== null ? { source: resolvedSource } : {}),
      ...(source === "gh"
        ? { ghUpdatedAt: updatedAt }
        : previousGhUpdatedAt !== null
          ? { ghUpdatedAt: previousGhUpdatedAt }
          : {}),
      ...(source === "assistant.usage"
        ? { assistantUsageUpdatedAt: updatedAt }
        : previousAssistantUsageUpdatedAt !== null
          ? { assistantUsageUpdatedAt: previousAssistantUsageUpdatedAt }
          : {}),
      quotas: resolvedQuotas,
    });
    return true;
  }

  getPolledAt() {
    const polledAt = this.#readState()?.polledAt;
    return this.#asNumber(polledAt) !== null ? polledAt : null;
  }

  getEntitlement(quotaId) {
    const quotas = this.#readState()?.quotas;
    if (!Array.isArray(quotas)) {
      return null;
    }

    const quota = quotas.find((candidate) => candidate?.id === quotaId);
    return this.#asNumber(quota?.entitlement);
  }

  getSource() {
    const source = this.#readState()?.source;
    return typeof source === "string" ? source : null;
  }

  recordAssistantUsage(updatedAt = Date.now()) {
    return this.#withLock(() => {
      const previous = this.#readState();
      const previousUpdatedAt = this.#asNumber(previous?.updatedAt);
      const polledAt = this.#asNumber(previous?.polledAt);
      const ghUpdatedAt = this.#asNumber(previous?.ghUpdatedAt);
      const source = typeof previous?.source === "string" ? previous.source : null;
      const quotas = Array.isArray(previous?.quotas) ? previous.quotas : [];
      this.#writeState({
        updatedAt: previousUpdatedAt ?? updatedAt,
        ...(polledAt !== null ? { polledAt } : {}),
        ...(source !== null ? { source } : {}),
        ...(ghUpdatedAt !== null ? { ghUpdatedAt } : {}),
        assistantUsageUpdatedAt: updatedAt,
        quotas,
      });
      return true;
    }, false);
  }

  claimPoll(polledAt, intervalMs) {
    return this.#withLock(() => {
      const previous = this.#readState();
      const previousPolledAt = this.#asNumber(previous?.polledAt);
      if (
        previousPolledAt !== null &&
        polledAt >= previousPolledAt &&
        polledAt - previousPolledAt < intervalMs
      ) {
        return false;
      }

      const updatedAt = this.#asNumber(previous?.updatedAt) ?? polledAt;
      const source = typeof previous?.source === "string" ? previous.source : null;
      const ghUpdatedAt = this.#asNumber(previous?.ghUpdatedAt);
      const assistantUsageUpdatedAt = this.#asNumber(previous?.assistantUsageUpdatedAt);
      const quotas = Array.isArray(previous?.quotas) ? previous.quotas : [];
      this.#writeState({
        updatedAt,
        polledAt,
        ...(source !== null ? { source } : {}),
        ...(ghUpdatedAt !== null ? { ghUpdatedAt } : {}),
        ...(assistantUsageUpdatedAt !== null ? { assistantUsageUpdatedAt } : {}),
        quotas,
      });
      return true;
    }, false);
  }

  markPolled(polledAt = Date.now()) {
    return this.#withLock(() => {
      const previous = this.#readState();
      const previousUpdatedAt = this.#asNumber(previous?.updatedAt);
      const updatedAt = previousUpdatedAt !== null ? previousUpdatedAt : polledAt;
      const quotas = Array.isArray(previous?.quotas) ? previous.quotas : [];
      const source = typeof previous?.source === "string" ? previous.source : null;
      const ghUpdatedAt = this.#asNumber(previous?.ghUpdatedAt);
      const assistantUsageUpdatedAt = this.#asNumber(previous?.assistantUsageUpdatedAt);
      this.#writeState({
        updatedAt,
        polledAt,
        ...(source !== null ? { source } : {}),
        ...(ghUpdatedAt !== null ? { ghUpdatedAt } : {}),
        ...(assistantUsageUpdatedAt !== null ? { assistantUsageUpdatedAt } : {}),
        quotas,
      });
      return true;
    }, false);
  }

  #readState() {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      return this.#isRecord(parsed) ? parsed : null;
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) {
        return null;
      }
      throw error;
    }
  }

  #writeState(state) {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, "utf8");
    renameSync(temporaryPath, this.filePath);
  }

  #withLock(operation, fallback) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const lock = this.#acquireLock();
    if (lock === null) {
      return fallback;
    }

    try {
      return operation();
    } finally {
      closeSync(lock.file);
      this.#releaseLock(lock.owner);
    }
  }

  #acquireLock() {
    const owner = `${process.pid}:${randomUUID()}`;
    let file = null;
    try {
      file = openSync(this.lockPath, "wx");
      writeFileSync(file, owner, "utf8");
      return { file, owner };
    } catch (error) {
      if (file !== null) {
        closeSync(file);
        try {
          unlinkSync(this.lockPath);
        } catch (cleanupError) {
          if (!(cleanupError instanceof Error && "code" in cleanupError && cleanupError.code === "ENOENT")) {
            throw cleanupError;
          }
        }
      }
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        return null;
      }
      throw error;
    }
  }

  #releaseLock(owner) {
    try {
      if (readFileSync(this.lockPath, "utf8") !== owner) {
        return;
      }
      unlinkSync(this.lockPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
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
    const remainingPercentage = entitlement !== null && entitlement > 0 && used !== null
      ? Math.max(0, Math.min(100, ((entitlement - used) / entitlement) * 100))
      : reportedRemaining !== null && reportedRemaining >= 0 && reportedRemaining <= 100
        ? reportedRemaining
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

  #preserveNewerQuota(quota, previousQuotas) {
    if (!Array.isArray(previousQuotas) || quota.used === undefined) {
      return quota;
    }

    const previous = previousQuotas.find((candidate) => candidate?.id === quota.id);
    const previousUsed = this.#asNumber(previous?.used);
    const sameCycle =
      previous?.resetDate === quota.resetDate &&
      previous?.entitlement === quota.entitlement;
    return sameCycle && previousUsed !== null && quota.used < previousUsed ? previous : quota;
  }

  #isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  #asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
}
