import { joinSession } from "@github/copilot-sdk/extension";
import { CopilotQuotaWriter } from "./quotaWriter.mjs";

const session = await joinSession({ tools: [] });
const writer = new CopilotQuotaWriter();
const REFRESH_INTERVAL_MS = 30_000;
let refreshInProgress = false;

async function refreshQuota() {
  if (refreshInProgress) {
    process.stderr.write("[harness-status-line-quota] refresh skipped: already in progress\n");
    return;
  }

  refreshInProgress = true;
  process.stderr.write("[harness-status-line-quota] refresh started\n");
  try {
    const result = await session.rpc.model.list({ skipCache: true });
    if (result.quotaSnapshots) {
      const written = writer.write(result.quotaSnapshots);
      const snapshotDetails = Object.fromEntries(
        Object.entries(result.quotaSnapshots).map(([id, snapshot]) => [
          id,
          {
            entitlementRequests: snapshot?.entitlementRequests,
            usedRequests: snapshot?.usedRequests,
            remainingPercentage: snapshot?.remainingPercentage,
            resetDate: snapshot?.resetDate,
            isUnlimitedEntitlement: snapshot?.isUnlimitedEntitlement,
          },
        ]),
      );
      process.stderr.write(
        `[harness-status-line-quota] refresh snapshots=${JSON.stringify(snapshotDetails)}; cache write=${written}\n`,
      );
    } else {
      process.stderr.write("[harness-status-line-quota] refresh returned no snapshots\n");
    }
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
      writer.write(snapshots);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[harness-status-line-quota] ${message}\n`);
    }
  }
});
