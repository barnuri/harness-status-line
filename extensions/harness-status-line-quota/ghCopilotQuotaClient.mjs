import { spawnSync } from "node:child_process";

export class GhCopilotQuotaClient {
  static TIMEOUT_MS = 10_000;

  constructor(runCommand = GhCopilotQuotaClient.runCommand) {
    this.runCommand = runCommand;
  }

  fetchSnapshot() {
    const accounts = this.#listAccounts();
    const candidates = accounts
      .map((account) => this.#fetchAccountQuota(account))
      .filter((candidate) => candidate !== null)
      .sort((left, right) => right.snapshot.entitlementRequests - left.snapshot.entitlementRequests);
    return candidates[0] ?? null;
  }

  #listAccounts() {
    const result = this.runCommand(["auth", "status", "--json", "hosts"]);
    if (!result.success) {
      return [];
    }

    try {
      const parsed = JSON.parse(result.stdout);
      const accounts = parsed?.hosts?.["github.com"];
      if (!Array.isArray(accounts)) {
        return [];
      }
      return accounts
        .filter((account) => account?.state === "success" && typeof account.login === "string")
        .map((account) => account.login);
    } catch {
      return [];
    }
  }

  #fetchAccountQuota(login) {
    const tokenResult = this.runCommand(["auth", "token", "--user", login]);
    const token = tokenResult.success ? tokenResult.stdout.trim() : "";
    if (!token) {
      return null;
    }

    const quotaResult = this.runCommand(
      ["api", "copilot_internal/user"],
      { GH_TOKEN: token, GH_HOST: "github.com" },
    );
    if (!quotaResult.success) {
      return null;
    }

    try {
      const payload = JSON.parse(quotaResult.stdout);
      const premium = payload?.quota_snapshots?.premium_interactions;
      const entitlement = this.#asNumber(premium?.entitlement);
      const used = this.#asNumber(premium?.credits_used);
      const remainingPercentage = this.#asNumber(premium?.percent_remaining);
      if (
        entitlement === null ||
        entitlement <= 0 ||
        used === null ||
        remainingPercentage === null ||
        remainingPercentage < 0 ||
        remainingPercentage > 100
      ) {
        return null;
      }

      const resetDate = this.#normalizeResetDate(payload?.quota_reset_date);
      return {
        login,
        snapshot: {
          isUnlimitedEntitlement: false,
          entitlementRequests: entitlement,
          usedRequests: used,
          remainingPercentage,
          ...(resetDate !== null ? { resetDate } : {}),
        },
      };
    } catch {
      return null;
    }
  }

  #normalizeResetDate(value) {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
    return Number.isNaN(Date.parse(normalized)) ? null : normalized;
  }

  #asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  static runCommand(args, additionalEnv = {}) {
    const result = spawnSync("gh", args, {
      encoding: "utf8",
      env: { ...process.env, ...additionalEnv },
      timeout: GhCopilotQuotaClient.TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return {
      success: result.status === 0 && result.error === undefined,
      stdout: result.stdout ?? "",
    };
  }
}
