const isCopilotExtension = Boolean(
  process.env.COPILOT_SDK_PATH &&
    process.env.SESSION_ID &&
    process.env.COPILOT_EXTENSION_PARENT_PID,
);

if (!isCopilotExtension) {
  process.stderr.write("[harness-status-line-quota] skipped outside the Copilot CLI extension host\n");
  process.exit(0);
}

const { joinSession } = await import("@github/copilot-sdk/extension");
const { CopilotQuotaWriter } = await import("./quotaWriter.mjs");
const { GhCopilotQuotaClient } = await import("./ghCopilotQuotaClient.mjs");
const session = await joinSession({ tools: [] });
const writer = new CopilotQuotaWriter();
const ghQuotaClient = new GhCopilotQuotaClient();
const REFRESH_INTERVAL_MS = 30_000;
let refreshInProgress = false;

function summarizeSnapshots(snapshots) {
  return Object.fromEntries(
    Object.entries(snapshots ?? {}).map(([id, snapshot]) => [
      id,
      {
        usedRequests: snapshot?.usedRequests,
        entitlementRequests: snapshot?.entitlementRequests,
        remainingPercentage: snapshot?.remainingPercentage,
      },
    ]),
  );
}

async function refreshQuota() {
  if (refreshInProgress) {
    return;
  }

  refreshInProgress = true;
  try {
    const now = Date.now();
    const polledAt = now;
    if (!writer.claimPoll(polledAt, REFRESH_INTERVAL_MS)) {
      process.stderr.write(
        `[harness-status-line-quota] poll skipped; another process owns the current interval\n`,
      );
      return;
    }
    const preferredEntitlement = writer.getEntitlement("premium_interactions");
    const ghCandidate = await ghQuotaClient.fetchSnapshot(preferredEntitlement);
    if (ghCandidate !== null) {
      const snapshots = { premium_interactions: ghCandidate.snapshot };
      const written = writer.write(snapshots, Date.now(), polledAt, "gh");
      process.stderr.write(
        `[harness-status-line-quota] gh account=${ghCandidate.login}; snapshots=${JSON.stringify(summarizeSnapshots(snapshots))}; write=${written}; polledAt=${new Date(polledAt).toISOString()}\n`,
      );
      return;
    }

    const result = await session.rpc.model.list({ skipCache: true });
    const snapshots = result.quotaSnapshots;
    const written = snapshots
      ? writer.write(snapshots, Date.now(), polledAt, "model-list")
      : false;
    process.stderr.write(
      `[harness-status-line-quota] gh unavailable; model-list snapshots=${JSON.stringify(summarizeSnapshots(snapshots))}; write=${written}; previous quota preserved=${!written}; polledAt=${new Date(polledAt).toISOString()}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[harness-status-line-quota] ${message}\n`);
  } finally {
    refreshInProgress = false;
  }
}

void refreshQuota();
setInterval(() => {
  void refreshQuota();
}, REFRESH_INTERVAL_MS);

session.on("assistant.usage", (event) => {
  const snapshots = event.data?.quotaSnapshots;
  if (snapshots) {
    try {
      const updatedAt = Date.now();
      const hasGitHubQuota = writer.getSource() === "gh";
      const written = hasGitHubQuota
        ? (writer.recordAssistantUsage(updatedAt), false)
        : writer.write(snapshots, updatedAt, writer.getPolledAt(), "assistant.usage");
      process.stderr.write(
        `[harness-status-line-quota] event snapshots=${JSON.stringify(summarizeSnapshots(snapshots))}; write=${written}; github preferred=${hasGitHubQuota}; polledAt=${writer.getPolledAt() === null ? "missing" : new Date(writer.getPolledAt()).toISOString()}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[harness-status-line-quota] ${message}\n`);
    }
  }
});
