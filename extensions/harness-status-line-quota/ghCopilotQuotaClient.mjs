import { execFile } from "node:child_process";
import { promisify } from "node:util";

export class GhCopilotQuotaClient {
  static TIMEOUT_MS = 10_000;
  static execFile = promisify(execFile);

  constructor(runCommand = GhCopilotQuotaClient.runCommand) {
    this.runCommand = runCommand;
  }

  async fetchSnapshot(preferredEntitlement = null) {
    const accounts = await this.#listAccounts();
    const candidates = (await Promise.all(accounts.map((account) => this.#fetchAccountQuota(account))))
      .filter((candidate) => candidate !== null);
    if (candidates.length === 1) {
      return candidates[0];
    }

    const preferred = candidates.filter(
      (candidate) => candidate.snapshot.entitlementRequests === preferredEntitlement,
    );
    return preferred.length === 1 ? preferred[0] : null;
  }

  async #listAccounts() {
    const result = await this.runCommand(["auth", "status", "--json", "hosts"]);
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

  async #fetchAccountQuota(login) {
    const tokenResult = await this.runCommand([
      "auth",
      "token",
      "--hostname",
      "github.com",
      "--user",
      login,
    ]);
    const token = tokenResult.success ? tokenResult.stdout.trim() : "";
    if (!token) {
      return null;
    }

    const quotaResult = await this.runCommand(
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

  static async runCommand(args, additionalEnv = {}) {
    try {
      const result = await GhCopilotQuotaClient.execFile("gh", args, {
        encoding: "utf8",
        env: { ...process.env, ...additionalEnv },
        timeout: GhCopilotQuotaClient.TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });
      return { success: true, stdout: result.stdout };
    } catch {
      return { success: false, stdout: "" };
    }
  }
}
