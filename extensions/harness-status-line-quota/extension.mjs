import { joinSession } from "@github/copilot-sdk/extension";
import { CopilotQuotaWriter } from "./quotaWriter.mjs";

const session = await joinSession({ tools: [] });
const writer = new CopilotQuotaWriter();
const REFRESH_INTERVAL_MS = 30_000;
let refreshInProgress = false;

async function refreshQuota() {
  if (refreshInProgress) {
    return;
  }

  refreshInProgress = true;
  try {
    const result = await session.rpc.model.list({ skipCache: true });
    if (result.quotaSnapshots) {
      writer.write(result.quotaSnapshots);
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
