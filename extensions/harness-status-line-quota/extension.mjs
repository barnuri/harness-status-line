import { joinSession } from "@github/copilot-sdk/extension";
import { CopilotQuotaWriter } from "./quotaWriter.mjs";

const session = await joinSession({ tools: [] });
const writer = new CopilotQuotaWriter();

session.on("assistant.usage", (event) => {
  const snapshots = event.data?.quotaSnapshots;
  if (!snapshots) {
    return;
  }

  try {
    writer.write(snapshots);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[harness-status-line-quota] ${message}\n`);
  }
});
