import { joinSession } from "@github/copilot-sdk/extension";
import { CopilotQuotaWriter } from "./quotaWriter.mjs";

const session = await joinSession({ tools: [] });
const writer = new CopilotQuotaWriter();
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
    const lastPolledAt = writer.getPolledAt();
    if (lastPolledAt !== null && now >= lastPolledAt && now - lastPolledAt < REFRESH_INTERVAL_MS) {
      process.stderr.write(
        `[harness-status-line-quota] poll skipped; polledAt=${new Date(lastPolledAt).toISOString()}\n`,
      );
      return;
    }

    const polledAt = now;
    const result = await session.rpc.model.list({ skipCache: true });
    const snapshots = result.quotaSnapshots;
    const written = snapshots ? writer.write(snapshots, Date.now(), polledAt) : false;
    if (!written) {
      writer.markPolled(polledAt);
    }
    process.stderr.write(
      `[harness-status-line-quota] poll snapshots=${JSON.stringify(summarizeSnapshots(snapshots))}; write=${written}; polledAt=${new Date(polledAt).toISOString()}\n`,
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
      const written = writer.write(snapshots);
      process.stderr.write(
        `[harness-status-line-quota] event snapshots=${JSON.stringify(summarizeSnapshots(snapshots))}; write=${written}; polledAt=${writer.getPolledAt() === null ? "missing" : new Date(writer.getPolledAt()).toISOString()}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[harness-status-line-quota] ${message}\n`);
    }
  }
});
